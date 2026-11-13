const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const Bid = require('../models/Bid');
const User = require('../models/User');
const Message = require('../models/Message');
const Report = require('../models/Report');
const Review = require('../models/Review');
const categories = require('../config/categories');
const { badgesFor } = require('../lib/badges');
const cities = require('../config/cities');
const { isCustomer, isCompany, isLoggedIn, requireVerifiedEmail } = require('../middleware/auth');
const { limits } = require('../lib/limits');
const { categoryUrl, categoryCityUrl } = require('../lib/slug');
const { alertSavedSearches } = require('../lib/search-alerts');
const { parseDateInput, isExpired, discoveryTimes, budgetLabel } = require('../lib/helpers');
const { bidAllowance } = require('../lib/plans');
const { rateLimit } = require('express-rate-limit');
const { uploadImages, deleteImages, copyImages, MAX_IMAGES } = require('../middleware/upload');
const { str, safeNext } = require('../lib/input');
const { searchPatterns, matchesText, similarityPatterns, rankSimilar } = require('../public/js/search-terms');
const { openCountsByCategory, uniqueByPhoto, categoryAverages, priceGuide, districtsByCity: loadDistricts, districtCounts } = require('../lib/stats');
const { SORT_OPTIONS, liveFilter, readFilters, buildConditions, filtersToQuery, firmsServing, placePrefixSource } = require('../lib/listing');
const { notify, notifyMany } = require('../lib/notify');
const mongoose = require('mongoose');
const { REPORT_REASONS } = Report;

const MAX_BUDGET = 10000000000;
const MAX_DESCRIPTION = 5000;
// "ghgfn" gibi denemeler yayına girmesin.
const MIN_TITLE = 8;
const MIN_DESCRIPTION = 20;
// Formdaki karakter sayacı en az uzunluğu buradan okur.
router.use((req, res, next) => {
  res.locals.minDescription = MIN_DESCRIPTION;
  next();
});
const HAS_VOWEL = /[aeıioöuüâîû]/i;
const MAX_QUESTION = 500;
const MAX_ANSWER = 1000;

const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ items: [] })
});

const notFoundPage = res =>
  res.status(404).render('error', {
    title: 'Talep bulunamadı',
    code: 404,
    message: 'Bu talep silinmiş, yayından kaldırılmış veya hiç var olmamış olabilir.'
  });

const uploadedPaths = req => (req.files || []).map(file => '/uploads/' + file.filename);

// Talep formunu okur ve doğrular.
function parseRequestForm(req) {
  const values = {
    title: str(req.body.title),
    description: str(req.body.description),
    category: str(req.body.category),
    budgetMin: str(req.body.budgetMin),
    budgetMax: str(req.body.budgetMax),
    deadline: str(req.body.deadline),
    city: str(req.body.city),
    location: str(req.body.location),
    discoveryTime: str(req.body.discoveryTime)
  };

  const errors = {};
  const min = Number(values.budgetMin || 0);
  const max = Number(values.budgetMax || 0);
  const deadline = values.deadline ? parseDateInput(values.deadline) : null;

  if (!values.title) errors.title = 'Başlık yazın.';
  else if (values.title.length < MIN_TITLE || !HAS_VOWEL.test(values.title)) errors.title = 'Başlıkta işi birkaç kelimeyle anlatın. Örneğin: Mutfak dolabı kapakları değişecek';
  else if (values.title.length > 200) errors.title = 'Başlık en fazla 200 karakter olabilir.';
  if (!values.description) errors.description = 'Açıklama yazın.';
  else if (values.description.length < MIN_DESCRIPTION || !HAS_VOWEL.test(values.description)) errors.description = `Açıklama en az ${MIN_DESCRIPTION} karakter olmalı. Ölçü, malzeme ve zaman gibi ayrıntıları yazın.`;
  else if (values.description.length > MAX_DESCRIPTION) errors.description = `Açıklama en fazla ${MAX_DESCRIPTION} karakter olabilir.`;
  if (values.discoveryTime && !discoveryTimes.includes(values.discoveryTime)) errors.discoveryTime = 'Listeden bir seçenek seçin.';
  if (values.location.length > 100) errors.location = 'İlçe / semt en fazla 100 karakter olabilir.';
  if (!categories.names.includes(values.category)) errors.category = 'Kategori seçin.';
  if (values.city && !cities.includes(values.city)) errors.city = 'Listeden bir il seçin.';
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > MAX_BUDGET || max > MAX_BUDGET) {
    errors.budget = 'Bütçe geçerli bir tutar olmalı.';
  } else if (max > 0 && min > max) {
    errors.budget = 'En az bütçe, en fazla bütçeden büyük olamaz.';
  }
  if (values.deadline && !deadline) errors.deadline = 'Geçerli bir tarih seçin.';
  else if (deadline && deadline.getTime() < Date.now()) errors.deadline = 'Son tarih geçmiş bir gün olamaz.';
  if (req.uploadError) errors.images = req.uploadError;

  return {
    values: { ...values, isUrgent: req.body.isUrgent === 'on' },
    errors,
    data: {
      title: values.title,
      description: values.description,
      category: values.category,
      budget: { min, max },
      city: values.city || undefined,
      location: values.location,
      discoveryTime: values.discoveryTime,
      deadline: deadline || undefined,
      isUrgent: req.body.isUrgent === 'on'
    }
  };
}

