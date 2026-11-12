// Firma hizmet illeri, akıllı arama, talep formu, teklif karşılaştırma ve iletişim düğmeleri.
const BASE = process.env.BASE || 'http://localhost:3000';
const stamp = Date.now();
const pw = `eslesme-${stamp}`;
let failures = 0;
let passed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) passed += 1; else failures += 1;
};

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
const encode = data => new URLSearchParams(Object.entries(data).flatMap(([key, value]) => [].concat(value).map(item => [key, item]))).toString();
const signup = async fields => {
  const res = await fetch(`${BASE}/register`, { method: 'POST', redirect: 'manual', headers: formHeaders, body: encode({ ...fields, password: pw, terms: 'on' }) });
  if (res.status !== 302) throw new Error(`kayıt ${fields.email} ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
};
const get = async (cookie, path) => {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};
const post = (cookie, path, data = {}) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { ...formHeaders, cookie }, body: encode(data) });
const newRequest = async (cookie, fields) => {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const res = await fetch(`${BASE}/requests`, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form });
  return res.headers.get('location');
};
const unread = html => Number((html.match(/Bildirimler <span class="unread-count"[^>]*>(\d+)/) || [])[1] || 0);
const resultCount = html => Number((html.match(/<strong>(\d+)<\/strong> talep bulundu/) || [])[1] || 0);
const search = async term => get(null, `/requests?search=${encodeURIComponent(term)}`);

(async () => {
  const owner = await signup({ role: 'customer', name: 'Eşleşme Müşteri', email: `em${stamp}@test.local` });
  const makeFirm = async (key, serviceCities) => {
    const name = `Firma ${key} ${stamp}`;
    const cookie = await signup({ role: 'company', name, companyName: name, email: `f${key}${stamp}@test.local` });
    await post(cookie, '/profile', { name, companyName: name, categories: 'Temizlik', serviceCities });
    const page = await get(cookie, '/dashboard');
    const id = (page.text.match(/\/companies\/([a-f0-9]{24})/) || [])[1];
    return { cookie, name, id };
  };

  // Hizmet illeri
  const izmir = await makeFirm('izmir', ['İzmir', 'Mars']);
  const everywhere = await makeFirm('tum', []);
  const ankara = await makeFirm('ankara', ['Ankara']);

  const profile = (await get(izmir.cookie, '/profile')).text;
  check('hizmet ili kaydedilir', /value="İzmir" checked/.test(profile));
  check('listede olmayan il kaydedilmez', !profile.includes('Mars'));

  const before = async () => Promise.all([izmir, everywhere, ankara].map(async firm => unread((await get(firm.cookie, '/')).text)));
  const start = await before();
  const inIzmir = await newRequest(owner, { title: `İzmir temizlik ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', city: 'İzmir' });
  const afterIzmir = await before();
  check('İzmir talebi İzmir firmasına gider', afterIzmir[0] === start[0] + 1);
  check('İzmir talebi her yere bakan firmaya gider', afterIzmir[1] === start[1] + 1);
  check('İzmir talebi Ankara firmasına gitmez', afterIzmir[2] === start[2]);

  const inAnkara = await newRequest(owner, { title: `Ankara temizlik ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', city: 'Ankara' });
  const afterAnkara = await before();
  check('Ankara talebi İzmir firmasına gitmez', afterAnkara[0] === afterIzmir[0]);
  check('Ankara talebi Ankara firmasına gider', afterAnkara[2] === afterIzmir[2] + 1);

  const noCity = await newRequest(owner, { title: `İlsiz temizlik ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik' });
  const afterNoCity = await before();
  check('ili belirtilmeyen talep herkese gider', afterNoCity.every((count, index) => count === afterAnkara[index] + 1));

  const matches = (await get(izmir.cookie, '/dashboard/matches')).text;
  check('uygun taleplerde kendi ili var', matches.includes(inIzmir) && matches.includes(noCity));
  check('uygun taleplerde başka il yok', !matches.includes(inAnkara));
  check('hangi ile bakıldığı yazar', matches.includes('İzmir için gösteriliyor'));
  check('istenirse tüm iller görünür', (await get(izmir.cookie, '/dashboard/matches?all=1')).text.includes(inAnkara));
  check('il seçmeyen firma hepsini görür', (await get(everywhere.cookie, '/dashboard/matches')).text.includes(inAnkara));

  check('firma rehberinde hizmet iliyle bulunur', (await get(null, `/companies?city=${encodeURIComponent('Ankara')}&search=${encodeURIComponent(ankara.name)}`)).text.includes('<strong>1</strong> firma bulundu'));
  check('başka ilde çıkmaz', (await get(null, `/companies?city=${encodeURIComponent('Bursa')}&search=${encodeURIComponent(ankara.name)}`)).text.includes('<strong>0</strong> firma bulundu'));
  check('firma sayfasında hizmet bölgesi', (await get(null, `/companies/${izmir.id}`)).text.includes('İzmir'));
  check('il seçmeyen firma tüm Türkiye', (await get(null, `/companies/${everywhere.id}`)).text.includes('Tüm Türkiye'));

  // Akıllı arama
  await newRequest(owner, { title: `Salon boya ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'İnşaat & Tadilat', city: 'Ankara' });
  check('boyacı boyayı bulur', (await search('boyacı')).text.includes(`Salon boya ${stamp}`));
  check('ek almış kelime kökünü bulur', resultCount((await search('mutfağı')).text) > 0);
  check('kelime sırası önemli değil', resultCount((await search('eve evden')).text) === resultCount((await search('evden eve')).text) && resultCount((await search('evden eve')).text) > 0);
  check('dolgu kelimeler aramayı bozmaz', (await search('boya yaptırmak istiyorum')).text.includes(`Salon boya ${stamp}`));
  check('eş anlamlı kelimeler bulunur', resultCount((await search('nakliyeci')).text) >= resultCount((await search('nakliyat')).text) && resultCount((await search('nakliyat')).text) > 0);
  check('kategori adıyla da bulunur', (await search('temizlik')).text.includes('Koltuk yıkama'));
  check('özel karakter hata vermez', (await search('(.*[')).status === 200);
  check('talep önerisi eklere dayanır', (await (await fetch(`${BASE}/requests/suggest?q=${encodeURIComponent('boyacı')}`)).json()).items.length > 0);

  const none = (await search('xyzqwe')).text;
  check('sonuç yoksa talep vermeye yönlendirir', none.includes('için açık talep bulunamadı') && none.includes('/requests/new?title=xyzqwe'));
  check('firmaya talep ver önerilmez', !(await get(izmir.cookie, '/requests?search=xyzqwe')).text.includes('Bu İş İçin Talep Ver'));

  const filtered = (await get(null, `/requests?search=boya&city=${encodeURIComponent('Ankara')}`)).text;
  check('seçili filtreler görünür', (filtered.match(/class="filter-chip"/g) || []).length === 2 && filtered.includes('Tümünü temizle'));
  check('filtre kaldırma bağlantısı doğru', filtered.includes('href="/requests?search=boya"'));
  check('filtre yoksa etiket yok', /id="filterChips"\s+hidden/.test((await get(null, '/requests')).text));

  // Kayıtlı arama da aynı kuralla eşleşir
  await post(izmir.cookie, '/dashboard/searches', { query: 'search=boyacı' });
  const beforeAlert = unread((await get(izmir.cookie, '/')).text);
  await newRequest(owner, { title: `Daire boya işi ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'İnşaat & Tadilat' });
  await new Promise(resolve => setTimeout(resolve, 400));
  check('kayıtlı arama eklere dayanır', unread((await get(izmir.cookie, '/')).text) === beforeAlert + 1);

  // Talep formu
  const guessed = (await get(owner, `/requests/new?title=${encodeURIComponent('2+1 daire boyanacak')}`)).text;
  check('başlıktan kategori tahmin edilir', /value="İnşaat &amp; Tadilat"[^>]*selected/.test(guessed));
  check('tahmin edildiği söylenir', /id="categoryGuess"\s*>/.test(guessed));
  const chosen = (await get(owner, `/requests/new?category=Temizlik&city=${encodeURIComponent('Ankara')}`)).text;
  check('hizmet sayfasından kategori ve il gelir', /value="Temizlik"[^>]*selected/.test(chosen) && chosen.includes('value="Ankara" selected'));
  check('seçilen kategoride tahmin notu yok', /id="categoryGuess"\s+hidden/.test(chosen));
  check('geçersiz kategori yok sayılır', !/selected/.test((await get(owner, '/requests/new?category=Yok')).text.split('id="category"')[1].split('</select>')[0].replace(/disabled selected/, '')));
  check('kategorinin teklif aralığı forma gelir', /data-price="[\d. -]+TL"/.test(chosen));

  const landing = (await get(null, '/hizmet/temizlik')).text;
  check('hizmet sayfasında sorulacaklar', landing.includes('Firmaya Bunları Sorun') && landing.includes('Malzeme sizden mi?'));
  check('hizmet sayfasında örnek talep', landing.includes('Örnek Talep') && landing.includes('Taşınmadan önce 3+1 ev temizliği'));
  check('hizmet sayfası formu hazır açar', landing.includes('/requests/new?category=Temizlik'));

  // Teklif karşılaştırma
  const compare = await newRequest(owner, { title: `Karşılaştırma ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', city: 'Ankara', deadline: '2099-01-01' });
  const compareId = compare.split('/').pop();
  check('ilk teklifte metin önerilmez', !(await get(everywhere.cookie, compare)).text.includes('Son teklif metnimi kullan'));
  await post(everywhere.cookie, '/bids', { requestId: compareId, amount: '4000', deliveryTime: '5', description: `Malzeme dahil ${stamp}` });
  await post(ankara.cookie, '/bids', { requestId: compareId, amount: '3000', deliveryTime: '9', description: 'Ucuz teklif' });
  const ownerView = (await get(owner, compare)).text;
  check('teklif özeti görünür', ownerView.includes('bid-summary') && ownerView.includes('3.000 TL') && ownerView.includes('3.500 TL') && ownerView.includes('5 gün'));
  check('en düşük ve en hızlı işaretlenir', ownerView.includes('En düşük') && ownerView.includes('En hızlı'));
  const guestView = (await get(null, compare)).text;
  check('dışarıdan özet görünmez', !guestView.includes('bid-summary') && !guestView.includes('En hızlı') && guestView.includes('Gizli'));

  const again = await newRequest(owner, { title: `İkinci iş ${stamp}`, description: 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.', category: 'Temizlik', city: 'Ankara' });
  check('sonraki teklifte son metin önerilir', (await get(everywhere.cookie, again)).text.includes(`data-fill-text="Malzeme dahil ${stamp}"`));

  // Talep sayfası
  check('açıklama bilgi tablosundan önce', ownerView.indexOf('detail-desc') < ownerView.indexOf('info-table') && ownerView.includes('Ayrıntıları keşifte konuşalım'));
  check('son tarihe kalan süre yazar', /\d+ gün(<\/span>)? kaldı/.test(guestView) && guestView.includes('data-deadline='));
  check('talep sahibi adımları görür', ownerView.includes('request-steps') && ownerView.includes('2 teklif geldi'));
  check('ziyaretçi adımları görmez', !guestView.includes('request-steps'));

  // İletişim düğmeleri: en düşük teklif (Ankara firması) kabul edilir
  await post(ankara.cookie, '/profile', { name: ankara.name, companyName: ankara.name, phone: '0555 123 45 67', categories: 'Temizlik', serviceCities: 'Ankara' });
  await post(owner, '/profile', { name: 'Eşleşme Müşteri', phone: '+90 216 555 44 33' });
  const acceptId = ownerView.match(/\/bids\/([a-f0-9]{24})\/accept/)[1];
  await post(owner, `/bids/${acceptId}/accept`);
  const ownerAfter = (await get(owner, compare)).text;
  check('cepte arama ve WhatsApp çıkar', ownerAfter.includes('tel:+905551234567') && ownerAfter.includes('https://wa.me/905551234567?text='));
  check('numara okunaklı yazılır', ownerAfter.includes('0555 123 45 67'));
  const firmAfter = (await get(ankara.cookie, compare)).text;
  check('sabit hatta yalnızca arama çıkar', firmAfter.includes('tel:+902165554433') && !firmAfter.includes('wa.me/90216'));
  check('sabit hat okunaklı yazılır', firmAfter.includes('0216 555 44 33'));
  check('kabul sonrası adım işaretlenir', /is-done">Firma seçildi/.test(ownerAfter));
  check('ziyaretçi numarayı görmez', !(await get(null, compare)).text.includes('tel:+90'));

  // Firma sayfası sayacı
  const viewsOf = async firm => Number(((await get(firm.cookie, '/dashboard')).text.match(/Firma sayfanız <strong>(\d+)<\/strong>/) || [])[1]);
  const firstViews = await viewsOf(izmir);
  await get(null, `/companies/${izmir.id}`);
  await get(owner, `/companies/${izmir.id}`);
  await get(izmir.cookie, `/companies/${izmir.id}`);
  check('firma sayfası sayacı başkalarını sayar', (await viewsOf(izmir)) === firstViews + 2, String(await viewsOf(izmir)));
  check('firma sayfasında son teklif zamanı', (await get(null, `/companies/${everywhere.id}`)).text.includes('Son teklif:'));

  console.log(failures ? `\n${failures} test BAŞARISIZ, ${passed} geçti` : `\nTüm testler geçti (${passed})`);
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
