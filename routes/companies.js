const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Bid = require('../models/Bid');
const Request = require('../models/Request');
const Review = require('../models/Review');
const CompanyReport = require('../models/CompanyReport');
const categories = require('../config/categories');
const cities = require('../config/cities');
const { isLoggedIn, isCompany } = require('../middleware/auth');
const { str } = require('../lib/input');
const { searchPatterns } = require('../public/js/search-terms');
const { companyStats } = require('../lib/stats');
const { badgesFor } = require('../lib/badges');
const { liveFilter } = require('../lib/listing');
const { limits } = require('../lib/limits');
const { notify } = require('../lib/notify');

const { COMPANY_REPORT_REASONS } = CompanyReport;
const PAGE_SIZE = 30;
const MAX_REPLY = 1000;

// İletişim bilgileri burada gösterilmez; yalnızca kabul edilen tekliflerde paylaşılır.
const PUBLIC_FIELDS =
  'name companyName companyDescription address serviceCities specialties categories rating ratingCount createdAt avatar verified portfolio';

const SORTS = {
  rating: { rating: -1, ratingCount: -1 },
  reviews: { ratingCount: -1, rating: -1 },
  newest: { createdAt: -1 }
};

router.get('/', async (req, res, next) => {
  try {
    const search = str(req.query.search);
    const city = cities.includes(req.query.city) ? req.query.city : '';
    const category = categories.names.includes(req.query.category) ? req.query.category : '';
    const minRating = ['3', '4', '4.5'].includes(req.query.minRating) ? req.query.minRating : '';
    const verified = req.query.verified === 'on';
    const sort = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : 'rating';

    const filter = { role: 'company', suspended: { $ne: true } };
    const conditions = searchPatterns(search).map(pattern => {
      const regex = { $regex: pattern, $options: 'i' };
      return { $or: [{ companyName: regex }, { specialties: regex }, { categories: regex }] };
    });
    if (city) conditions.push({ $or: [{ address: city }, { serviceCities: city }] });
    if (conditions.length) filter.$and = conditions;
    if (category) filter.categories = category;
    if (minRating) filter.rating = { $gte: Number(minRating) };
    if (verified) filter.verified = true;

    const total = await User.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), totalPages);

    const companies = await User.find(filter)
      .select(PUBLIC_FIELDS)
      .sort(SORTS[sort])
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();

    const badgeMap = await badgesFor(companies);
    const params = new URLSearchParams();
    Object.entries({ search, city, category, minRating, verified: verified ? 'on' : '', sort: sort === 'rating' ? '' : sort })
      .forEach(([key, value]) => { if (value) params.set(key, value); });

    res.render('companies/index', {
      title: 'Firma Rehberi',
      metaDescription: 'Puan, kategori ve ile göre hizmet firmaları. Yorumları okuyun, firmaları karşılaştırın.',
      companies,
      badgeMap,
      categories,
      search,
      city,
      category,
      minRating,
      verified,
      sort,
      total,
      page,
      totalPages,
      pageQuery: params.toString()
    });
  } catch (err) {
    next(err);
  }
});