// Tüm açık talepler
router.get('/', async (req, res, next) => {
  try {
    const filters = readFilters(req.query);
    const requestedPage = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const filter = buildConditions(filters);

    // Arama ya da filtre varken soldaki kategori sayıları o aramaya göre (kategori seçimi hariç) sayılır.
    const filtered = ['search', 'city', 'district', 'budgetMin', 'budgetMax', 'period', 'photos', 'noBids', 'urgent'].some(key => filters[key]);
    // İl seçiliyse soldaki ilçe listesi: sayılar ilçe seçimi hariç aynı aramaya göre.
    const cityFilter = filters.city ? buildConditions({ ...filters, district: '' }) : null;
    const [total, counts, menuRows, districtsByCity, districtRows, cityTotal] = await Promise.all([
      Request.countDocuments(filter),
      openCountsByCategory(),
      filtered
        ? Request.aggregate([{ $match: buildConditions({ ...filters, category: 'all' }) }, { $group: { _id: '$category', total: { $sum: 1 } } }])
        : null,
      loadDistricts(),
      cityFilter ? districtCounts(cityFilter) : [],
      cityFilter ? Request.countDocuments(cityFilter) : 0
    ]);
    const totalPages = Math.max(Math.ceil(total / filters.perPage), 1);
    const page = Math.min(requestedPage, totalPages);

    const requests = await Request.find(filter)
      .sort(SORT_OPTIONS[filters.sort])
      .skip((page - 1) * filters.perPage)
      .limit(filters.perPage)
      .lean();
    // Sonuç çıkmazsa sayfa boş kalmasın: uygun kategori önerisi ve son eklenen talepler
    const suggestion = !requests.length && filters.search ? categories.guess(filters.search) : '';
    const fallback = requests.length ? [] : await Request.find(liveFilter()).sort({ createdAt: -1 }).limit(5).lean();

    res.render('requests/index', {
      title: filters.category === 'all' ? 'Talepler' : filters.category,
      metaDescription: filters.category === 'all'
        ? 'Açık hizmet talepleri: tadilat, nakliye, temizlik, yazılım ve daha fazlası. Firmalar teklif verebilir.'
        : `${filters.category} kategorisindeki açık hizmet talepleri. Firmalar ücretsiz teklif verebilir.`,
      requests,
      filters,
      canonicalUrl: `${res.locals.siteBase}${filters.category === 'all' ? '/requests' : categoryUrl(filters.category)}`,
      // Filtreli sonuçlar aramalarda çıkmaz; asıl içerik hizmet ve il sayfalarındadır.
      noIndex: Boolean(filtersToQuery(filters) && !(filters.category !== 'all' && filtersToQuery(filters).split('&').length === 1)) || filters.sort !== 'newest' || filters.view !== 'list' || filters.perPage !== 20 || page > 1,
      savedQuery: filtersToQuery(filters),
      counts,
      menuCounts: menuRows ? Object.fromEntries(menuRows.map(row => [row._id, row.total])) : null,
      districtsByCity,
      districtRows,
      cityTotal,
      suggestion,
      fallback,
      total,
      page,
      totalPages
    });
  } catch (err) {
    next(err);
  }
});

