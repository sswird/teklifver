const express = require('express');
const mongoose = require('mongoose');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const Message = require('../models/Message');
const Request = require('../models/Request');
const User = require('../models/User');
const Bid = require('../models/Bid');
const { isLoggedIn, requireVerifiedEmail } = require('../middleware/auth');
const { str } = require('../lib/input');
const { formatDateTime } = require('../lib/helpers');
const { notify } = require('../lib/notify');
const Notification = require('../models/Notification');
const { uploadMessageImage, deleteImages } = require('../middleware/upload');

const { MAX_MESSAGE_LENGTH } = Message;
const objectId = id => new mongoose.Types.ObjectId(id);

// Bir kullanıcının art arda çok sayıda mesaj atmasını engeller.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => req.session.user.id,
  handler: (req, res) => {
    req.flash('error', 'Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin.');
    res.redirect(`/messages/${req.params.requestId}/${req.params.userId}`);
  }
});

const pairFilter = (requestId, a, b) => ({
  request: requestId,
  $or: [
    { sender: a, receiver: b },
    { sender: b, receiver: a }
  ]
});

// Konuşmayı yükler; kurallara uymuyorsa null döner.
// Konuşma her zaman talep sahibi ile bir firma arasındadır:
// firma açık talebin sahibine yazabilir, talep sahibi kendisine teklif vermiş firmaya yazabilir.
async function loadThread(req) {
  const { requestId, userId } = req.params;
  const viewer = req.session.user;

  if (!mongoose.isValidObjectId(requestId) || !mongoose.isValidObjectId(userId)) return null;
  if (userId === viewer.id) return null;

  const [request, other] = await Promise.all([
    Request.findById(requestId).select('no title category status budget city location images customer').lean(),
    User.findById(userId).select('name companyName role').lean()
  ]);
  if (!request || !other) return null;

  const ownerId = request.customer.toString();
  const viewerIsOwner = ownerId === viewer.id;
  if (!viewerIsOwner && ownerId !== userId) return null;

  const companyRole = viewerIsOwner ? other.role : viewer.role;
  if (companyRole !== 'company') return null;

  const companyId = viewerIsOwner ? userId : viewer.id;
  const [bid, hasHistory] = await Promise.all([
    Bid.findOne({ request: requestId, company: companyId }).select('amount deliveryTime status').lean(),
    Message.exists(pairFilter(requestId, viewer.id, userId))
  ]);

  const allowed = viewerIsOwner
    ? bid || hasHistory
    : request.status === 'open' || bid || hasHistory;

  return allowed ? { request, other, bid } : null;
}

function denyThread(req, res) {
  req.flash('error', 'Bu konuşmaya erişiminiz yok.');
  res.redirect('/messages');
}

const markRead = (requestId, senderId, receiverId) =>
  Message.updateMany({ request: requestId, sender: senderId, receiver: receiverId, read: false }, { read: true });

// Gelen kutusu: talep ve kişi başına bir satır
router.get('/', isLoggedIn, async (req, res, next) => {
  try {
    const me = objectId(req.session.user.id);

    const threads = await Message.aggregate([
      { $match: { $or: [{ sender: me }, { receiver: me }] } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            request: '$request',
            other: { $cond: [{ $eq: ['$sender', me] }, '$receiver', '$sender'] }
          },
          last: { $first: '$$ROOT' },
          unread: {
            $sum: { $cond: [{ $and: [{ $eq: ['$receiver', me] }, { $eq: ['$read', false] }] }, 1, 0] }
          }
        }
      },
      { $sort: { 'last.createdAt': -1 } },
      { $limit: 100 }
    ]);

    const [requests, people] = await Promise.all([
      Request.find({ _id: { $in: threads.map(t => t._id.request) } }).select('title no images').lean(),
      User.find({ _id: { $in: threads.map(t => t._id.other) } }).select('name companyName').lean()
    ]);
    const byId = list => new Map(list.map(item => [item._id.toString(), item]));
    const requestMap = byId(requests);
    const peopleMap = byId(people);

    res.render('messages/index', {
      title: 'Mesajlarım',
      section: 'messages',
      threads: threads
        .map(thread => ({
          request: requestMap.get(thread._id.request.toString()),
          other: peopleMap.get(thread._id.other.toString()),
          last: thread.last,
          unread: thread.unread,
          mine: thread.last.sender.equals(me)
        }))
        .filter(thread => thread.request && thread.other)
    });
  } catch (err) {
    next(err);
  }
});

