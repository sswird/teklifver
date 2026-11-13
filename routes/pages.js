const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Request = require('../models/Request');
const User = require('../models/User');
const categories = require('../config/categories');
const { rateLimit } = require('express-rate-limit');
const { liveFilter } = require('../lib/listing');
const { openCountsByCategory, priceGuide } = require('../lib/stats');
const { priceBoard } = require('../lib/price-board');
const { str, isEmail } = require('../lib/input');
const { sendInBackground, isEnabled: mailEnabled, verificationRequired } = require('../lib/mailer');
const ContactMessage = require('../models/ContactMessage');
const Ad = require('../models/Ad');
const { siteUrl } = require('../lib/url');
const { categoryUrl, cityUrl, categoryCityUrl } = require('../lib/slug');

const pages = {
  '/yardim': { view: 'help', title: 'Yardım' },
  '/reklam': { view: 'ads', title: 'Reklam Ver' },
  '/hakkimizda': { view: 'about', title: 'Hakkımızda', metaDescription: 'TeklifVer nedir, nasıl çalışır? Hizmet arayanlarla firmaları buluşturan teklif platformu.' },
  '/firmalar-icin': { view: 'for-companies', title: 'Firmalar İçin', metaDescription: 'Firmanızı tanıtın, size uygun taleplere teklif verin, müşteri yorumlarıyla güven kazanın.' },
  '/guvenli-hizmet': { view: 'safety', title: 'Güvenli Hizmet Rehberi', metaDescription: 'Hizmet alırken dikkat edilmesi gerekenler: firma seçimi, sözleşme, ödeme ve dolandırıcılık uyarıları.' },
  '/veri-silme': { view: 'data-deletion', title: 'Hesap ve Veri Silme', metaDescription: 'TeklifVer hesabınızı ve kişisel verilerinizi nasıl silebilirsiniz?' },
  '/kullanim-kosullari': { view: 'terms', title: 'Kullanım Koşulları' },
  '/gizlilik': { view: 'privacy', title: 'Gizlilik ve KVKK Aydınlatma Metni' },
  '/cerez-politikasi': { view: 'cookies', title: 'Çerez Politikası' }
};

Object.entries(pages).forEach(([path, page]) => {
  router.get(path, (req, res) => {
    res.render(`pages/${page.view}`, {
      title: page.title,
      metaDescription: page.metaDescription || '',
      pagePath: path,
      // Yardım metni sitenin gerçek ayarına göre yazılır.
      codeLogin: verificationRequired(),
      freeBids: PLANS.free.monthlyBids
    });
  });
});

// Tüm kategoriler, alt başlıkları ve talep sayılarıyla
router.get('/kategoriler', async (req, res, next) => {
  try {
    res.render('pages/categories', {
      title: 'Tüm Kategoriler',
      metaDescription: 'Tadilat, nakliye, temizlik, yazılım ve daha fazlası: tüm hizmet kategorileri.',
      counts: await openCountsByCategory()
    });
  } catch (err) {
    next(err);
  }
});

router.get('/fiyat-rehberi', async (req, res, next) => {
  try {
    res.render('pages/price-guide', {
      title: 'Fiyat Rehberi',
      metaDescription: 'Kategorilere göre verilen tekliflerin ortalaması, en düşük ve en yüksek tutarları.',
      guide: await priceGuide(),
      // Sık yaptırılan işlerin fiyat aralığı (ana sayfadaki fiyat panosuyla aynı hesap)
      jobs: await priceBoard()
    });
  } catch (err) {
    next(err);
  }
});

router.get('/iller', async (req, res, next) => {
  try {
    const rows = await Request.aggregate([
      { $match: liveFilter() },
      { $group: { _id: '$city', total: { $sum: 1 } } }
    ]);
    res.render('pages/cities', {
      title: 'İllere Göre Talepler',
      metaDescription: '81 ilde açık hizmet talepleri.',
      cityCounts: Object.fromEntries(rows.map(row => [row._id, row.total]))
    });
  } catch (err) {
    next(err);
  }
});

const CONTACT_SUBJECTS = ['Genel soru', 'Hesabımla ilgili sorun', 'Firma paketi', 'Şikayet', 'Reklam', 'Öneri'];
const PLANS = require('../config/plans');
const MAX_CONTACT_MESSAGE = 2000;

const renderContact = (res, extra = {}) =>
  res.render('pages/contact', { title: 'İletişim', pagePath: '/iletisim', subjects: CONTACT_SUBJECTS, ...extra });

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429);
    renderContact(res, { values: req.body, errors: { form: 'Çok fazla mesaj gönderildi. Lütfen 15 dakika sonra tekrar deneyin.' } });
  }
});

