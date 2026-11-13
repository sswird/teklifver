// Aramalarda bulunabilen hizmet ve il sayfaları: /hizmet/temizlik, /hizmet/temizlik/izmir, /il/izmir
const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const User = require('../models/User');
const categories = require('../config/categories');
const content = require('../config/category-content');
const { liveFilter } = require('../lib/listing');
const { priceGuide, districtCounts } = require('../lib/stats');
const { money } = require('../lib/helpers');
const { categoryBySlug, cityBySlug, categoryUrl, cityUrl, categoryCityUrl } = require('../lib/slug');

const PAGE_SIZE = 20;

const notFound = res =>
  res.status(404).render('error', { title: 'Sayfa bulunamadı', code: 404, message: 'Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.' });

// Sıkça sorulanlar sitedeki gerçek teklif verilerinden üretilir.
function buildFaqs(category, place, price) {
  const where = place ? `${place} için ` : '';
  const faqs = [];
  if (category && price && price.total >= 3) {
    faqs.push({
      q: `${category} fiyatları ne kadar?`,
      a: `Sitede bu kategoride verilen ${price.total} teklifin ortalaması ${money(price.average)}. Teklifler ${money(price.lowest)} ile ${money(price.highest)} arasında değişiyor, ortalama süre ${price.days} gün. Kesin fiyat işin kapsamına göre belirlenir.`
    });
  }
  if (category && content[category]) {
    faqs.push({
      q: `${category} fiyatını neler etkiler?`,
      a: `${content[category].factors.join(', ')} fiyatı en çok etkileyen konulardır. Bunları talebinizde yazarsanız daha doğru teklif alırsınız.`
    });
  }
  faqs.push({
    q: `${where}nasıl teklif alırım?`.replace(/^n/, where ? 'n' : 'N'),
    a: 'Ücretsiz hesap açın, yapılacak işi yazın ve talebinizi yayınlayın. Firmalar teklif verir, fiyat, süre ve puanlarını karşılaştırıp size uyanı seçersiniz.'
  });
  faqs.push({
    q: 'Teklif almak ücretli mi?',
    a: 'Hayır. Hesap açmak, talep vermek ve teklif almak ücretsizdir. Telefon ve e-postanız yalnızca bir teklifi kabul ettiğinizde firmayla paylaşılır.'
  });
  return faqs;
}

async function renderLanding(req, res, next, { category, city }) {
  try {
    const filter = { ...liveFilter(), ...(category ? { category: category.name } : {}), ...(city ? { city } : {}) };
    const total = await Request.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), totalPages);

    const companyFilter = {
      role: 'company',
      suspended: { $ne: true },
      ...(category ? { categories: category.name } : {}),
      ...(city ? { $or: [{ address: city }, { serviceCities: city }] } : {})
    };

    const [requests, companies, guide, cityRows, categoryRows, districtRows] = await Promise.all([
      Request.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      User.find(companyFilter).select('name companyName rating ratingCount verified address').sort({ rating: -1, ratingCount: -1 }).limit(6).lean(),
      category ? priceGuide() : {},
      // Birbirine bağlantı: kategorideki iller ve ildeki kategoriler
      category ? Request.aggregate([{ $match: { ...liveFilter(), category: category.name, city: { $exists: true, $nin: [null, ''] } } }, { $group: { _id: '$city', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 24 }]) : [],
      city ? Request.aggregate([{ $match: { ...liveFilter(), city } }, { $group: { _id: '$category', total: { $sum: 1 } } }, { $sort: { total: -1 } }]) : [],
      // İldeki ilçeler: talep listesine ilçeyle bağlanır
      city ? districtCounts(filter) : []
    ]);

    const price = category ? guide[category.name] : null;
    const name = category && city ? `${city} ${category.name}` : category ? category.name : `${city} Hizmet Firmaları`;
    const heading = category ? `${name} Teklifleri` : `${city} Hizmet Talepleri ve Firmaları`;
    const intro = category
      ? (content[category.name] || content['Diğer']).intro
      : `${city} ilinde tadilat, nakliye, temizlik, yazılım ve daha pek çok iş için talep verin, firmalardan teklif alın. Açık talepleri inceleyin, firmaları puan ve yorumlarına göre karşılaştırın.`;
    const description = (city && category ? `${city} ilinde ${category.name.toLocaleLowerCase('tr-TR')} için ücretsiz teklif alın. ` : '') + intro;

    const base = res.locals.siteBase;
    const path = category && city ? categoryCityUrl(category.name, city) : category ? categoryUrl(category.name) : cityUrl(city);
    const faqs = buildFaqs(category && category.name, city, price);

    res.render('pages/landing', {
      title: heading,
      fullTitle: `${heading}: Ücretsiz Fiyat Al | TeklifVer`,
      metaDescription: description.slice(0, 158),
      canonicalUrl: `${base}${path}${page > 1 ? `?page=${page}` : ''}`,
      // İçeriği olmayan sayfa aramalarda çıkmasın.
      noIndex: total === 0 && companies.length === 0,
      ownHeading: true,
      jsonLdData: [
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${base}/` },
            ...(category ? [{ '@type': 'ListItem', position: 2, name: category.name, item: `${base}${categoryUrl(category.name)}` }] : []),
            ...(city ? [{ '@type': 'ListItem', position: category ? 3 : 2, name: city, item: `${base}${path}` }] : [])
          ]
        },
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map(faq => ({ '@type': 'Question', name: faq.q, acceptedAnswer: { '@type': 'Answer', text: faq.a } }))
        }
      ],
      heading,
      intro,
      category,
      city,
      factors: category ? (content[category.name] || content['Diğer']).factors : [],
      questions: category ? (content[category.name] || content['Diğer']).questions : [],
      example: category ? (content[category.name] || content['Diğer']).example : null,
      requests,
      companies,
      price: price && price.total >= 3 ? price : null,
      faqs,
      total,
      page,
      totalPages,
      path,
      cityLinks: cityRows.map(row => ({ name: row._id, total: row.total, url: categoryCityUrl(category.name, row._id) })),
      districtLinks: districtRows.map(row => ({ name: row.name, total: row.total, url: `/requests?${new URLSearchParams({ ...(category ? { category: category.name } : {}), city, district: row.name })}` })),
      categoryLinks: city
        ? categoryRows.map(row => ({ name: row._id, total: row.total, url: categoryCityUrl(row._id, city) }))
        : categories.filter(item => !category || item.name !== category.name).slice(0, 12).map(item => ({ name: item.name, url: categoryUrl(item.name) }))
    });
  } catch (err) {
    next(err);
  }
}

router.get('/hizmet/:category', (req, res, next) => {
  const category = categoryBySlug.get(req.params.category);
  if (!category) return notFound(res);
  renderLanding(req, res, next, { category });
});

router.get('/hizmet/:category/:city', (req, res, next) => {
  const category = categoryBySlug.get(req.params.category);
  const city = cityBySlug.get(req.params.city);
  if (!category || !city) return notFound(res);
  renderLanding(req, res, next, { category, city });
});

router.get('/il/:city', (req, res, next) => {
  const city = cityBySlug.get(req.params.city);
  if (!city) return notFound(res);
  renderLanding(req, res, next, { city });
});

module.exports = router;