// Konuşma sayfası
router.get('/:requestId/:userId', isLoggedIn, async (req, res, next) => {
  try {
    const thread = await loadThread(req);
    if (!thread) return denyThread(req, res);

    const { requestId, userId } = req.params;
    const me = req.session.user.id;

    const { modifiedCount } = await markRead(requestId, userId, me);
    res.locals.unreadMessages = Math.max(0, res.locals.unreadMessages - modifiedCount);

    // Konuşma açıldıysa bu konuşmanın bildirimi de okunmuş sayılır.
    const cleared = await Notification.updateMany(
      { user: me, url: `/messages/${requestId}/${userId}`, read: false },
      { read: true }
    );
    res.locals.unreadNotifications = Math.max(0, res.locals.unreadNotifications - cleared.modifiedCount);

    const messages = await Message.find(pairFilter(requestId, me, userId))
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.render('messages/show', {
      title: 'Mesajlarım',
      section: 'messages',
      request: thread.request,
      other: thread.other,
      bid: thread.bid,
      messages: messages.reverse(),
      maxLength: MAX_MESSAGE_LENGTH
    });
  } catch (err) {
    next(err);
  }
});

// Sayfa açıkken yeni mesajları alır
router.get('/:requestId/:userId/new', isLoggedIn, async (req, res, next) => {
  try {
    const thread = await loadThread(req);
    if (!thread) return res.status(403).json({ messages: [] });

    const { requestId, userId } = req.params;
    const me = req.session.user.id;
    const after = str(req.query.after);

    const filter = pairFilter(requestId, me, userId);
    if (mongoose.isValidObjectId(after)) filter._id = { $gt: objectId(after) };

    const messages = await Message.find(filter).sort({ _id: 1 }).limit(50).lean();
    await markRead(requestId, userId, me);

    res.json({
      messages: messages.map(message => ({
        id: message._id,
        mine: message.sender.toString() === me,
        content: message.content,
        image: message.image || '',
        time: formatDateTime(message.createdAt)
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Mesaj gönder (isteğe bağlı bir fotoğrafla)
router.post('/:requestId/:userId', isLoggedIn, requireVerifiedEmail, sendLimiter, uploadMessageImage, async (req, res, next) => {
  const uploaded = (req.files || []).map(file => '/uploads/' + file.filename);
  // Mesaj kaydedilmezse yüklenen fotoğraf veritabanında sahipsiz kalmasın.
  const discard = () => deleteImages(uploaded);
  try {
    const thread = await loadThread(req);
    if (!thread) {
      discard();
      return denyThread(req, res);
    }

    const { requestId, userId } = req.params;
    const content = str(req.body.content);
    const backToThread = `/messages/${requestId}/${userId}`;

    if (req.uploadError) {
      req.flash('error', req.uploadError);
      return res.redirect(backToThread);
    }
    if (!content && !uploaded.length) {
      req.flash('error', 'Boş mesaj gönderilemez.');
      return res.redirect(backToThread);
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      discard();
      req.flash('error', `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`);
      return res.redirect(backToThread);
    }

    await Message.create({
      request: requestId,
      sender: req.session.user.id,
      receiver: userId,
      content,
      image: uploaded[0] || ''
    });

    // Art arda mesajlarda bildirim yığılmasın: okunmamış bildirim varsa yenisi açılmaz.
    const threadForReceiver = `/messages/${requestId}/${req.session.user.id}`;
    if (!(await Notification.exists({ user: userId, url: threadForReceiver, read: false }))) {
      const sender = req.session.user.companyName || req.session.user.name;
      await notify(userId, `${sender} size mesaj gönderdi: "${thread.request.title}"`, threadForReceiver, { mail: 'messages' });
    }

    res.redirect(backToThread);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
