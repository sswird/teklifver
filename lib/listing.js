const categories = require('../config/categories');
const cities = require('../config/cities');
const { str } = require('./input');
const { searchPatterns, matchesText } = require('../public/js/search-terms');

const DAY_MS = 24 * 60 * 60 * 1000;

const SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  budget_high: { 'budget.max': -1, createdAt: -1 },
  budget_low: { 'budget.min': 1, createdAt: -1 },
  deadline: { deadline: 1, createdAt: -1 },
  bids: { bidCount: -1, createdAt: -1 },
  views: { viewCount: -1, createdAt: -1 }
};

// Yer adı ön eki ("kad" -> Kadıköy); harf büyüklüğü ve Türkçe i/ı/İ/I farkı önemsenmez.
const placePrefixSource = text => `^${String(text).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[iıİI]/g, '[iıİI]')}`;

// İlçe adı tam eşleşir; harf büyüklüğü ve Türkçe i/ı/İ/I farkı önemsenmez.
const districtSource = name => `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[iıİI]/g, '[iıİI]')}$`;

const positiveNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

// Yayında olan ve son tarihi geçmemiş talepler
const liveFilter = () => ({
  status: 'open',
  $or: [{ deadline: null }, { deadline: { $gte: new Date() } }]
});

// Adres satırındaki filtreleri güvenli değerlere çevirir.
function readFilters(query) {
  return {
    search: str(query.search),
    category: categories.names.includes(query.category) ? query.category : 'all',
    city: cities.includes(query.city) ? query.city : '',
    district: str(query.district).slice(0, 60),
    budgetMin: positiveNumber(query.budgetMin),
    budgetMax: positiveNumber(query.budgetMax),
    period: ['1', '7', '30'].includes(query.period) ? query.period : '',
    photos: query.photos === 'on',
    noBids: query.noBids === 'on',
    urgent: query.urgent === 'on',
    sort: Object.hasOwn(SORT_OPTIONS, query.sort) ? query.sort : 'newest',
    view: query.view === 'gallery' ? 'gallery' : 'list'
  };
}

function buildConditions(filters) {
  const conditions = [liveFilter()];
  if (filters.category !== 'all') conditions.push({ category: filters.category });
  if (filters.city) conditions.push({ city: filters.city });
  if (filters.district) conditions.push({ location: { $regex: districtSource(filters.district), $options: 'i' } });
  if (filters.budgetMin) {
    conditions.push({
      $or: [{ 'budget.max': { $gte: filters.budgetMin } }, { 'budget.min': { $gte: filters.budgetMin } }]
    });
  }
  if (filters.budgetMax) conditions.push({ 'budget.min': { $lte: filters.budgetMax } });
  if (filters.period) {
    conditions.push({ createdAt: { $gte: new Date(Date.now() - Number(filters.period) * DAY_MS) } });
  }
  if (filters.photos) conditions.push({ 'images.0': { $exists: true } });
  if (filters.noBids) conditions.push({ bidCount: 0 });
  // Acil: sahibi acil dedi ya da son tarihe bir hafta kalmadı (helpers.isUrgent ile aynı kural)
  if (filters.urgent) {
    const now = new Date();
    conditions.push({ $or: [{ isUrgent: true }, { deadline: { $gte: now, $lte: new Date(now.getTime() + 7 * DAY_MS) } }] });
  }
  if (filters.search) {
    const words = searchPatterns(filters.search).map(pattern => {
      const regex = { $regex: pattern, $options: 'i' };
      return { $or: [{ title: regex }, { description: regex }, { category: regex }, { location: regex }, { city: regex }] };
    });
    if (/^\d{6,}$/.test(filters.search)) conditions.push({ $or: [{ no: Number(filters.search) }, ...words] });
    else conditions.push(...words);
  }
  return { $and: conditions };
}

// Yeni talepten haberdar edilecek firmalar: hizmet ili seçmeyen tüm Türkiye'ye bakar.
const firmsServing = city =>
  (city ? { $or: [{ serviceCities: { $size: 0 } }, { serviceCities: { $exists: false } }, { serviceCities: city }] } : {});

// Firmanın baktığı iller; ili belirtilmemiş talepler herkese görünür.
const requestsInArea = firm =>
  (firm.serviceCities && firm.serviceCities.length ? { city: { $in: [...firm.serviceCities, null, ''] } } : {});

// Yeni talebin kayıtlı aramaya uyup uymadığına bakar (buildConditions ile aynı kurallar).
function matchesFilters(request, filters) {
  const min = (request.budget && request.budget.min) || 0;
  const max = (request.budget && request.budget.max) || 0;
  if (filters.category !== 'all' && request.category !== filters.category) return false;
  if (filters.city && request.city !== filters.city) return false;
  if (filters.district && !new RegExp(districtSource(filters.district), 'i').test(request.location || '')) return false;
  if (filters.budgetMin && max < filters.budgetMin && min < filters.budgetMin) return false;
  if (filters.budgetMax && min > filters.budgetMax) return false;
  if (filters.photos && !(request.images && request.images.length)) return false;
  if (filters.urgent) {
    const left = request.deadline ? new Date(request.deadline).getTime() - Date.now() : null;
    if (!request.isUrgent && !(left !== null && left > 0 && left <= 7 * DAY_MS)) return false;
  }
  if (filters.search) {
    if (!matchesText(filters.search, [request.title, request.description, request.category, request.location, request.city])) return false;
  }
  return true;
}

// Filtreleri adres metnine çevirir; sayfa ve görünüm kayıtlı aramaya dahil edilmez.
function filtersToQuery(filters) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.category !== 'all') params.set('category', filters.category);
  if (filters.city) params.set('city', filters.city);
  if (filters.district) params.set('district', filters.district);
  if (filters.budgetMin) params.set('budgetMin', filters.budgetMin);
  if (filters.budgetMax) params.set('budgetMax', filters.budgetMax);
  if (filters.period) params.set('period', filters.period);
  if (filters.photos) params.set('photos', 'on');
  if (filters.noBids) params.set('noBids', 'on');
  if (filters.urgent) params.set('urgent', 'on');
  return params.toString();
}

// Kayıtlı arama için okunabilir ad
function describeFilters(filters) {
  const parts = [];
  if (filters.search) parts.push(`"${filters.search}"`);
  if (filters.category !== 'all') parts.push(filters.category);
  if (filters.city) parts.push(filters.city);
  if (filters.district) parts.push(filters.district);
  if (filters.budgetMin) parts.push(`en az ${filters.budgetMin} TL`);
  if (filters.budgetMax) parts.push(`en çok ${filters.budgetMax} TL`);
  if (filters.photos) parts.push('fotoğraflı');
  if (filters.noBids) parts.push('teklif almamış');
  if (filters.urgent) parts.push('acil');
  return parts.join(', ').slice(0, 100) || 'Tüm talepler';
}

module.exports = { placePrefixSource, SORT_OPTIONS, liveFilter, readFilters, buildConditions, matchesFilters, filtersToQuery, describeFilters, firmsServing, requestsInArea };
