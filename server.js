require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const mongoose = require('mongoose');
const connectDatabase = require('./config/db');
const { closeDatabase } = connectDatabase;
const { serveImage } = require('./middleware/upload');
const { seedDemoData, demoAccounts } = require('./config/demo');
const Request = require('./models/Request');
const Message = require('./models/Message');
const Notification = require('./models/Notification');
const User = require('./models/User');
const ads = require('./config/ads');
const site = require('./config/site');
const icon = require('./lib/icons');
const helpers = require('./lib/helpers');
const { JOBS: popularJobs } = require('./lib/price-board');
const { visibleProviders } = require('./lib/oauth');
const { siteUrl, configuredUrl } = require('./lib/url');
const { verificationRequired, isEnabled: mailEnabled, checkConnection } = require('./lib/mailer');
const { loadActiveAds, countImpression } = require('./lib/ad-store');

const isProduction = process.env.NODE_ENV === 'production';

// CSS ve JS adreslerine eklenir; dosya değişince tarayıcı eski sürümü kullanmaz.
function assetVersion() {
  const hash = crypto.createHash('sha1');
  for (const file of ['css/theme.css', 'css/style.css', 'js/main.js', 'js/theme.js']) hash.update(fs.readFileSync(path.join(__dirname, 'public', file)));
  return hash.digest('hex').slice(0, 10);
}

// SESSION_SECRET yoksa ya da zayıfsa sabit bir metne düşülmez; depodaki bir metin herkesçe bilinir.
// Veritabanı adresinden türetilen anahtar her açılışta aynı kalır ve dışarıdan tahmin edilemez.
function ensureSessionSecret() {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length >= 32 && secret !== 'buraya-uzun-ve-rastgele-bir-metin-yazin') return;
  process.env.SESSION_SECRET = process.env.MONGODB_URI
    ? crypto.createHash('sha256').update(`teklifver-oturum:${process.env.MONGODB_URI}`).digest('hex')
    : crypto.randomBytes(32).toString('hex');
  if (isProduction || secret) {
    console.warn('  Uyarı: SESSION_SECRET eksik ya da kısa; yerine güvenli bir anahtar üretildi. En az 32 karakterlik rastgele bir SESSION_SECRET tanımlayın.');
  }
}