// Arama kutusu için öneriler
router.get('/suggest', suggestLimiter, async (req, res, next) => {
  try {
    const q = str(req.query.q);
    if (q.length < 2) return res.json({ items: [] });

    // Yer önerileri: yazılan bir ilin ya da açık taleplerde geçen bir ilçenin başıysa ("ank" -> Ankara, "kad" -> Kadıköy).
    // Kısa yazılarda (2-3 harf) kategoriler yalnız kelime başıyla eşleşir, başlık önerisi gelmez: "ist" "istiyorum"u bulmasın.
    const short = q.length < 4;
    const prefix = placePrefixSource(q);
    const wordStart = new RegExp(`(^|[\\s&/-])${prefix.slice(1)}`, 'i');
    const matchedCities = cities.filter(city => new RegExp(prefix, 'i').test(city)).slice(0, 5);
    const [matches, cityRows, districtRows] = await Promise.all([
      short
        ? []
        : Request.find({
          ...liveFilter(),
          $and: searchPatterns(q).map(pattern => ({ title: { $regex: pattern, $options: 'i' } }))
        })
          .select('title no')
          .sort({ viewCount: -1 })
          .limit(6)
          .lean(),
      matchedCities.length
        ? Request.aggregate([{ $match: { ...liveFilter(), city: { $in: matchedCities } } }, { $group: { _id: '$city', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 2 }])
        : [],
      Request.aggregate([
        { $match: { ...liveFilter(), city: { $nin: [null, ''] }, location: { $regex: prefix, $options: 'i' } } },
        { $group: { _id: { city: '$city', location: '$location' }, total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 3 }
      ])
    ]);
    const places = [
      ...cityRows.map(row => ({ label: row._id, hint: `İl · ${row.total} talep`, url: `/requests?city=${encodeURIComponent(row._id)}` })),
      ...districtRows.map(({ _id: row, total }) => ({
        label: `${row.location}, ${row.city}`,
        hint: `İlçe · ${total} talep`,
        url: `/requests?${new URLSearchParams({ city: row.city, district: row.location })}`
      }))
    ].slice(0, 3);

    res.json({
      items: [
        ...categories.names.filter(name => (short ? wordStart.test(name) : matchesText(q, [name]))).slice(0, 3).map(name => ({
          label: name,
          hint: 'Kategori',
          url: `/requests?category=${encodeURIComponent(name)}`
        })),
        ...places,
        ...matches.map(item => ({ label: item.title, hint: `No: ${item.no}`, url: `/requests/${item._id}` }))
      ]
    });
  } catch (err) {
    next(err);
  }
});

// Talep formunda başlık yazılırken benzer açık talepler: bütçe ve teklif sayısı fikir verir.
// Statik ön izleme aynı sıralamayı tarayıcıda yapar (scripts/pages/static.js).
router.get('/similar', suggestLimiter, async (req, res, next) => {
  try {
    const q = str(req.query.q);
    const patterns = similarityPatterns(q);
    if (q.length < 4 || !patterns.length) return res.json({ items: [] });
    const candidates = await Request.find({ ...liveFilter(), $or: patterns.map(({ source }) => ({ title: { $regex: source, $options: 'i' } })) })
      .select('title category budget bidCount city location createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const ranked = rankSimilar(
      candidates.map(item => ({ ...item, bids: item.bidCount || 0, created: new Date(item.createdAt).getTime() })),
      q,
      str(req.query.category)
    ).slice(0, 3);
    res.json({
      items: ranked.map(item => ({
        title: item.title,
        url: `/requests/${item._id}`,
        budget: budgetLabel(item.budget),
        bids: item.bids,
        place: [item.city, item.location].filter(Boolean).join(' / ')
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Talep formunu ziyaretçi de açar: önce işini yazar, hesap en son adımda istenir.
// Firma hesabı talep veremez; giriş yapmış müşteride e-posta doğrulaması aranır.
function customerOrGuest(req, res, next) {
  if (!req.session.user) return next();
  if (req.session.user.role !== 'customer') {
    req.flash('error', 'Bu işlem yalnızca müşteri hesapları içindir.');
    return res.redirect('/requests');
  }
  requireVerifiedEmail(req, res, next);
}
const whenLoggedIn = middleware => (req, res, next) => (req.session.user ? middleware(req, res, next) : next());

// Yeni talep formu
router.get('/new', customerOrGuest, (req, res, next) => {
  // Ana sayfadaki kutudan veya hizmet sayfasından gelen bilgiler form hazır gelsin.
  const formTitle = str(req.query.title).slice(0, 200);
  const city = str(req.query.city);
  const category = str(req.query.category);
  const chosen = categories.names.includes(category);
  const guessed = chosen ? '' : categories.guess(formTitle);
  // Ziyaretçiyken yazıp hesap açan kullanıcı taslağını hazır bulur.
  const pending = req.session.user && !formTitle ? req.session.pendingRequest : null;
  Promise.all([priceGuide(), loadDistricts()])
    .then(([priceHints, districtsByCity]) => res.render('requests/new', {
      title: 'Talep Ver',
      categories,
      maxImages: MAX_IMAGES,
      priceHints,
      districtsByCity,
      guest: !req.session.user,
      restored: Boolean(pending),
      guessedCategory: pending ? '' : guessed,
      values: pending || { title: formTitle, city: cities.includes(city) ? city : '', category: chosen ? category : guessed }
    }))
    .catch(next);
});

// Yeni talep oluştur
router.post('/', customerOrGuest, whenLoggedIn(limits.newRequest), uploadImages, async (req, res, next) => {
  try {
    const { values, errors, data } = parseRequestForm(req);
    const guest = !req.session.user;

    if (Object.keys(errors).length) {
      deleteImages(uploadedPaths(req));
      return res.status(422).render('requests/new', {
        title: 'Talep Ver',
        categories,
        maxImages: MAX_IMAGES,
        guest,
        values,
        errors
      });
    }

    // Ziyaretçinin talebi oturumda bekler; hesap açınca form dolu gelir ve tek tıkla yayınlanır.
    if (guest) {
      deleteImages(uploadedPaths(req));
      req.session.pendingRequest = values;
      req.flash('success', 'Talebiniz hazır. Yayınlamak için ücretsiz hesap açın ya da giriş yapın.');
      return res.redirect('/register?next=' + encodeURIComponent('/requests/new'));
    }
    delete req.session.pendingRequest;

    const created = await Request.create({
      ...data,
      customer: req.session.user.id,
      images: uploadedPaths(req)
    });

    // Bu kategoride ve bu ilde hizmet veren firmalara haber ver.
    const firms = await User.find({ role: 'company', suspended: false, categories: created.category, ...firmsServing(created.city) })
      .select('_id')
      .limit(200)
      .lean();
    await notifyMany(
      firms.map(firm => firm._id),
      `${created.category} kategorisinde yeni talep: "${created.title}"`,
      '/requests/' + created._id,
      { mail: 'matches' }
    );
    // Beklenmez: kayıtlı arama sayısı yanıtı geciktirmesin. Kategori bildirimi alan firmaya ikinci kez yazılmaz.
    alertSavedSearches(created, { except: firms.map(firm => firm._id) })
      .catch(err => console.error('Arama bildirimi gönderilemedi:', err.message));

    req.flash('success', firms.length
      ? `Talebiniz yayınlandı (Talep No: ${created.no}). Bu alanda hizmet veren ${firms.length} firmaya haber verdik; teklif geldikçe size bildirim gelecek.`
      : `Talebiniz yayınlandı (Talep No: ${created.no}). Bu alandaki firmalar talebinizi talepler listesinde görecek.`);
    res.redirect('/requests/' + created._id);
  } catch (err) {
    next(err);
  }
});

// Firmalar teklif vermeden önce talep sahibine soru sorar; soru ve cevap herkese açıktır.
router.post('/:id/questions', isCompany, requireVerifiedEmail, limits.question, async (req, res, next) => {
  const back = `/requests/${req.params.id}#soru-cevap`;
  try {
    const question = str(req.body.question);
    if (!question || question.length > MAX_QUESTION) {
      req.flash('error', `Sorunuzu en fazla ${MAX_QUESTION} karakterle yazın.`);
      return res.redirect(back);
    }

    const request = mongoose.isValidObjectId(req.params.id) ? await Request.findById(req.params.id) : null;
    if (!request || request.status === 'removed') return notFoundPage(res);
    if (request.status !== 'open' || isExpired(request)) {
      req.flash('error', 'Bu talep artık soru almıyor.');
      return res.redirect(back);
    }
    if ((request.questions || []).filter(item => String(item.asker) === req.session.user.id && !item.answer).length >= 3) {
      req.flash('error', 'Cevap bekleyen üç sorunuz var. Talep sahibi yanıtlayınca yenisini sorabilirsiniz.');
      return res.redirect(back);
    }

    const askerName = req.session.user.companyName || req.session.user.name;
    request.questions.push({ asker: req.session.user.id, askerName, question });
    await request.save();
    await notify(request.customer, `${askerName}, "${request.title}" talebinize soru sordu.`, back);

    req.flash('success', 'Sorunuz talep sahibine iletildi.');
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Talep sahibi soruyu cevaplar
router.post('/:id/questions/:questionId/answer', isCustomer, async (req, res, next) => {
  const back = `/requests/${req.params.id}#soru-cevap`;
  try {
    const answer = str(req.body.answer);
    if (!answer || answer.length > MAX_ANSWER) {
      req.flash('error', `Cevabınızı en fazla ${MAX_ANSWER} karakterle yazın.`);
      return res.redirect(back);
    }

    const request = mongoose.isValidObjectId(req.params.id)
      ? await Request.findOne({ _id: req.params.id, customer: req.session.user.id })
      : null;
    const item = request && mongoose.isValidObjectId(req.params.questionId) ? request.questions.id(req.params.questionId) : null;
    if (!item) {
      req.flash('error', 'Soru bulunamadı.');
      return res.redirect(request ? back : '/dashboard');
    }

    item.answer = answer;
    item.answeredAt = new Date();
    await request.save();
    if (item.asker) await notify(item.asker, `"${request.title}" talebinde sorunuz cevaplandı.`, back);

    req.flash('success', 'Cevabınız yayınlandı.');
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Favorilere ekle / çıkar
router.post('/:id/favorite', isLoggedIn, async (req, res, next) => {
  try {
    const exists = await Request.exists({ _id: req.params.id });
    if (!exists) {
      req.flash('error', 'Talep bulunamadı.');
      return res.redirect('/requests');
    }

    const favorites = req.session.user.favorites || [];
    const isFavorite = favorites.includes(req.params.id);

    await User.updateOne(
      { _id: req.session.user.id },
      isFavorite ? { $pull: { favorites: req.params.id } } : { $addToSet: { favorites: req.params.id } }
    );
    req.session.user.favorites = isFavorite
      ? favorites.filter(id => id !== req.params.id)
      : [...favorites, req.params.id];

    if ((req.get('accept') || '').includes('application/json')) {
      return res.json({ favorite: !isFavorite });
    }
    res.redirect(safeNext(req.body.next) || '/requests/' + req.params.id);
  } catch (err) {
    if (err.name === 'CastError') return res.redirect('/requests');
    next(err);
  }
});

// Talebi şikayet et
router.post('/:id/report', isLoggedIn, limits.report, async (req, res, next) => {
  try {
    const request = await Request.findById(req.params.id).select('customer');
    if (!request) {
      req.flash('error', 'Talep bulunamadı.');
      return res.redirect('/requests');
    }
    const backToRequest = '/requests/' + request._id;

    if (request.customer.toString() === req.session.user.id) {
      req.flash('error', 'Kendi talebinizi şikayet edemezsiniz.');
      return res.redirect(backToRequest);
    }
    if (!REPORT_REASONS.includes(req.body.reason)) {
      req.flash('error', 'Bir şikayet nedeni seçin.');
      return res.redirect(backToRequest);
    }

    await Report.create({
      request: request._id,
      reporter: req.session.user.id,
      reason: req.body.reason,
      note: str(req.body.note).slice(0, 500)
    });

    req.flash('success', 'Şikayetiniz alındı, teşekkürler.');
    res.redirect(backToRequest);
  } catch (err) {
    if (err.code === 11000) {
      req.flash('error', 'Bu talebi daha önce şikayet ettiniz.');
      return res.redirect('/requests/' + req.params.id);
    }
    if (err.name === 'CastError') return res.redirect('/requests');
    next(err);
  }
});

// Talep detayı
router.get('/:id', async (req, res, next) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('customer', 'name email phone createdAt')
      .lean();

    if (!request || !request.customer) return notFoundPage(res);

    const viewer = req.session.user;
    const isOwner = Boolean(viewer && viewer.id === request.customer._id.toString());
    const isAdminViewer = Boolean(viewer && viewer.isAdmin);

    // Yönetici tarafından kaldırılan talebi yalnızca sahibi ve yöneticiler görür.
    if (request.status === 'removed' && !isOwner && !isAdminViewer) return notFoundPage(res);

    if (!isOwner) {
      await Request.updateOne({ _id: request._id }, { $inc: { viewCount: 1 } });
      request.viewCount += 1;
    }

    // Talep sahibi son baktığından sonra gelen teklifleri "yeni" görür; sayfayı açınca işaret kalkar.
    let seenBefore = null;
    if (isOwner) {
      seenBefore = request.ownerSeenAt ? new Date(request.ownerSeenAt) : new Date(0);
      await Request.updateOne({ _id: request._id }, { $set: { ownerSeenAt: new Date() } }, { timestamps: false });
    }

    const canSeeBids = isOwner || isAdminViewer;
    const bidSort = ['amount', 'days', 'rating'].includes(req.query.bidSort) ? req.query.bidSort : 'amount';
    const allBids = (
      await Bid.find({ request: request._id })
        .populate('company', 'name companyName rating ratingCount email phone verified suspended createdAt')
        .sort({ amount: 1, createdAt: 1 })
        .lean()
    ).filter(bid => bid.company && !(bid.company.suspended && bid.status === 'pending'));

    if (canSeeBids) {
      if (bidSort === 'days') allBids.sort((a, b) => a.deliveryTime - b.deliveryTime);
      if (bidSort === 'rating') allBids.sort((a, b) => b.company.rating - a.company.rating);
    } else {
      // Sıralama tutarı ele vermesin diye dışarıdan bakana tarih sırasıyla gösterilir.
      allBids.sort((a, b) => a.createdAt - b.createdAt);
    }

    const userBid =
      viewer && viewer.role === 'company'
        ? allBids.find(bid => bid.company._id.toString() === viewer.id)
        : null;

    // İletişim bilgileri yalnızca teklif kabul edildikten sonra iki tarafa da gösterilir.
    const acceptedBid = allBids.find(bid => bid.status === 'accepted');
    let contact = null;
    if (acceptedBid && isOwner) {
      contact = {
        name: acceptedBid.company.companyName || acceptedBid.company.name,
        email: acceptedBid.company.email,
        phone: acceptedBid.company.phone
      };
    } else if (userBid && userBid.status === 'accepted') {
      contact = {
        name: request.customer.name,
        email: request.customer.email,
        phone: request.customer.phone
      };
    }

    const pendingBids = allBids.filter(bid => bid.status === 'pending');
    const pendingAmounts = pendingBids.map(bid => bid.amount);

    // Talep sahibi teklifleri karşılaştırsın diye öne çıkanlar; herkes eşitse işaretlenmez.
    let bidSummary = null;
    if (canSeeBids && pendingBids.length > 1) {
      const days = pendingBids.map(bid => bid.deliveryTime);
      const rated = pendingBids.filter(bid => bid.company.ratingCount > 0).map(bid => bid.company.rating);
      bidSummary = {
        count: pendingBids.length,
        lowest: Math.min(...pendingAmounts),
        average: Math.round(pendingAmounts.reduce((sum, amount) => sum + amount, 0) / pendingAmounts.length / 10) * 10,
        fastest: Math.min(...days),
        fastestTag: Math.min(...days) < Math.max(...days) ? Math.min(...days) : null,
        bestRating: rated.length > 1 && Math.max(...rated) > Math.min(...rated) ? Math.max(...rated) : null
      };
    }

    // Tutar ve açıklama yalnızca talep sahibine, yöneticiye ve teklifi verene görünür; rakip firmalar görmez.
    const bids = allBids.map(bid => {
      const company = { _id: bid.company._id, name: bid.company.name, companyName: bid.company.companyName, rating: bid.company.rating, ratingCount: bid.company.ratingCount, verified: bid.company.verified };
      if (canSeeBids || bid === userBid) return { ...bid, company, isNewBid: Boolean(seenBefore && bid.status === 'pending' && new Date(bid.createdAt) > seenBefore) };
      return { _id: bid._id, status: bid.status, createdAt: bid.createdAt, company, hidden: true };
    });

    const [similarAll, ownerOpenCount, averages, review, alreadyReported, lastBid, bidder, newerRequest, olderRequest, ownerOthers, favoriteCount] = await Promise.all([
      Request.find({ ...liveFilter(), category: request.category, _id: { $ne: request._id } })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Request.countDocuments({ ...liveFilter(), customer: request.customer._id }),
      categoryAverages(request.category),
      Review.findOne({ request: request._id, hidden: { $ne: true } }).lean(),
      viewer ? Report.exists({ request: request._id, reporter: viewer.id }) : null,
      // Firma her seferinde aynı metni baştan yazmasın.
      viewer && viewer.role === 'company' && !userBid
        ? Bid.findOne({ company: viewer.id }).sort({ createdAt: -1 }).select('description').lean()
        : null,
      viewer && viewer.role === 'company' && !userBid ? User.findById(viewer.id).select('plan bidUsage').lean() : null,
      // Önceki / sonraki talep: aynı kategoride, listedeki sırayla (en yeni başta)
      Request.findOne({ ...liveFilter(), category: request.category, createdAt: { $gt: request.createdAt } }).sort({ createdAt: 1 }).select('title').lean(),
      Request.findOne({ ...liveFilter(), category: request.category, createdAt: { $lt: request.createdAt } }).sort({ createdAt: -1 }).select('title').lean(),
      // Talep sahibinin diğer açık talepleri: firma birkaç işe birlikte teklif verebilir.
      Request.find({ ...liveFilter(), customer: request.customer._id, _id: { $ne: request._id } }).sort({ createdAt: -1 }).limit(3).select('title budget').lean(),
      // Kaç kişi favorilerine ekledi: firmalar için ilgi göstergesi
      User.countDocuments({ favorites: request._id })
    ]);

    const bidBadges = await badgesFor(allBids.map(bid => bid.company));
    res.render('requests/show', {
      bidBadges,
      title: request.title,
      fullTitle: `${request.title} - ${request.category}${request.city ? `, ${request.city}` : ''} | TeklifVer`,
      metaDescription: request.description.slice(0, 155),
      ogImage: request.images && request.images[0],
      // Bitmiş veya kaldırılmış talepler aramalarda çıkmaz.
      noIndex: request.status !== 'open' || isExpired(request),
      ownHeading: true,
      jsonLdData: {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'Talepler', item: `${res.locals.siteBase}/requests` },
          { name: request.category, item: `${res.locals.siteBase}${categoryUrl(request.category)}` },
          ...(request.city ? [{ name: request.city, item: `${res.locals.siteBase}${categoryCityUrl(request.category, request.city)}` }] : []),
          ...(request.city && request.location
            ? [{ name: request.location, item: `${res.locals.siteBase}/requests?${new URLSearchParams({ category: request.category, city: request.city, district: request.location })}` }]
            : []),
          { name: request.title }
        ].map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, ...crumb }))
      },
      request,
      bids,
      bidSort,
      userBid,
      isOwner,
      contact,
      averages,
      review,
      alreadyReported: Boolean(alreadyReported),
      reportReasons: REPORT_REASONS,
      similar: uniqueByPhoto(
        similarAll.filter(item => !item.images[0] || item.images[0] !== request.images[0]),
        5
      ),
      ownerOpenCount,
      ownerOthers,
      favoriteCount,
      newerRequest,
      olderRequest,
      canSeeBids,
      lowestAmount: canSeeBids && pendingAmounts.length > 1 ? Math.min(...pendingAmounts) : null,
      bidSummary,
      lastBidText: lastBid ? lastBid.description : '',
      allowance: bidder ? bidAllowance(bidder) : null
    });
  } catch (err) {
    if (err.name === 'CastError') return notFoundPage(res);
    next(err);
  }
});

// Sahibinin talebini getirir; değilse uyarıp yönlendirir.
async function loadOwnRequest(req, res) {
  let request = null;
  try {
    request = await Request.findById(req.params.id);
  } catch (err) {
    if (err.name !== 'CastError') throw err;
  }

  if (!request) {
    req.flash('error', 'Talep bulunamadı.');
    res.redirect('/requests');
    return null;
  }
  if (request.customer.toString() !== req.session.user.id) {
    req.flash('error', 'Bu talep üzerinde işlem yapma yetkiniz yok.');
    res.redirect('/requests/' + request._id);
    return null;
  }
  return request;
}

async function loadOwnOpenRequest(req, res) {
  const request = await loadOwnRequest(req, res);
  if (request && request.status !== 'open') {
    req.flash('error', 'Yalnızca açık talepler değiştirilebilir.');
    res.redirect('/requests/' + request._id);
    return null;
  }
  return request;
}

// Düzenleme formu
router.get('/:id/edit', isCustomer, async (req, res, next) => {
  try {
    const request = await loadOwnOpenRequest(req, res);
    if (!request) return;

    res.render('requests/edit', {
      title: 'Talebi Düzenle',
      request: request.toObject(),
      categories,
      maxImages: MAX_IMAGES,
      districtsByCity: await loadDistricts()
    });
  } catch (err) {
    next(err);
  }
});

// Talep güncelle
router.put('/:id', isCustomer, uploadImages, async (req, res, next) => {
  try {
    const request = await loadOwnOpenRequest(req, res);
    if (!request) {
      deleteImages(uploadedPaths(req));
      return;
    }

    const { values, errors, data } = parseRequestForm(req);

    const removeList = [].concat(req.body.removeImages || []);
    const removed = request.images.filter(image => removeList.includes(image));
    const kept = request.images.filter(image => !removeList.includes(image));
    const added = uploadedPaths(req);

    if (!errors.images && kept.length + added.length > MAX_IMAGES) {
      errors.images = `Bir talepte en fazla ${MAX_IMAGES} görsel olabilir.`;
    }

    if (Object.keys(errors).length) {
      deleteImages(added);
      return res.status(422).render('requests/edit', {
        title: 'Talebi Düzenle',
        request: request.toObject(),
        categories,
        maxImages: MAX_IMAGES,
        values,
        errors
      });
    }

    Object.assign(request, data, { images: [...kept, ...added] });
    await request.save();
    deleteImages(removed);

    req.flash('success', 'Talebiniz güncellendi.');
    res.redirect('/requests/' + request._id);
  } catch (err) {
    next(err);
  }
});

// Firmayı açık talebe teklif vermeye davet et
router.post('/:id/invite/:companyId', isCustomer, requireVerifiedEmail, limits.invite, async (req, res, next) => {
  const companyId = str(req.params.companyId);
  const back = mongoose.isValidObjectId(companyId) ? `/companies/${companyId}` : '/companies';
  try {
    const request = await loadOwnOpenRequest(req, res);
    if (!request) return;

    const company = mongoose.isValidObjectId(companyId)
      ? await User.findOne({ _id: companyId, role: 'company', suspended: { $ne: true } }).select('_id').lean()
      : null;
    if (!company) {
      req.flash('error', 'Firma bulunamadı.');
      return res.redirect('/companies');
    }
    if (await Bid.exists({ request: request._id, company: company._id })) {
      req.flash('error', 'Bu firma talebinize zaten teklif verdi.');
      return res.redirect(back);
    }

    // Koşullu güncelleme: aynı firma aynı talebe iki kez davet edilip bildirim yağmuruna tutulmaz.
    const invited = await Request.updateOne(
      { _id: request._id, invitedCompanies: { $ne: company._id } },
      { $addToSet: { invitedCompanies: company._id } }
    );
    if (invited.modifiedCount) {
      await notify(company._id, `Bir müşteri sizi "${request.title}" talebine teklif vermeye davet etti.`, `/requests/${request._id}`, { mail: 'matches' });
    }

    req.flash('success', 'Firma talebinize davet edildi.');
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Talebi kapat: yayından çıkar, bekleyen teklifleri reddeder.
router.post('/:id/close', isCustomer, async (req, res, next) => {
  try {
    const request = await loadOwnOpenRequest(req, res);
    if (!request) return;

    const pending = await Bid.find({ request: request._id, status: 'pending' }).select('company');
    await Bid.updateMany({ request: request._id, status: 'pending' }, { status: 'rejected' });
    request.status = 'cancelled';
    await request.save();

    await notifyMany(
      pending.map(bid => bid.company),
      `"${request.title}" talebi sahibi tarafından kapatıldı.`,
      '/requests/' + request._id,
      { mail: 'bids' }
    );

    req.flash('success', 'Talebiniz kapatıldı.');
    res.redirect('/requests/' + request._id);
  } catch (err) {
    next(err);
  }
});

// Kapanmış veya biten talebi yeni bir talep olarak yeniden yayınla
router.post('/:id/republish', isCustomer, async (req, res, next) => {
  try {
    const request = await loadOwnRequest(req, res);
    if (!request) return;

    if (!['completed', 'cancelled'].includes(request.status)) {
      req.flash('error', 'Yalnızca kapanmış veya tamamlanmış talepler yeniden yayınlanabilir.');
      return res.redirect('/requests/' + request._id);
    }

    const copy = await Request.create({
      title: request.title,
      description: request.description,
      category: request.category,
      budget: request.budget,
      city: request.city,
      location: request.location,
      images: await copyImages(request.images),
      customer: request.customer
    });

    req.flash('success', 'Talebiniz yeniden yayınlandı. Son tarih ve bilgileri güncelleyebilirsiniz.');
    res.redirect(`/requests/${copy._id}/edit`);
  } catch (err) {
    next(err);
  }
});

// Talep sil
router.delete('/:id', isCustomer, async (req, res, next) => {
  try {
    const request = await loadOwnOpenRequest(req, res);
    if (!request) return;

    const pending = await Bid.find({ request: request._id }).select('company');
    await Bid.deleteMany({ request: request._id });
    deleteImages(await Message.distinct('image', { request: request._id, image: { $nin: ['', null] } }));
    await Message.deleteMany({ request: request._id });
    await Report.deleteMany({ request: request._id });
    await User.updateMany({ favorites: request._id }, { $pull: { favorites: request._id } });
    await request.deleteOne();
    deleteImages(request.images);

    await notifyMany(pending.map(bid => bid.company), `Teklif verdiğiniz "${request.title}" talebi silindi.`, '/dashboard');

    req.flash('success', 'Talep silindi.');
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
