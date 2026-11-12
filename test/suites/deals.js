// Anlaşma iptali, teklif gizliliği, davet, yorum cevabı, kayıtlı arama bildirimi ve yönetim ekranları.
const { client, reporter, MINI_PNG } = require('../helpers/harness');

const BASE = process.env.BASE;
const { check, finish } = reporter();
const stamp = Date.now();
const pw = 'test-sifre-' + stamp;
const body = (html, pattern) => (html.match(pattern) || [])[1];

async function signup(fields) {
  const c = client(BASE);
  const res = await c.post('/register', { password: pw, terms: 'on', ...fields });
  if (res.status !== 302) throw new Error(`kayıt başarısız: ${fields.email} ${res.status}`);
  return c;
}

async function newRequest(c, fields) {
  const form = new FormData();
  Object.entries({ description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', ...fields }).forEach(([k, v]) => form.set(k, v));
  const res = await c.form('/requests', form);
  if (res.status !== 302) throw new Error(`talep oluşmadı: ${res.status} ${body(res.text, /field-error">([^<]+)/)}`);
  return res.location;
}

(async () => {
  const owner = await signup({ role: 'customer', name: 'Ayşe Demir Kaya', email: `ayse${stamp}@test.local` });
  const firmA = await signup({ role: 'company', name: 'Ali', companyName: `Alfa ${stamp}`, email: `alfa${stamp}@test.local` });
  const firmB = await signup({ role: 'company', name: 'Veli', companyName: `Beta ${stamp}`, email: `beta${stamp}@test.local` });
  const guest = client(BASE);
  const admin = client(BASE);
  await admin.post('/login', { email: 'yonetici@teklifver.test', password: 'demo1234' });

  // Tarih doğrulama
  let form = new FormData();
  Object.entries({ title: 'Geçmiş tarihli talep', description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', deadline: '2020-01-01' }).forEach(([k, v]) => form.set(k, v));
  let res = await owner.form('/requests', form);
  check('geçmiş son tarih reddedilir', res.status === 422 && res.text.includes('geçmiş bir gün'));
  form = new FormData();
  Object.entries({ title: 'Yanlış tarihli talep', description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', deadline: '2030-02-31' }).forEach(([k, v]) => form.set(k, v));
  res = await owner.form('/requests', form);
  check('olmayan tarih reddedilir', res.status === 422 && res.text.includes('Geçerli bir tarih'));
  form = new FormData();
  Object.entries({ title: 'Uzun açıklamalı talep', description: 'a'.repeat(5001), category: 'Temizlik' }).forEach(([k, v]) => form.set(k, v));
  check('çok uzun açıklama reddedilir', (await owner.form('/requests', form)).status === 422);

  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const path = await newRequest(owner, { title: `Anlaşma ${stamp}`, deadline: future, city: 'İzmir', budgetMax: '5000' });
  const requestId = path.split('/').pop();
  check('son tarih Türkiye saatiyle aynı gün', (await owner.get(`${path}/edit`)).text.includes(`value="${future}"`));

  // Teklifler ve gizlilik
  await firmA.post('/bids', { requestId, amount: '3210', deliveryTime: '5', description: `gizli-a-${stamp}` });
  await firmB.post('/bids', { requestId, amount: '4567', deliveryTime: '7', description: `gizli-b-${stamp}` });
  res = await firmA.post('/bids', { requestId, amount: '99999999999', deliveryTime: '5', description: 'tavan' });
  const anon = (await guest.get(path)).text;
  check('misafir tutarı görmez', !anon.includes('3.210') && !anon.includes('4.567'));
  check('misafir açıklamayı görmez', !anon.includes(`gizli-a-${stamp}`));
  check('misafir firma adlarını görür', anon.includes(`Alfa ${stamp}`) && anon.includes('Gizli'));
  const rival = (await firmB.get(path)).text;
  check('firma kendi teklifini görür', rival.includes(`gizli-b-${stamp}`) && rival.includes('4.567'));
  check('firma rakibin tutarını görmez', !rival.includes('3.210') && !rival.includes(`gizli-a-${stamp}`));
  const ownerView = (await owner.get(path)).text;
  check('sahip tüm teklifleri görür', ownerView.includes('3.210') && ownerView.includes('4.567') && ownerView.includes(`gizli-b-${stamp}`));
  check('yönetici tüm teklifleri görür', (await admin.get(path)).text.includes(`gizli-a-${stamp}`));

  // Soyadı gizleme
  check('misafirde soyadı kısalır', anon.includes('Ayşe K.') && !anon.includes('Ayşe Demir Kaya'));
  check('sahip adını tam görür', ownerView.includes('Ayşe Demir Kaya'));

  const bidIds = [...ownerView.matchAll(/\/bids\/([a-f0-9]{24})\/accept/g)].map(m => m[1]);
  const firstBid = bidIds[0];
  const secondBid = bidIds[1];
  check('iki teklif var', bidIds.length === 2);

  // Kabul, sonra iptal
  await owner.post(`/bids/${firstBid}/accept`);
  check('kabul sonrası iptal düğmesi', (await owner.get(path)).text.includes('Anlaşmayı İptal Et'));
  check('firmada işi bırak düğmesi', (await firmA.get(path)).text.includes('İşi Bırak'));
  res = await firmB.post(`/bids/${firstBid}/cancel`);
  check('ilgisiz firma iptal edemez', (await firmB.get(res.location)).text.includes('yetkiniz yok'));
  res = await guest.post(`/bids/${firstBid}/cancel`);
  check('misafir iptal edemez', res.location.startsWith('/login'));
  check('anlaşma sürerken iletişim görünür', (await firmA.get(path)).text.includes(`ayse${stamp}@test.local`));

  res = await owner.post(`/bids/${firstBid}/cancel`);
  const afterCancel = (await owner.get(path)).text;
  check('iptal sonrası talep açık', afterCancel.includes('Yayında') && afterCancel.includes('yeniden yayında'));
  check('iptal sonrası iletişim kapanır', !(await firmA.get(path)).text.includes(`ayse${stamp}@test.local`));
  check('elenen teklif yeniden bekliyor', (await firmB.get(path)).text.includes('Beklemede'));
  check('iptal edilen teklif etiketi', (await firmA.get(path)).text.includes('Anlaşma iptal'));
  check('firmaya bildirim gider', (await firmA.get('/notifications')).text.includes('anlaşma, talep sahibi tarafından iptal'));
  check('iptal edilmiş teklif tekrar kabul edilemez', (await owner.get((await owner.post(`/bids/${firstBid}/accept`)).location)).text.includes('kabul edilemez'));

  // Firma işi bırakır
  await owner.post(`/bids/${secondBid}/accept`);
  await firmB.post(`/bids/${secondBid}/cancel`);
  check('firma bırakınca talep sahibine bildirim', (await owner.get('/notifications')).text.includes('işini bıraktı'));
  check('firma bırakınca talep açık', (await guest.get(`/requests?search=Anlaşma ${stamp}`)).text.includes(path));

  // Tamamlama ve sonradan yorum
  const reviewPath = await newRequest(owner, { title: `Yorum ${stamp}` });
  const reviewId = reviewPath.split('/').pop();
  await firmA.post('/bids', { requestId: reviewId, amount: '100', deliveryTime: '1', description: 'x' });
  const reviewBid = body((await owner.get(reviewPath)).text, /\/bids\/([a-f0-9]{24})\/accept/);
  await owner.post(`/bids/${reviewBid}/accept`);
  await owner.post(`/bids/complete/${reviewId}`, {});
  check('puan vermeden tamamlanır', (await owner.get(reviewPath)).text.includes('Firmayı Değerlendirin'));
  check('başkası yorum yazamaz', (await (async () => {
    const other = await signup({ role: 'customer', name: 'Başka Kişi', email: `baska${stamp}@test.local` });
    const r = await other.post(`/bids/review/${reviewId}`, { rating: '1' });
    return (await other.get(r.location)).text;
  })()).includes('yorum yazılamaz'));
  await owner.post(`/bids/review/${reviewId}`, { rating: '4', comment: `güzel iş ${stamp}` });
  const firmId = body((await firmA.get('/dashboard')).text, /\/companies\/([a-f0-9]{24})/);
  let firmPage = (await guest.get(`/companies/${firmId}`)).text;
  check('sonradan yorum yayında', firmPage.includes(`güzel iş ${stamp}`));
  check('puan yorumdan hesaplanır', firmPage.includes('<strong>4,0</strong> (1 değerlendirme)'));
  check('yorumda soyadı kısalır', firmPage.includes('Ayşe K.') && !firmPage.includes('Ayşe Demir Kaya'));
  res = await owner.post(`/bids/review/${reviewId}`, { rating: '1' });
  check('ikinci yorum olmaz', (await owner.get(res.location)).text.includes('zaten değerlendirdiniz'));

  // Firma cevabı
  const reviewDoc = body((await firmA.get(`/companies/${firmId}`)).text, /\/companies\/reviews\/([a-f0-9]{24})\/reply/);
  check('firma cevap formu görür', Boolean(reviewDoc));
  check('misafir cevap formu görmez', !firmPage.includes('/reply'));
  await firmB.post(`/companies/reviews/${reviewDoc}/reply`, { reply: 'korsan cevap' });
  check('başka firma cevap yazamaz', !(await guest.get(`/companies/${firmId}`)).text.includes('korsan cevap'));
  await firmA.post(`/companies/reviews/${reviewDoc}/reply`, { reply: `teşekkürler ${stamp}` });
  check('cevap yayında', (await guest.get(`/companies/${firmId}`)).text.includes(`teşekkürler ${stamp}`));

  // Davet
  const invitePath = await newRequest(owner, { title: `Davet ${stamp}` });
  const inviteId = invitePath.split('/').pop();
  firmPage = (await owner.get(`/companies/${firmId}`)).text;
  check('müşteri davet formu görür', firmPage.includes('Bu Firmadan Teklif İsteyin') && firmPage.includes(`Davet ${stamp}`));
  await owner.post(`/requests/${inviteId}/invite/${firmId}`);
  check('firmaya davet bildirimi', (await firmA.get('/notifications')).text.includes(`Davet ${stamp}`));
  check('davet edilen talep listeden düşer', !(await owner.get(`/companies/${firmId}`)).text.includes(`Davet ${stamp}`));
  const before = ((await firmA.get('/notifications')).text.match(/teklif vermeye davet/g) || []).length;
  await owner.post(`/requests/${inviteId}/invite/${firmId}`);
  check('ikinci davet bildirim üretmez', ((await firmA.get('/notifications')).text.match(/teklif vermeye davet/g) || []).length === before);
  res = await firmB.post(`/requests/${inviteId}/invite/${firmId}`);
  check('firma davet gönderemez', res.location === '/requests');

  // Kayıtlı arama bildirimi
  await firmB.post('/dashboard/searches', { query: `search=${encodeURIComponent(`bahçe${stamp}`)}` });
  await newRequest(owner, { title: `Eşleşmeyen ${stamp}`, category: 'Diğer' });
  await new Promise(r => setTimeout(r, 300));
  check('uymayan talep bildirim üretmez', !(await firmB.get('/notifications')).text.includes(`Eşleşmeyen ${stamp}`));
  await newRequest(owner, { title: `Bahçe${stamp} düzenleme`, category: 'Diğer' });
  await new Promise(r => setTimeout(r, 500));
  check('uyan talep bildirim üretir', (await firmB.get('/notifications')).text.includes(`düzenleme`));

  // Sayaç
  res = await firmB.get('/notifications/count');
  check('sayaç çalışır', typeof JSON.parse(res.text).notifications === 'number');
  check('misafir sayaç alamaz', (await guest.get('/notifications/count')).status === 302);

  // Firma şikayeti
  res = await firmB.post(`/companies/${firmId}/report`, { reason: 'Diğer', note: `şikayet ${stamp}` });
  check('firma şikayet edilir', (await firmB.get(res.location)).text.includes('Şikayetiniz alındı'));
  res = await firmB.post(`/companies/${firmId}/report`, { reason: 'Diğer' });
  check('ikinci şikayet olmaz', (await firmB.get(res.location)).text.includes('daha önce'));
  res = await firmA.post(`/companies/${firmId}/report`, { reason: 'Diğer' });
  check('kendini şikayet edemez', (await firmA.get(res.location)).text.includes('Kendi firmanızı'));
  check('yönetici şikayeti görür', (await admin.get('/admin')).text.includes(`şikayet ${stamp}`));

  // İletişim mesajı yönetim panelinde
  await guest.post('/iletisim', { name: 'Ziyaretçi', email: 'z@z.co', subject: 'Öneri', message: `merhaba ${stamp}` });
  let inbox = (await admin.get('/admin/messages')).text;
  check('mesaj panelde', inbox.includes(`merhaba ${stamp}`));
  check('misafir paneli göremez', (await guest.get('/admin/messages')).status === 302);
  check('konu önceden seçilir', (await guest.get('/iletisim?konu=Reklam')).text.includes('value="Reklam" selected'));

  // Yorum gizleme puanı değiştirir
  const adminReview = body((await admin.get('/admin/reviews')).text, new RegExp(`/admin/reviews/([a-f0-9]{24})/toggle[\\s\\S]*`));
  check('yorum listesi çalışır', Boolean(adminReview));
  await admin.post(`/admin/reviews/${reviewDoc}/toggle`);
  firmPage = (await guest.get(`/companies/${firmId}`)).text;
  check('gizlenen yorum görünmez', !firmPage.includes(`güzel iş ${stamp}`) && firmPage.includes('Henüz değerlendirme yok'));
  await admin.post(`/admin/reviews/${reviewDoc}/toggle`);
  check('geri alınan yorum görünür', (await guest.get(`/companies/${firmId}`)).text.includes(`güzel iş ${stamp}`));

  // Kaldırılan işlemdeki talep önceki duruma döner
  const progressPath = await newRequest(owner, { title: `İşlemde ${stamp}` });
  const progressId = progressPath.split('/').pop();
  await firmA.post('/bids', { requestId: progressId, amount: '100', deliveryTime: '1', description: 'x' });
  const progressBid = body((await owner.get(progressPath)).text, /\/bids\/([a-f0-9]{24})\/accept/);
  await owner.post(`/bids/${progressBid}/accept`);
  await admin.post(`/admin/requests/${progressId}/remove`);
  check('kaldırılan talep 404', (await guest.get(progressPath)).status === 404);
  await admin.post(`/admin/requests/${progressId}/restore`);
  check('geri alınca işlemde kalır', (await guest.get(progressPath)).text.includes('İşlemde</'));

  // Askı: müşterinin açık talepleri gizlenir, kalkınca döner
  const suspendedUser = await signup({ role: 'customer', name: 'Askı Kişi', email: `aski${stamp}@test.local` });
  const suspendedPath = await newRequest(suspendedUser, { title: `Askılı ${stamp}` });
  const userId = body((await admin.get(`/admin/users?search=${encodeURIComponent(`aski${stamp}`)}`)).text, /\/admin\/users\/([a-f0-9]{24})\/suspend/);
  await admin.post(`/admin/users/${userId}/suspend`);
  check('askıda talep gizli', (await guest.get(suspendedPath)).status === 404);
  await admin.post(`/admin/users/${userId}/suspend`);
  check('askı kalkınca talep döner', (await guest.get(suspendedPath)).status === 200);

  // İşi alan firma hesabını silerse talep yeniden açılır, puan da güncellenir
  const leaving = await signup({ role: 'company', name: 'Giden', companyName: `Giden ${stamp}`, email: `giden${stamp}@test.local` });
  const stuckPath = await newRequest(owner, { title: `Kilit ${stamp}` });
  const stuckId = stuckPath.split('/').pop();
  await leaving.post('/bids', { requestId: stuckId, amount: '100', deliveryTime: '1', description: 'x' });
  const stuckBid = body((await owner.get(stuckPath)).text, /\/bids\/([a-f0-9]{24})\/accept/);
  await owner.post(`/bids/${stuckBid}/accept`);
  await leaving.post('/profile/delete', { password: pw });
  check('firma silinince talep yeniden açık', (await owner.get(stuckPath)).text.includes('Yayında'));
  check('sahibe haber verilir', (await owner.get('/notifications')).text.includes('sitemizden ayrıldı'));

  const rater = await signup({ role: 'customer', name: 'Puan Veren', email: `puan${stamp}@test.local` });
  const ratedPath = await newRequest(rater, { title: `Puanlı ${stamp}` });
  const ratedId = ratedPath.split('/').pop();
  await firmB.post('/bids', { requestId: ratedId, amount: '100', deliveryTime: '1', description: 'x' });
  const ratedBid = body((await rater.get(ratedPath)).text, /\/bids\/([a-f0-9]{24})\/accept/);
  await rater.post(`/bids/${ratedBid}/accept`);
  await rater.post(`/bids/complete/${ratedId}`, { rating: '5', comment: 'iyi' });
  const firmBId = body((await firmB.get('/dashboard')).text, /\/companies\/([a-f0-9]{24})/);
  check('firma puanı oluşur', (await guest.get(`/companies/${firmBId}`)).text.includes('(1 değerlendirme)'));
  await rater.post('/profile/delete', { password: pw });
  check('müşteri silinince firma puanı güncellenir', (await guest.get(`/companies/${firmBId}`)).text.includes('Henüz değerlendirme yok'));

  // Şifre değişince eski oturumlar kapanır
  const device1 = await signup({ role: 'customer', name: 'İki Cihaz', email: `cihaz${stamp}@test.local` });
  const device2 = client(BASE);
  await device2.post('/login', { email: `cihaz${stamp}@test.local`, password: pw });
  check('ikinci cihaz açık', (await device2.get('/dashboard')).status === 200);
  await device1.post('/profile/password', { currentPassword: pw, newPassword: `${pw}-yeni` });
  check('şifre değişince diğer cihaz kapanır', (await device2.get('/dashboard')).status === 302);
  check('şifreyi değiştiren oturum açık kalır', (await device1.get('/dashboard')).status === 200);
  await device2.post('/login', { email: `cihaz${stamp}@test.local`, password: `${pw}-yeni` });
  await device1.post('/profile/sessions');
  check('diğer cihazlardan çıkış', (await device2.get('/dashboard')).status === 302);
  check('kendi oturumu kalır', (await device1.get('/dashboard')).status === 200);

  // Profil doğrulama
  res = await firmA.post('/profile', { name: 'Ali', companyName: `Alfa ${stamp}`, address: 'Mars', phone: '' });
  check('firma ili listeden seçilir', res.status === 422 && res.text.includes('Listeden bir il'));
  res = await owner.post('/profile', { name: 'Ayşe Demir Kaya', phone: 'telefon-degil' });
  check('geçersiz telefon', res.status === 422 && res.text.includes('Geçerli bir telefon'));

  // İş örnekleri
  form = new FormData();
  form.append('images', new Blob([MINI_PNG], { type: 'image/png' }), 'is.png');
  await firmA.form('/profile/portfolio', form);
  firmPage = (await guest.get(`/companies/${firmId}`)).text;
  const work = body(firmPage, /href="(\/uploads\/[^"]+\.webp)"/);
  check('iş örneği firma sayfasında', firmPage.includes('İş Örnekleri (1)') && Boolean(work));
  check('küçük sürüm kullanılır', firmPage.includes(work.replace('.webp', '_t.webp')));
  check('iş örneği açılır', (await guest.get(work)).status === 200);
  form = new FormData();
  form.append('images', new Blob([MINI_PNG], { type: 'image/png' }), 'is.png');
  res = await owner.form('/profile/portfolio', form);
  check('müşteri iş örneği ekleyemez', (await owner.get(res.location)).text.includes('yalnızca firma'));
  await firmA.post('/profile/portfolio/delete', { image: work });
  await new Promise(r => setTimeout(r, 200));
  check('iş örneği silinir', (await guest.get(work)).status === 404);
  check('küçük sürüm de silinir', (await guest.get(work.replace('.webp', '_t.webp'))).status === 404);

  // Reklam yönetimi
  check('reklam sayfası', (await admin.get('/admin/ads')).status === 200);
  form = new FormData();
  Object.entries({ title: 'Kötü', url: 'javascript:alert(1)', color: 'navy' }).forEach(([k, v]) => form.set(k, v));
  res = await admin.form('/admin/ads', form);
  check('güvensiz reklam adresi reddedilir', res.status === 422);
  form = new FormData();
  Object.entries({ title: `Satılan ${stamp}`, text: 'Metin', url: 'https://example.com/kampanya', color: 'green', cta: 'Git' }).forEach(([k, v]) => form.set(k, v));
  res = await admin.form('/admin/ads', form);
  check('reklam eklenir', res.status === 302);
  const adPanel = (await admin.get('/admin/ads')).text;
  const adId = body(adPanel, /\/admin\/ads\/([a-f0-9]{24})\/toggle/);
  check('reklam önce gösterilir', (await guest.get('/requests')).text.includes(`Satılan ${stamp}`));
  res = await guest.get(`/reklam-tik/${adId}`);
  check('tıklama hedefe gider', res.location === 'https://example.com/kampanya');
  check('tıklama sayılır', /col-date">1<\/td>\s*<td style="width:150px"/.test((await admin.get('/admin/ads')).text));
  await admin.post(`/admin/ads/${adId}/toggle`);
  check('durdurulan reklam çıkmaz', !(await guest.get('/requests')).text.includes(`Satılan ${stamp}`));
  await admin.post(`/admin/ads/${adId}/delete`);
  check('reklam silinir', !(await admin.get('/admin/ads')).text.includes(`Satılan ${stamp}`));
  check('olmayan reklam ana sayfaya', (await guest.get('/reklam-tik/abc')).location === '/');
  check('reklamı misafir ekleyemez', (await guest.post('/admin/ads', {})).location.startsWith('/login'));

  // Yeni sayfalar
  for (const page of ['/hakkimizda', '/firmalar-icin', '/guvenli-hizmet', '/veri-silme', '/manifest.webmanifest', '/icon-192.png', '/img/paylasim.png']) {
    check(`sayfa ${page}`, (await guest.get(page)).status === 200);
  }
  const home = (await guest.get('/')).text;
  check('canonical', home.includes('<link rel="canonical"'));
  check('json-ld', home.includes('application/ld+json') && home.includes('SearchAction'));
  check('paylaşım görseli mutlak', /og:image" content="http/.test(home));
  check('sürümlü css', /\/css\/style\.css\?v=[a-f0-9]{10}/.test(home));
  const categoryPage = (await guest.get(`/requests?category=${encodeURIComponent('Temizlik')}&sort=views`)).text;
  check('kategori canonical sadeleşir', /<link rel="canonical" href="[^"?]*\/hizmet\/temizlik">/.test(categoryPage));
  check('firma json-ld', (await guest.get(`/companies/${firmId}`)).text.includes('"LocalBusiness"'));

  // Örnek verileri silme
  res = await admin.post('/admin/demo/remove');
  check('örnek veriler silinir', res.status === 302);
  check('örnek firma gitti', !(await guest.get('/companies')).text.includes('Demir Tadilat'));
  check('gerçek firma kaldı', (await guest.get('/companies')).text.includes(`Alfa ${stamp}`));
  check('örnek veri notu kalkar', !(await guest.get('/')).text.includes('örnek veridir'));

  finish();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