async function start() {
  ensureSessionSecret();
  if (isProduction) checkProductionSettings();

  await connectDatabase();
  // Canlıda varsayılan olarak örnek veri yoktur. DEMO_DATA=showcase ile, girilemeyen hesaplarla
  // dolu bir vitrin açılabilir; yönetim panelinden tek düğmeyle silinir.
  const showcase = isProduction && process.env.DEMO_DATA === 'showcase';
  const hasDemoData = (!isProduction || showcase) && (await seedDemoData({ showcase }));
  await Request.assignMissingNumbers();

  // Doğrulama eklenmeden önce açılmış hesaplar doğrulanmış sayılır; yeni hesaplarda alan her zaman vardır.
  await User.updateMany({ emailVerified: { $exists: false } }, { emailVerified: true });

  // .env içindeki adres yönetici yapılır. Doğrulama açıksa adresin sahibi olduğu kanıtlanmış olmalı.
  if (process.env.ADMIN_EMAIL) {
    await User.updateOne(
      {
        email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
        ...(verificationRequired() ? { emailVerified: true } : {})
      },
      { isAdmin: true }
    );
  }
  checkConnection();

  const app = express();

  // Barındırma servisinin önündeki vekil sunucu sayısı; gerçek ziyaretçi IP'si ve https buradan anlaşılır.
  if (isProduction) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  Object.assign(app.locals, helpers, {
    icon,
    site,
    // Alt bilgideki "Çok arananlar" satırı: fiyat panosundaki işler
    popularJobs,
    demoActive: hasDemoData,
    // Tek tıkla giriş düğmeleri yalnızca geliştirmede görünür.
    demoAccounts: hasDemoData && !isProduction ? demoAccounts : [],
    socialProviders: visibleProviders(),
    siteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
    assetVersion: assetVersion()
  });

  // Güvenlik başlıkları: yalnızca sitenin kendi betik ve görselleri çalışır.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null
        }
      },
      hsts: isProduction,
      // "no-referrer" olursa tarayıcı kendi sitesindeki formlarda da Origin: null gönderir.
      referrerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(compression());

  // Dosya adresleri sürüm numarası taşıdığı için uzun süre önbellekte kalabilir.
  const staticOptions = { maxAge: isProduction ? '30d' : 0 };
  app.use(express.static(path.join(__dirname, 'public'), staticOptions));

  // Sunucunun ayakta olduğunu ve veritabanına bağlı olduğunu barındırma servisine bildirir.
  app.get('/healthz', (req, res) => {
    const healthy = mongoose.connection.readyState === 1;
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'veritabani-yok' });
  });

  // Oturum hata verse bile hata sayfası çizilebilsin diye varsayılanlar önce atanır.
  const setPageDefaults = (req, res) => {
    const base = siteUrl(req);
    Object.assign(res.locals, {
      currentUser: null,
      currentPath: req.path,
      currentUrl: req.originalUrl,
      pageUrl: `${base}${req.originalUrl}`,
      siteBase: base,
      canonicalUrl: `${base}${req.path === '/' ? '/' : req.path.replace(/\/+$/, '')}`,
      favoriteIds: [],
      unreadMessages: 0,
      unreadNotifications: 0,
      needsEmailVerification: false,
      metaDescription: '',
      ogImage: '',
      noIndex: false,
      jsonLdData: null,
      success: [],
      error: [],
      errors: {},
      values: {}
    });

    // Aynı sayfada reklam tekrar etmesin diye her istekte karışık sırayla verilir.
    // Satılan reklamlar önce gelir; alan kalırsa sitenin kendi reklamları gösterilir.
    const shuffle = list => [...list].sort(() => Math.random() - 0.5);
    const queue = [...shuffle(req.app.locals.managedAds || []), ...shuffle(ads.filter(ad => req.app.locals.demoActive || !ad.demo))];
    let position = 0;
    res.locals.nextAd = () => {
      if (!queue.length) return null;
      const ad = queue[position++ % queue.length];
      countImpression(ad);
      return ad;
    };
  };
  app.use(async (req, res, next) => {
    app.locals.managedAds = await loadActiveAds();
    setPageDefaults(req, res);
    next();
  });

  // Tek IP'den gelen aşırı isteği keser; statik dosyalar ve sağlık kontrolü bunun dışındadır.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).render('error', {
          title: 'Çok fazla istek',
          code: 429,
          message: 'Kısa sürede çok fazla istek yapıldı. Lütfen biraz bekleyip tekrar deneyin.'
        })
    })
  );

  // Başka sitelerden gönderilen formları reddeder (CSRF). Tarayıcı, kaynağı bu başlıklarla bildirir.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Sec-Fetch-Site tarayıcı tarafından yazılır, sayfa değiştiremez; varsa kesin bilgi odur.
    // Eski tarayıcılarda Origin'e bakılır: "null" değerini saldırgan sayfa da üretebildiği için kabul edilmez.
    const fetchSite = req.get('sec-fetch-site');
    const origin = req.get('origin');
    let crossSite = false;
    if (fetchSite) {
      crossSite = !['same-origin', 'none'].includes(fetchSite);
    } else if (origin) {
      try {
        crossSite = new URL(origin).host !== req.get('host');
      } catch {
        crossSite = true;
      }
    }
    if (!crossSite) return next();
    res.status(403).render('error', {
      title: 'İstek reddedildi',
      code: 403,
      message: 'Bu istek başka bir siteden geldiği için güvenlik nedeniyle reddedildi.'
    });
  });

  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(methodOverride('_method'));

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      // Aynı veritabanı bağlantısı kullanılır; okuma başına yazma yapılmaması için oturum saatte bir yenilenir.
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        dbName: mongoose.connection.name,
        ttl: 7 * 24 * 60 * 60,
        touchAfter: 60 * 60
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax', // başka sitelerden gelen POST isteklerine çerez eklenmez
        secure: 'auto'
      }
    })
  );

  app.use(flash());

  // Tarayıcı yönlendirmeyi başlıkları alır almaz izler. Oturum o ana kadar veritabanına yazılmamışsa
  // kullanıcı girişten hemen sonra çıkış yapmış görünür, uyarı mesajları kaybolur.
  app.use((req, res, next) => {
    const redirect = res.redirect.bind(res);
    res.redirect = (...args) => {
      const hasData = req.session && Object.keys(req.session).some(key => key !== 'cookie');
      if (!hasData) return redirect(...args);
      req.session.save(err => {
        if (err) console.error('Oturum kaydedilemedi:', err.message);
        redirect(...args);
      });
    };
    next();
  });

  // Hesap silinmiş veya askıya alınmışsa açık oturum da kapanır; yönetici yetkisi güncel tutulur.
  app.use(async (req, res, next) => {
    if (!req.session.user) return next();
    try {
      const account = await User.findById(req.session.user.id).select('suspended isAdmin sessionVersion emailVerified').lean();
      // Şifre değiştiyse başka cihazlardaki eski oturumlar da kapanır.
      const staleSession = account && (account.sessionVersion || 0) !== (req.session.user.sv || 0);
      if (!account || account.suspended || staleSession) {
        delete req.session.user;
        return next();
      }
      req.session.user.isAdmin = Boolean(account.isAdmin);
      req.session.user.emailVerified = account.emailVerified !== false;
      res.locals.needsEmailVerification = verificationRequired() && !req.session.user.emailVerified;
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.favoriteIds = (req.session.user && req.session.user.favorites) || [];
    // Boş okuma her ziyaretçi için gereksiz oturum açmasın diye yalnızca mesaj varsa okunur.
    if (req.session.flash) {
      res.locals.success = req.flash('success');
      res.locals.error = req.flash('error');
    }
    next();
  });

  // Üst menüdeki okunmamış sayıları
  app.use(async (req, res, next) => {
    if (!req.session.user) return next();
    try {
      const id = req.session.user.id;
      [res.locals.unreadMessages, res.locals.unreadNotifications] = await Promise.all([
        Message.countDocuments({ receiver: id, read: false }),
        Notification.countDocuments({ user: id, read: false })
      ]);
      next();
    } catch (err) {
      next(err);
    }
  });

  app.get('/uploads/:name', serveImage);
  app.use('/', require('./routes/home'));
  app.use('/', require('./routes/pages'));
  app.use('/', require('./routes/seo'));
  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/oauth'));
  app.use('/', require('./routes/email'));
  app.use('/requests', require('./routes/requests'));
  app.use('/companies', require('./routes/companies'));
  app.use('/messages', require('./routes/messages'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/bids', require('./routes/bids'));
  app.use('/dashboard', require('./routes/dashboard'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('error', {
      title: 'Sayfa bulunamadı',
      code: 404,
      message: 'Bu sayfa taşınmış olmalı. Nakliyecilere de sorduk, yeni adresini bilen çıkmadı.'
    });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (!res.locals.nextAd) setPageDefaults(req, res);

    // Bozuk adres, çok büyük form gibi istemci hataları sunucu hatası sayılmaz.
    const status = err.status || err.statusCode;
    if (status >= 400 && status < 500) {
      return res.status(status).render('error', {
        title: status === 413 ? 'İçerik çok büyük' : 'Geçersiz istek',
        code: status,
        message: status === 413 ? 'Gönderdiğiniz içerik izin verilen boyutu aşıyor.' : 'Bu istek işlenemedi. Adresi kontrol edip tekrar deneyin.'
      });
    }

    console.error(err.stack);
    res.status(500).render('error', {
      title: 'Bir sorun oluştu',
      code: 500,
      message: 'Beklenmeyen bir hata oldu. Lütfen biraz sonra tekrar deneyin.'
    });
  });

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`  TeklifVer hazır: http://localhost:${PORT}`);
  });

  // Barındırma servisi yeniden başlatırken açık istekler yarıda kesilmesin.
  if (isProduction) {
    process.once('SIGTERM', () => {
      server.close(() => closeDatabase().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 10000).unref();
    });
  }
}

// Canlıda güvensiz bir ayarla açılmayı engeller, eksik özellikleri günlüğe yazar.
function checkProductionSettings() {
  // E-postalardaki bağlantılar istekteki alan adından üretilirse sahte adrese yönlendirilebilir.
  // Render bu adresi kendisi verir (RENDER_EXTERNAL_URL); başka bir serviste SITE_URL yazılmalı.
  if (!configuredUrl()) throw new Error('SITE_URL tanımlı olmalı (ör. https://alanadiniz.com).');
  if (!mailEnabled()) console.warn('  Uyarı: SMTP tanımlı değil; şifre sıfırlama ve bildirim e-postaları gönderilemez.');
  if (!process.env.SITE_EMAIL) console.warn('  Uyarı: SITE_EMAIL tanımlı değil; iletişim mesajları yalnızca yönetim panelinde görünür.');
  if (!visibleProviders().length) console.warn('  Uyarı: Sosyal giriş anahtarı tanımlı değil; butonlar gizlendi.');
}

start().catch(err => {
  console.error('Sunucu başlatılamadı:', err.message);
  process.exit(1);
});
