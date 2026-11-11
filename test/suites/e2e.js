// Uçtan uca duman testi: yerel sunucuya karşı HTTP akışını doğrular.
const BASE = process.env.BASE || 'http://localhost:3000';
const stamp = Date.now();
let failures = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures += 1;
}

function client() {
  let cookie = '';
  return async function call(path, { method = 'GET', form } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
      },
      body: form ? new URLSearchParams(form).toString() : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
}

(async () => {
  const pw = 'test-' + stamp;
  const customer = client();
  const company = client();
  const other = client();
  const guest = client();

  // Herkese açık sayfalar
  for (const path of ['/', '/requests', '/login', '/register', '/register?role=company']) {
    const r = await guest(path);
    check(`GET ${path}`, r.status === 200, String(r.status));
  }
  check('404 sayfası', (await guest('/yok')).status === 404);
  check('korumalı sayfa girişe yönlendirir', (await guest('/dashboard')).location === '/login?next=%2Fdashboard');

  // Kayıt doğrulaması
  let r = await customer('/register', { method: 'POST', form: { terms: 'on', role: 'customer', name: '', email: 'x', password: '123' } });
  check('geçersiz kayıt reddedilir', r.status === 422 && r.text.includes('Geçerli bir e-posta'));

  r = await customer('/register', { method: 'POST', form: { terms: 'on', role: 'customer', name: 'Test Müşteri', email: `Customer${stamp}@Test.local`, password: pw } });
  check('müşteri kaydı', r.status === 302 && r.location === '/dashboard', r.location);

  r = await other('/register', { method: 'POST', form: { terms: 'on', role: 'customer', name: 'Kopya', email: `customer${stamp}@test.local`, password: pw } });
  check('aynı e-posta (büyük/küçük harf farklı) reddedilir', r.status === 422 && r.text.includes('zaten kayıtlı'));

  r = await company('/register', { method: 'POST', form: { terms: 'on', role: 'company', name: 'Test Şirket', email: `company${stamp}@test.local`, password: pw } });
  check('şirket adı zorunlu', r.status === 422 && r.text.includes('Şirket adını'));
  r = await company('/register', { method: 'POST', form: { terms: 'on', role: 'company', name: 'Test Şirket', companyName: 'Acme Ltd', email: `company${stamp}@test.local`, password: pw } });
  check('şirket kaydı', r.status === 302, String(r.status));

  // Giriş / çıkış
  const session2 = client();
  r = await session2('/login', { method: 'POST', form: { email: `customer${stamp}@test.local`, password: 'yanlis-sifre' } });
  check('yanlış şifre reddedilir', r.status === 401 && r.text.includes('hatalı'));
  r = await session2('/login', { method: 'POST', form: { 'email[$ne]': 'x', 'password[$ne]': 'x' } });
  check('sorgu enjeksiyonu reddedilir', r.status === 401);
  r = await session2('/login', { method: 'POST', form: { email: `CUSTOMER${stamp}@test.local`, password: pw, next: '/requests' } });
  check('giriş + güvenli next', r.status === 302 && r.location === '/requests', r.location);
  check('GET /logout artık çıkış yaptırmaz', (await session2('/logout')).status === 404);
  r = await session2('/logout', { method: 'POST' });
  check('POST /logout', r.status === 302);
  check('çıkış sonrası oturum kapalı', (await session2('/dashboard')).status === 302);

  const session3 = client();
  r = await session3('/login', { method: 'POST', form: { email: `customer${stamp}@test.local`, password: pw, next: '//evil.example' } });
  check('açık yönlendirme engellenir', r.location === '/dashboard', r.location);

  // Talep oluşturma (multipart zorunlu olduğu için FormData)
  const multipart = async (session, path, fields) => {
    const body = new FormData();
    Object.entries(fields).forEach(([k, v]) => body.append(k, v));
    return session.raw(path, body);
  };
  const makeRaw = () => {};
  void multipart; void makeRaw;

  const cookieOf = async (email) => {
    const res = await fetch(BASE + '/login', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: pw }).toString()
    });
    return res.headers.get('set-cookie').split(';')[0];
  };
  const customerCookie = await cookieOf(`customer${stamp}@test.local`);
  const companyCookie = await cookieOf(`company${stamp}@test.local`);

  const postRequest = fields => {
    const body = new FormData();
    Object.entries(fields).forEach(([k, v]) => body.append(k, v));
    return fetch(BASE + '/requests', { method: 'POST', redirect: 'manual', headers: { cookie: customerCookie }, body });
  };

  let res = await postRequest({ title: 'Eksik', description: '', category: 'Temizlik', budgetMin: '500', budgetMax: '100' });
  let html = await res.text();
  check('geçersiz talep formu korur', res.status === 422 && html.includes('value="Eksik"') && html.includes('en fazla bütçeden'));

  const xss = '<img src=x onerror=alert(1)>';
  res = await postRequest({ title: `Ofis temizliği ${stamp}`, description: `${xss}\nİkinci satır`, category: 'Temizlik', budgetMin: '1000', budgetMax: '5000', location: 'İstanbul' });
  check('talep oluşturuldu', res.status === 302, String(res.status));
  const requestPath = res.headers.get('location');
  const requestId = requestPath.split('/').pop();

  const asCompany = (path, form) => fetch(BASE + path, {
    method: form ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie: companyCookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  const asCustomer = (path, form) => fetch(BASE + path, {
    method: form ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie: customerCookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined
  });

  html = await (await guest(requestPath)).text;
  check('açıklamadaki HTML kaçırılır (XSS yok)', !html.includes(xss) && html.includes('&lt;img src=x'));

  // Arama
  html = (await guest('/requests?search=' + encodeURIComponent(`temizliği ${stamp}`))).text;
  check('arama bulur', html.includes(requestPath));
  check('regex karakterleri hata vermez', (await guest('/requests?search=' + encodeURIComponent('(['))).status === 200);
  check('nesne arama hata vermez', (await guest('/requests?search[$ne]=x&sort=constructor&page=-3')).status === 200);

  // Müşteri teklif veremez, şirket verir
  res = await asCustomer('/bids', { requestId, amount: '100', deliveryTime: '3', description: 'x' });
  check('müşteri teklif veremez', res.status === 302 && res.headers.get('location') === '/requests');

  res = await asCompany('/bids', { requestId, amount: '-5', deliveryTime: '3', description: 'x' });
  await res.text();
  check('negatif tutar reddedilir', (await (await asCompany(requestPath)).text()).includes('Teklif Ver'));

  res = await asCompany('/bids', { requestId, amount: '3000', deliveryTime: '5', description: 'Teklif metni <b>kalın</b>' });
  check('şirket teklif verdi', res.status === 302);
  res = await asCompany('/bids', { requestId, amount: '2000', deliveryTime: '5', description: 'ikinci' });
  html = await (await asCompany(res.headers.get('location'))).text();
  check('ikinci teklif reddedilir', html.includes('zaten teklif verdiniz'));

  html = await (await asCustomer(requestPath)).text();
  check('teklif metni kaçırılır', html.includes('&lt;b&gt;kalın'));
  check('kabul öncesi iletişim gizli', !html.includes(`company${stamp}@test.local`));
  const bidId = (html.match(/\/bids\/([a-f0-9]{24})\/accept/) || [])[1];
  check('kabul butonu görünür', Boolean(bidId));

  // Başkası kabul edemez
  const otherCookie = await (async () => {
    await other('/register', { method: 'POST', form: { terms: 'on', role: 'customer', name: 'Diğer', email: `other${stamp}@test.local`, password: pw } });
    return cookieOf(`other${stamp}@test.local`);
  })();
  res = await fetch(`${BASE}/bids/${bidId}/accept`, { method: 'POST', redirect: 'manual', headers: { cookie: otherCookie } });
  html = await (await asCustomer(requestPath)).text();
  check('başkası teklifi kabul edemez', html.includes(`/bids/${bidId}/accept`));

  res = await asCustomer(`/bids/${bidId}/accept`, {});
  check('teklif kabul edildi', res.status === 302);
  html = await (await asCustomer(requestPath)).text();
  check('kabul sonrası iletişim görünür', html.includes(`company${stamp}@test.local`));
  html = await (await asCompany(requestPath)).text();
  check('şirket de iletişimi görür', html.includes(`customer${stamp}@test.local`));

  // Tamamlama iki kez puanlamaz
  await asCustomer(`/bids/complete/${requestId}`, { rating: '5' });
  await asCustomer(`/bids/complete/${requestId}`, { rating: '1' });
  html = await (await asCustomer(requestPath)).text();
  check('puan yalnızca bir kez işlenir', html.includes('5,0 (1)'), (html.match(/star-filled[\s\S]{0,400}?\((\d+)\)/) || [])[0] ? '' : 'puan bulunamadı');

  // Tamamlanan talep silinemez
  res = await fetch(`${BASE}/requests/${requestId}?_method=DELETE`, { method: 'POST', redirect: 'manual', headers: { cookie: customerCookie } });
  html = await (await asCustomer(requestPath)).text();
  check('tamamlanan talep silinemez', html.includes('Yalnızca açık talepler'));

  // Profil bilgileri silinmiyor
  await asCustomer('/profile', { name: 'Test Müşteri', phone: '05551112233', address: 'Adres 1' });
  html = await (await asCustomer('/profile')).text();
  check('profil formu mevcut bilgileri gösterir', html.includes('value="05551112233"') && html.includes('value="Adres 1"'));

  // Şifre değiştirme
  res = await asCustomer('/profile/password', { currentPassword: 'yanlis', newPassword: 'yeni-sifre-123' });
  check('yanlış mevcut şifre reddedilir', res.status === 422);
  res = await asCustomer('/profile/password', { currentPassword: pw, newPassword: 'yeni-sifre-123' });
  check('şifre değişti', res.status === 302);
  const after = client();
  r = await after('/login', { method: 'POST', form: { email: `customer${stamp}@test.local`, password: 'yeni-sifre-123' } });
  check('yeni şifreyle giriş', r.status === 302);

  // Paneller
  html = await (await asCompany('/dashboard')).text();
  check('şirket paneli', html.includes('Acme Ltd') && html.includes('3.000 TL'));
  html = await (await asCustomer('/dashboard')).text();
  check('müşteri paneli', html.includes(`Ofis temizliği ${stamp}`));

  // Oturum çerezi bayrakları
  const login = await fetch(BASE + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: `company${stamp}@test.local`, password: pw, remember: 'on' }).toString()
  });
  const flags = login.headers.get('set-cookie');
  check('çerez HttpOnly + SameSite=Lax', /HttpOnly/i.test(flags) && /SameSite=Lax/i.test(flags));
  check('beni hatırla kalıcı çerez verir', /Expires=/i.test(flags));
  const noRemember = await fetch(BASE + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: `company${stamp}@test.local`, password: pw }).toString()
  });
  check('hatırla yoksa oturum çerezi', !/Expires=/i.test(noRemember.headers.get('set-cookie')));

  // Hız sınırı en sonda: sayaç bu testi etkilemesin
  const limited = client();
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await limited('/login', { method: 'POST', form: { email: 'nobody@test.local', password: 'wrong' } });
  }
  check('art arda hatalı giriş sınırlanır', last.status === 429 && last.text.includes('Çok fazla deneme'), String(last.status));

  console.log(failures ? `\n${failures} test BAŞARISIZ` : '\nTüm testler geçti');
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