// Firma karşılaştırma: en fazla üç firma yan yana. Sıra, adresteki sıradır.
router.get('/karsilastir', async (req, res, next) => {
  try {
    const ids = [...new Set(String(req.query.ids || '').split(','))].filter(id => mongoose.isValidObjectId(id)).slice(0, 3);
    const found = ids.length
      ? await User.find({ _id: { $in: ids }, role: 'company', suspended: { $ne: true } }).select(PUBLIC_FIELDS).lean()
      : [];
    const companies = ids.map(id => found.find(company => String(company._id) === id)).filter(Boolean);
    const [statsList, badgeMap] = await Promise.all([
      Promise.all(companies.map(company => companyStats(company._id))),
      badgesFor(companies)
    ]);
    res.render('companies/compare', {
      title: 'Firma Karşılaştırma',
      metaDescription: 'Firmaların puanını, iş sayısını, teslim süresini ve hizmet bölgesini yan yana karşılaştırın.',
      noIndex: true,
      ownHeading: true,
      rows: companies.map((company, index) => ({ company, stats: statsList[index], badges: badgeMap.get(String(company._id)) }))
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const company = mongoose.isValidObjectId(req.params.id)
      ? await User.findOne({ _id: req.params.id, role: 'company', suspended: { $ne: true } }).select(PUBLIC_FIELDS).lean()
      : null;

    if (!company) {
      return res.status(404).render('error', {
        title: 'Firma bulunamadı',
        code: 404,
        message: 'Bu firma artık sitede olmayabilir.'
      });
    }

    const viewer = req.session.user;
    // Firmanın kendi bakışları sayılmaz.
    if (!viewer || viewer.id !== String(company._id)) {
      await User.updateOne({ _id: company._id }, { $inc: { profileViews: 1 } }, { timestamps: false });
    }
    const [wonBids, stats, reviews, ownRequests, alreadyReported, badgeMap, similarFirms] = await Promise.all([
      Bid.find({ company: company._id, status: 'accepted' })
        .populate('request', 'no title category status city location images createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      companyStats(company._id),
      Review.find({ company: company._id, hidden: { $ne: true } })
        .populate('customer', 'name')
        .populate('request', 'title')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      // Müşteri, açık taleplerinden birine bu firmayı davet edebilir.
      viewer && viewer.role === 'customer'
        ? Request.find({ ...liveFilter(), customer: viewer.id }).select('title invitedCompanies').sort({ createdAt: -1 }).limit(20).lean()
        : [],
      viewer ? CompanyReport.exists({ company: company._id, reporter: viewer.id }) : null,
      badgesFor([company]),
      // Benzer firmalar: aynı kategorilerde hizmet veren, puanı yüksek ilk dört firma
      company.categories && company.categories.length
        ? User.find({ role: 'company', suspended: { $ne: true }, _id: { $ne: company._id }, categories: { $in: company.categories } })
          .select('name companyName avatar rating ratingCount address verified createdAt')
          .sort({ rating: -1, ratingCount: -1 })
          .limit(4)
          .lean()
        : []
    ]);
    const similarBadges = await badgesFor(similarFirms);

    const companyId = String(company._id);
    const title = company.companyName || company.name;
    const logo = company.avatar || (company.portfolio && company.portfolio[0]) || '';
    res.render('companies/show', {
      title,
      fullTitle: `${title}${company.address ? ` - ${company.address}` : ''}: Yorumlar ve Puan | TeklifVer`,
      metaDescription: (company.companyDescription || `${title} firmasının puanı, müşteri yorumları ve aldığı işler.`).slice(0, 155),
      ogImage: logo,
      ownHeading: true,
      jsonLdData: {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: title,
        url: `${res.locals.siteBase}/companies/${companyId}`,
        ...(company.companyDescription ? { description: company.companyDescription.slice(0, 300) } : {}),
        ...(logo ? { image: `${res.locals.siteBase}${logo}` } : {}),
        ...(company.address ? { address: { '@type': 'PostalAddress', addressRegion: company.address, addressCountry: 'TR' } } : {}),
        ...(company.ratingCount > 0
          ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: company.rating, reviewCount: company.ratingCount, bestRating: 5 } }
          : {})
      },
      company,
      stats,
      badges: badgeMap.get(String(company._id)),
      similarFirms,
      similarBadges,
      reviews: reviews.filter(review => review.customer),
      jobs: wonBids.filter(bid => bid.request).map(bid => ({ ...bid.request, wonAmount: bid.amount })),
      inviteOptions: ownRequests.filter(item => !(item.invitedCompanies || []).some(id => String(id) === companyId)),
      isOwnPage: Boolean(viewer && viewer.id === companyId),
      reportReasons: COMPANY_REPORT_REASONS,
      alreadyReported: Boolean(alreadyReported)
    });
  } catch (err) {
    next(err);
  }
});

// Firmayı şikayet et
router.post('/:id/report', isLoggedIn, limits.report, async (req, res, next) => {
  const back = mongoose.isValidObjectId(req.params.id) ? `/companies/${req.params.id}` : '/companies';
  try {
    const company = mongoose.isValidObjectId(req.params.id)
      ? await User.findOne({ _id: req.params.id, role: 'company' }).select('_id').lean()
      : null;
    if (!company) return res.redirect('/companies');

    if (String(company._id) === req.session.user.id) {
      req.flash('error', 'Kendi firmanızı şikayet edemezsiniz.');
      return res.redirect(back);
    }
    if (!COMPANY_REPORT_REASONS.includes(req.body.reason)) {
      req.flash('error', 'Bir şikayet nedeni seçin.');
      return res.redirect(back);
    }

    await CompanyReport.create({
      company: company._id,
      reporter: req.session.user.id,
      reason: req.body.reason,
      note: str(req.body.note).slice(0, 500)
    });
    req.flash('success', 'Şikayetiniz alındı, teşekkürler.');
    res.redirect(back);
  } catch (err) {
    if (err.code === 11000) {
      req.flash('error', 'Bu firmayı daha önce şikayet ettiniz.');
      return res.redirect(back);
    }
    next(err);
  }
});

// Firma, kendisine yazılan yoruma cevap verir; boş gönderirse cevap kalkar.
router.post('/reviews/:id/reply', isCompany, async (req, res, next) => {
  try {
    const me = req.session.user.id;
    const review = mongoose.isValidObjectId(req.params.id)
      ? await Review.findOne({ _id: req.params.id, company: me })
      : null;
    if (!review) {
      req.flash('error', 'Yorum bulunamadı.');
      return res.redirect(`/companies/${me}`);
    }

    const text = str(req.body.reply);
    if (text.length > MAX_REPLY) {
      req.flash('error', `Cevap en fazla ${MAX_REPLY} karakter olabilir.`);
      return res.redirect(`/companies/${me}`);
    }

    const isNew = !review.reply || !review.reply.text;
    review.reply = text ? { text, at: new Date() } : undefined;
    await review.save();
    if (text && isNew) {
      await notify(review.customer, `${req.session.user.companyName || req.session.user.name}, yorumunuza cevap verdi.`, `/companies/${me}`);
    }

    req.flash('success', text ? 'Cevabınız yayınlandı.' : 'Cevabınız kaldırıldı.');
    res.redirect(`/companies/${me}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
