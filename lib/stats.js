const Request = require('../models/Request');
const Bid = require('../models/Bid');
const { liveFilter } = require('./listing');

// Kategori menüsündeki sayılar için: { kategoriAdı: açıkTalepSayısı }
async function openCountsByCategory() {
  const rows = await Request.aggregate([
    { $match: liveFilter() },
    { $group: { _id: '$category', total: { $sum: 1 } } }
  ]);
  return Object.fromEntries(rows.map(row => [row._id, row.total]));
}

// İl -> açık taleplerde geçen ilçeler (alfabetik). Aynı ilçe farklı yazılmışsa (kadıköy/Kadıköy) bir kez görünür.
// Liste sayfasındaki ilçe seçimi ve talep formundaki ilçe önerileri bunu kullanır.
async function districtsByCity() {
  const rows = await Request.aggregate([
    { $match: { ...liveFilter(), city: { $nin: [null, ''] }, location: { $nin: [null, ''] } } },
    { $group: { _id: { city: '$city', location: '$location' } } }
  ]);
  const result = {};
  for (const { _id: row } of rows) {
    const list = (result[row.city] ||= []);
    const name = row.location.trim();
    if (name && !list.some(item => item.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) list.push(name);
  }
  Object.values(result).forEach(list => list.sort((a, b) => a.localeCompare(b, 'tr')));
  return result;
}

// Vitrinde aynı fotoğraf iki kez görünmesin; fotoğrafsız talepler bundan etkilenmez.
function uniqueByPhoto(requests, limit) {
  const seen = new Set();
  const result = [];
  for (const request of requests) {
    const photo = request.images && request.images[0];
    if (photo && seen.has(photo)) continue;
    if (photo) seen.add(photo);
    result.push(request);
    if (result.length === limit) break;
  }
  return result;
}

// Kategoride verilen tekliflerin ortalaması; az veri varsa gösterilmez.
async function categoryAverages(category) {
  const requests = await Request.find({ category }).select('_id').lean();
  const [row] = await Bid.aggregate([
    { $match: { request: { $in: requests.map(r => r._id) } } },
    { $group: { _id: null, amount: { $avg: '$amount' }, days: { $avg: '$deliveryTime' }, total: { $sum: 1 } } }
  ]);
  if (!row || row.total < 3) return null;
  return { amount: Math.round(row.amount / 100) * 100, days: Math.round(row.days), total: row.total };
}

// Firma sayfası istatistikleri
async function companyStats(companyId) {
  const bids = await Bid.find({ company: companyId }).select('status deliveryTime request createdAt').lean();
  const accepted = bids.filter(bid => bid.status === 'accepted');
  const [completed, requests] = await Promise.all([
    Request.countDocuments({ _id: { $in: accepted.map(bid => bid.request) }, status: 'completed' }),
    Request.find({ _id: { $in: bids.map(bid => bid.request) } }).select('createdAt').lean()
  ]);
  // Teklif hızı: talep açıldıktan teklife kadar geçen sürenin ortancası; en az 3 teklif varsa söylenir.
  const opened = new Map(requests.map(request => [String(request._id), new Date(request.createdAt).getTime()]));
  const waits = bids
    .filter(bid => opened.has(String(bid.request)))
    .map(bid => new Date(bid.createdAt).getTime() - opened.get(String(bid.request)))
    .filter(ms => ms >= 0);
  return {
    responseHours: waits.length >= 3 ? quantile(waits, 0.5) / 3600000 : null,
    bidTotal: bids.length,
    accepted: accepted.length,
    completed,
    lastBidAt: bids.length ? new Date(Math.max(...bids.map(bid => new Date(bid.createdAt).getTime()))) : null,
    avgDays: bids.length ? Math.round(bids.reduce((sum, bid) => sum + bid.deliveryTime, 0) / bids.length) : null
  };
}

function quantile(values, share) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * share;
  const low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}
const roundPrice = value => (value >= 10000 ? Math.round(value / 500) * 500 : Math.round(value / 100) * 100);

// Teklif dağılımı: fiyatlar katlanarak büyüdüğü için aralıklar logaritmik bölünür. Uçtaki %5'lik teklifler
// ilk ve son kutuya katılır, hiçbir teklif dışarıda kalmaz. Tek tek teklif görünmesin diye en az 5 teklif gerekir.
const DISTRIBUTION_BINS = 8;
const DISTRIBUTION_MIN = 5;
function distribution(amounts) {
  if (amounts.length < DISTRIBUTION_MIN) return null;
  const low = quantile(amounts, 0.05);
  const high = quantile(amounts, 0.95);
  if (!(low > 0) || !(high > low)) return null;
  const step = (Math.log(high) - Math.log(low)) / DISTRIBUTION_BINS;
  const counts = new Array(DISTRIBUTION_BINS).fill(0);
  for (const amount of amounts) {
    const clamped = Math.min(Math.max(amount, low), high);
    counts[Math.min(Math.floor((Math.log(clamped) - Math.log(low)) / step), DISTRIBUTION_BINS - 1)] += 1;
  }
  const edge = index => roundPrice(Math.exp(Math.log(low) + index * step));
  return { counts, bins: counts.map((count, index) => ({ count, from: edge(index), to: edge(index + 1) })), peak: Math.max(...counts) };
}

// Fiyat rehberi: kategorilere göre verilen tekliflerin özeti.
async function priceGuide() {
  const rows = await Bid.aggregate([
    { $lookup: { from: 'requests', localField: 'request', foreignField: '_id', as: 'target' } },
    { $unwind: '$target' },
    {
      $group: {
        _id: '$target.category',
        average: { $avg: '$amount' },
        lowest: { $min: '$amount' },
        highest: { $max: '$amount' },
        amounts: { $push: '$amount' },
        days: { $avg: '$deliveryTime' },
        total: { $sum: 1 }
      }
    }
  ]);
  return Object.fromEntries(
    rows.map(row => [row._id, {
      average: Math.round(row.average / 100) * 100,
      // Uç teklifler yanıltmasın: tekliflerin ortadaki yarısı
      typicalLow: roundPrice(quantile(row.amounts, 0.25)),
      typicalHigh: roundPrice(quantile(row.amounts, 0.75)),
      lowest: row.lowest,
      highest: row.highest,
      days: Math.round(row.days),
      total: row.total,
      distribution: distribution(row.amounts)
    }])
  );
}

// Hesabın eksik bilgileri; firmalar için daha fazla teklif ve güven demektir.
function profileChecklist(user) {
  const items = user.role === 'company'
    ? [
        ['Firma tanıtımı yazın', Boolean(user.companyDescription)],
        ['Logo ekleyin', Boolean(user.avatar)],
        ['Hizmet kategorilerinizi seçin', Boolean(user.categories && user.categories.length)],
        ['Hizmetlerinizi yazın', Boolean(user.specialties && user.specialties.length)],
        ['İlinizi yazın', Boolean(user.address)],
        ['Telefon ekleyin', Boolean(user.phone)]
      ]
    : [
        ['Telefon ekleyin', Boolean(user.phone)],
        ['Adresinizi yazın', Boolean(user.address)]
      ];
  const done = items.filter(([, ok]) => ok).length;
  return {
    percent: Math.round((done / items.length) * 100),
    missing: items.filter(([, ok]) => !ok).map(([label]) => label)
  };
}

module.exports = { districtsByCity, openCountsByCategory, uniqueByPhoto, categoryAverages, companyStats, priceGuide, profileChecklist };
