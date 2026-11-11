const Bid = require('../models/Bid');

// Ana sayfadaki "Şu an TeklifVer'de" akışı: yalnızca gerçek kayıtlar.
// Teklif tutarı yazılmaz; talep sayfasında olduğu gibi hangi firmanın teklif verdiği herkese açıktır.
async function recentActivity({ latest = [], reviews = [], limit = 7 } = {}) {
  const bids = await Bid.find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('company', 'name companyName suspended')
    .populate('request', 'title status')
    .lean();

  const events = [
    ...bids
      .filter(bid => bid.company && !bid.company.suspended && bid.request && bid.request.status !== 'removed')
      .slice(0, 5)
      .map(bid => ({
        type: 'bid',
        who: bid.company.companyName || bid.company.name,
        verb: 'teklif verdi',
        title: bid.request.title,
        url: `/requests/${bid.request._id}`,
        at: bid.createdAt
      })),
    ...latest.slice(0, 3).map(request => ({
      type: 'request',
      who: request.city || 'Yeni',
      verb: request.city ? 'yeni talep' : 'talep',
      title: request.title,
      url: `/requests/${request._id}`,
      at: request.createdAt
    })),
    ...reviews.slice(0, 2).map(review => ({
      type: 'review',
      who: review.company.companyName || review.company.name,
      verb: `${review.rating} yıldız aldı`,
      title: review.comment,
      url: `/companies/${review.company._id}`,
      at: review.createdAt
    }))
  ];

  return {
    events: events.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit),
    lastBidAt: bids.length ? bids[0].createdAt : null
  };
}

module.exports = { recentActivity };
