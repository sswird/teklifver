// Firma rozetleri yalnızca sitedeki gerçek kayıtlardan hesaplanır; elle verilmez.
const Bid = require('../models/Bid');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FAVORITE_MIN_ACCEPTED = 2;
const FAVORITE_MIN_SHARE = 0.2;
const FAST_MIN_BIDS = 3;
const FAST_WINDOW_MS = 24 * HOUR_MS;
const NEWCOMER_DAYS = 30;

// companies: _id ve createdAt alanları olan firma kayıtları. Dönen: firma kimliği -> rozet anahtarları
async function badgesFor(companies) {
  const list = (companies || []).filter(company => company && company._id);
  const result = new Map(list.map(company => [String(company._id), []]));
  if (!list.length) return result;

  const rows = await Bid.aggregate([
    { $match: { company: { $in: list.map(company => company._id) } } },
    { $lookup: { from: 'requests', localField: 'request', foreignField: '_id', as: 'target' } },
    { $unwind: '$target' },
    {
      $group: {
        _id: '$company',
        total: { $sum: 1 },
        accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
        quick: { $sum: { $cond: [{ $lte: [{ $subtract: ['$createdAt', '$target.createdAt'] }, FAST_WINDOW_MS] }, 1, 0] } }
      }
    }
  ]);
  const stats = new Map(rows.map(row => [String(row._id), row]));

  for (const company of list) {
    const key = String(company._id);
    const badges = result.get(key);
    if (badges.length) continue; // aynı firma listede iki kez olabilir
    const row = stats.get(key) || { total: 0, accepted: 0, quick: 0 };
    if (row.accepted >= FAVORITE_MIN_ACCEPTED && row.accepted / row.total >= FAVORITE_MIN_SHARE) badges.push('favorite');
    if (row.total >= FAST_MIN_BIDS && row.quick / row.total > 0.5) badges.push('fast');
    if (company.createdAt && Date.now() - new Date(company.createdAt).getTime() < NEWCOMER_DAYS * DAY_MS) badges.push('newcomer');
  }
  return result;
}

module.exports = { badgesFor };