router.get('/iletisim', (req, res) => {
  const user = req.session.user;
  const plan = PLANS[req.query.paket];
  const subject = plan ? 'Firma paketi' : CONTACT_SUBJECTS.includes(req.query.konu) ? req.query.konu : '';
  const message = plan ? `${plan.name} paketine geçmek istiyorum.${user && user.companyName ? ` Firma: ${user.companyName}` : ''}` : '';
  renderContact(res, { values: { subject, message, ...(user ? { name: user.name, email: user.email } : {}) } });
});

router.post('/iletisim', contactLimiter, async (req, res, next) => {
  const values = {
    name: str(req.body.name),
    email: str(req.body.email).toLowerCase(),
    subject: str(req.body.subject),
    message: str(req.body.message)
  };

  // Formdaki gizli alanı yalnızca otomatik doldurucular doldurur.
  if (str(req.body.website)) {
    req.flash('success', 'Mesajınız alındı. Teşekkür ederiz.');
    return res.redirect('/iletisim');
  }

  const errors = {};
  if (!values.name) errors.name = 'Adınızı yazın.';
  if (!isEmail(values.email)) errors.email = 'Geçerli bir e-posta adresi yazın.';
  if (!CONTACT_SUBJECTS.includes(values.subject)) errors.subject = 'Konu seçin.';
  if (!values.message) errors.message = 'Mesajınızı yazın.';
  else if (values.message.length > MAX_CONTACT_MESSAGE) errors.message = `Mesaj en fazla ${MAX_CONTACT_MESSAGE} karakter olabilir.`;

  if (Object.keys(errors).length) {
    res.status(422);
    return renderContact(res, { values, errors });
  }

  try {
    // Mesaj önce kaydedilir: e-posta gönderilemese de yönetim panelinde okunur.
    await ContactMessage.create(values);
    if (process.env.SITE_EMAIL && mailEnabled()) {
      sendInBackground({
        to: process.env.SITE_EMAIL,
        subject: `TeklifVer iletişim: ${values.subject}`,
        text: `Gönderen: ${values.name}\nE-posta: ${values.email}\nKonu: ${values.subject}\n\n${values.message}`
      });
    }
    req.flash('success', 'Mesajınız alındı. Teşekkür ederiz.');
    res.redirect('/iletisim');
  } catch (err) {
    next(err);
  }
});

const baseUrl = siteUrl;

// Reklam tıklaması sayılır ve hedefe gidilir.
router.get('/reklam-tik/:id', async (req, res, next) => {
  try {
    const ad = mongoose.isValidObjectId(req.params.id)
      ? await Ad.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } }).select('url').lean()
      : null;
    res.redirect(ad ? ad.url : '/');
  } catch (err) {
    next(err);
  }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Disallow: /dashboard',
      'Disallow: /messages',
      'Disallow: /notifications',
      'Disallow: /profile',
      'Disallow: /admin',
      'Disallow: /reset',
      'Disallow: /email',
      'Disallow: /auth',
      'Disallow: /reklam-tik',
      `Sitemap: ${baseUrl(req)}/sitemap.xml`
    ].join('\n')
  );
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const [requests, firms, rows] = await Promise.all([
      Request.find(liveFilter()).select('updatedAt').sort({ createdAt: -1 }).limit(5000).lean(),
      User.find({ role: 'company', suspended: { $ne: true } }).select('updatedAt').limit(5000).lean(),
      Request.aggregate([
        { $match: { ...liveFilter(), city: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: { category: '$category', city: '$city' } } }
      ])
    ]);
    // Yalnızca içeriği olan il ve hizmet-il sayfaları listelenir.
    const combos = rows;
    const cityRows = [...new Set(rows.map(row => row._id.city))].map(city => ({ _id: { city } }));

    const entry = (path, date) =>
      `<url><loc>${base}${path}</loc>${date ? `<lastmod>${new Date(date).toISOString()}</lastmod>` : ''}</url>`;

    const urls = [
      entry('/'),
      entry('/requests'),
      entry('/companies'),
      entry('/yardim'),
      entry('/kategoriler'),
      entry('/fiyat-rehberi'),
      entry('/iller'),
      entry('/iletisim'),
      entry('/hakkimizda'),
      entry('/firmalar-icin'),
      entry('/guvenli-hizmet'),
      ...categories.names.map(name => entry(categoryUrl(name))),
      ...cityRows.map(row => entry(cityUrl(row._id.city))),
      ...combos.map(row => entry(categoryCityUrl(row._id.category, row._id.city))),
      ...requests.map(item => entry(`/requests/${item._id}`, item.updatedAt)),
      ...firms.map(item => entry(`/companies/${item._id}`, item.updatedAt))
    ];

    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
