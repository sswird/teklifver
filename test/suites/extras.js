// Firma paketleri ve aylık teklif hakkı, soru-cevap, mesajda fotoğraf, ilan kalitesi, kaldırılan sahte uçlar.
const { MINI_PNG } = require('../helpers/harness');

const BASE = process.env.BASE || 'http://localhost:3000';
const stamp = Date.now();
const pw = `ekler-${stamp}`;
const FILLER = 'Ayrıntıları keşifte konuşalım, hafta içi uygunum.';
let failures = 0;
let passed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) passed += 1; else failures += 1;
};

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
const encode = data => new URLSearchParams(Object.entries(data)).toString();
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
const signup = async fields => {
  const res = await fetch(`${BASE}/register`, { method: 'POST', redirect: 'manual', headers: formHeaders, body: encode({ ...fields, password: pw, terms: 'on' }) });
  if (res.status !== 302) throw new Error(`kayıt ${fields.email} ${res.status}`);
  return cookieOf(res);
};
const login = async (email, password) => {
  const res = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: formHeaders, body: encode({ email, password }) });
  if (res.status !== 302) throw new Error(`giriş ${email} ${res.status}`);
  return cookieOf(res);
};
const get = async (cookie, path) => {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};
const post = async (cookie, path, data = {}) => {
  const res = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { ...formHeaders, ...(cookie ? { cookie } : {}) }, body: encode(data) });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};
const sendForm = async (cookie, path, fields, file) => {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  if (file) form.append('images', new Blob([MINI_PNG], { type: 'image/png' }), file);
  const res = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};
const newRequest = async (cookie, fields) => (await sendForm(cookie, '/requests', fields)).location;
const idOf = path => path.split('/').pop();

(async () => {
  const owner = await signup({ role: 'customer', name: 'Ek Müşteri', email: `ek${stamp}@test.local` });
  const stranger = await signup({ role: 'customer', name: 'Yabancı Müşteri', email: `eky${stamp}@test.local` });
  const firm = await signup({ role: 'company', name: 'Ek Firma', companyName: `Ek Firma ${stamp}`, email: `ekf${stamp}@test.local` });
  const rival = await signup({ role: 'company', name: 'Rakip Firma', companyName: `Rakip Firma ${stamp}`, email: `ekr${stamp}@test.local` });

  // İlan kalitesi
  let res = await sendForm(owner, '/requests', { title: 'ghgfn', description: 'sss', category: 'Temizlik' });
  check('anlamsız başlık reddedilir', res.status === 422 && res.text.includes('Başlıkta işi birkaç kelimeyle'));
  res = await sendForm(owner, '/requests', { title: 'Ev temizliği yapılacak', description: 'Temizlik', category: 'Temizlik' });
  check('kısa açıklama reddedilir', res.status === 422 && res.text.includes('en az 20 karakter'));
  res = await sendForm(owner, '/requests', { title: 'Ev temizliği yapılacak', description: FILLER, category: 'Temizlik', discoveryTime: 'Her zaman' });
  check('listede olmayan keşif zamanı reddedilir', res.status === 422 && res.text.includes('Listeden bir seçenek'));

  const path = await newRequest(owner, { title: `Acil ev temizliği ${stamp}`, description: FILLER, category: 'Temizlik', isUrgent: 'on', isFeatured: 'on', discoveryTime: 'Hafta sonu herhangi bir saat' });
  const detail = (await get(null, path)).text;
  check('acil etiketi görünür', detail.includes('label label-urgent'));
  check('keşif zamanı görünür', detail.includes('Hafta sonu herhangi bir saat'));
  check('vitrin işareti formdan alınmaz', !detail.includes('VİTRİN') && !(await get(null, '/requests')).text.includes('VİTRİN'));

  // Ziyaretçi talebini hesap açmadan yazar; hesap son adımda istenir
  const guestForm = await get(null, "/requests/new?title=" + encodeURIComponent("2+1 daire boyanacak"));
  check("ziyaretçi talep formunu açar", guestForm.status === 200 && guestForm.text.includes("Önce işinizi yazın") && guestForm.text.includes(">Devam Et<"));
  check("ziyaretçiye fotoğraf alanı sonra gelir", !guestForm.text.includes("id=\"images\""));
  const guestPost = await fetch(BASE + "/requests", { method: "POST", redirect: "manual", body: (() => { const f = new FormData(); Object.entries({ title: `Ziyaretçi talebi ${stamp}`, description: FILLER, category: "Temizlik", city: "Ankara" }).forEach(([k, v]) => f.append(k, v)); return f; })() });
  const guestCookie = cookieOf(guestPost);
  check("ziyaretçi talebi kayda yönlenir", guestPost.status === 302 && guestPost.headers.get("location") === "/register?next=%2Frequests%2Fnew");
  check("ziyaretçi talebi yayına girmez", (await get(null, `/requests?search=${encodeURIComponent("Ziyaretçi talebi " + stamp)}`)).text.includes("için açık talep bulunamadı"));
  const joined = await fetch(BASE + "/register", { method: "POST", redirect: "manual", headers: { ...formHeaders, cookie: guestCookie }, body: encode({ role: "customer", name: "Yeni Müşteri", email: `ekz${stamp}@test.local`, password: pw, terms: "on", next: "/requests/new" }) });
  check("kayıt sonrası forma döner", joined.status === 302 && joined.headers.get("location") === "/requests/new");
  const restored = await get(cookieOf(joined), "/requests/new");
  check("yazdığı talep hazır gelir", restored.text.includes(`value="Ziyaretçi talebi ${stamp}"`) && restored.text.includes("Yazdığınız talep burada") && restored.text.includes(">Talebi Yayınla<"));
  check("firma talep formunu açamaz", (await get(firm, "/requests/new")).location === "/requests");

  // Kaldırılan sahte uçlar
  check('sahte fiyat tahmini ucu yok', (await post(null, '/ai/price-estimate', { category: 'Temizlik' })).status === 404);
  check('bedava paket yükseltme ucu yok', (await post(firm, '/plan/upgrade', { plan: 'enterprise' })).status === 404);

  // Soru-cevap
  await post(firm, `${path}/questions`, { question: 'Kaç metrekare?' });
  check('firma soru sorar', (await get(null, path)).text.includes('Kaç metrekare?'));
  await post(owner, `${path}/questions`, { question: 'Müşteri sorusu' });
  check('müşteri soru soramaz', !(await get(null, path)).text.includes('Müşteri sorusu'));
  await post(firm, `${path}/questions`, { question: 'u'.repeat(501) });
  check('uzun soru reddedilir', !(await get(null, path)).text.includes('u'.repeat(501)));
  const questionId = ((await get(owner, path)).text.match(/questions\/([a-f0-9]{24})\/answer/) || [])[1];
  check('sahibine cevap formu görünür', Boolean(questionId));
  await post(rival, `${path}/questions/${questionId}/answer`, { answer: 'Sahte cevap' });
  await post(stranger, `${path}/questions/${questionId}/answer`, { answer: 'Yabancı cevabı' });
  const afterFake = (await get(null, path)).text;
  check('başkası cevaplayamaz', !afterFake.includes('Sahte cevap') && !afterFake.includes('Yabancı cevabı'));
  await post(owner, `${path}/questions/${questionId}/answer`, { answer: 'Yaklaşık 120 metrekare.' });
  check('talep sahibi cevaplar', (await get(null, path)).text.includes('Yaklaşık 120 metrekare.'));
  check('soran firmaya bildirim gider', (await get(firm, '/notifications')).text.includes('sorunuz cevaplandı'));
  for (let i = 1; i <= 4; i += 1) await post(firm, `${path}/questions`, { question: `Ek soru ${i}` });
  const limited = (await get(null, path)).text;
  check('cevapsız soru sınırı üç', limited.includes('Ek soru 3') && !limited.includes('Ek soru 4'));
  await post(rival, `${path}/questions`, { question: '<script>alert(1)</script>' });
  const escaped = (await get(null, path)).text;
  check('sorudaki HTML kaçırılır', escaped.includes('&lt;script&gt;alert(1)') && !escaped.includes('<script>alert(1)'));

  // Aylık teklif hakkı
  const plans = (await get(firm, '/dashboard/plans')).text;
  check('paket sayfası kullanımı gösterir', plans.includes('Başlangıç') && /Bu ay <strong>0<\/strong> teklif verdiniz/.test(plans));
  check('istatistik sayfası açılır', (await get(firm, '/dashboard/analytics')).text.includes('Henüz teklif vermediniz'));
  const jobs = [];
  for (let i = 0; i < 11; i += 1) jobs.push(await newRequest(owner, { title: `Paket denemesi ${i} ${stamp}`, description: FILLER, category: 'Temizlik' }));
  for (let i = 0; i < 10; i += 1) await post(firm, '/bids', { requestId: idOf(jobs[i]), amount: '1000', deliveryTime: '3', description: 'Teklif metni' });
  const full = await post(firm, '/bids', { requestId: idOf(jobs[10]), amount: '1000', deliveryTime: '3', description: 'Fazla teklif' });
  check('hak dolunca teklif verilemez', full.location === '/dashboard/plans');
  check('teklif formunda hak doldu yazar', (await get(firm, jobs[10])).text.includes('Bu ayki teklif hakkınız doldu'));
  const bidId = ((await get(firm, jobs[0])).text.match(/\/bids\/([a-f0-9]{24})\/edit/) || [])[1];
  await post(firm, `/bids/${bidId}/edit`, { amount: '900', deliveryTime: '3', description: 'Güncel teklif' });
  check('hak dolsa da teklif düzenlenir', (await get(firm, jobs[0])).text.includes('<strong>900 TL</strong>'));
  await post(firm, `/bids/${bidId}/withdraw`);
  const again = await post(firm, '/bids', { requestId: idOf(jobs[10]), amount: '1000', deliveryTime: '3', description: 'Yeniden' });
  check('geri çekmek hakkı iade etmez', again.location === '/dashboard/plans');
  check('istatistikte gönderilenler sayılır', (await get(firm, '/dashboard/analytics')).text.includes('Gönderilen teklif'));

  const firmId = ((await get(firm, '/dashboard')).text.match(/\/companies\/([a-f0-9]{24})/) || [])[1];
  check('firma kendi paketini değiştiremez', (await post(firm, `/admin/users/${firmId}/plan`, { plan: 'enterprise' })).status === 403);
  const admin = await login('yonetici@teklifver.test', 'demo1234');
  await post(admin, `/admin/users/${firmId}/plan`, { plan: 'pro' });
  const upgraded = await post(firm, '/bids', { requestId: idOf(jobs[10]), amount: '1000', deliveryTime: '3', description: 'Pro teklif' });
  check('yönetici paketi açınca teklif verilir', upgraded.location === jobs[10]);
  check('firmaya paket bildirimi gider', (await get(firm, '/notifications')).text.includes('paketi Pro oldu'));
  check('paket isteği iletişim formunu doldurur', (await get(firm, '/iletisim?paket=enterprise')).text.includes('Kurumsal paketine geçmek istiyorum'));

  // Mesajda fotoğraf
  const ownerId = ((await get(firm, path)).text.match(/\/messages\/[a-f0-9]{24}\/([a-f0-9]{24})/) || [])[1];
  const thread = `/messages/${idOf(path)}/${ownerId}`;
  const sent = await sendForm(firm, thread, { content: '' }, 'olcu.png');
  check('yalnız fotoğraflı mesaj gider', sent.status === 302 && sent.location === thread);
  const threadPage = (await get(owner, `/messages/${idOf(path)}/${firmId}`)).text;
  check('fotoğraf konuşmada görünür', /class="msg-image" href="\/uploads\/[\w-]+\.webp"/.test(threadPage));
  check('sahte çevrimiçi göstergesi yok', !threadPage.includes('Çevrimiçi'));
  const live = await (await fetch(`${BASE}/messages/${idOf(path)}/${firmId}/new`, { headers: { cookie: owner } })).json();
  check('canlı güncellemede fotoğraf var', live.messages.some(message => /^\/uploads\/[\w-]+\.webp$/.test(message.image)));
  const inbox = (await get(owner, '/messages')).text;
  check('gelen kutusunda "Fotoğraf" yazar', inbox.includes('Fotoğraf'));
  const denied = await sendForm(stranger, thread, { content: 'Merhaba' }, 'izinsiz.png');
  check('yetkisiz kişi fotoğraf gönderemez', denied.status === 302 && denied.location !== thread);
  const countMessages = async () => ((await get(owner, `/messages/${idOf(path)}/${firmId}`)).text.match(/class="msg[ "]/g) || []).length;
  const beforeEmpty = await countMessages();
  await sendForm(firm, thread, { content: '' });
  check('boş mesaj reddedilir', (await countMessages()) === beforeEmpty);

  // Ana sayfa: kategori kutuları, vitrin, acil işler, nasıl işler, canlılık bilgisi ve fotoğrafsız ilan yer tutucusu
  const home = (await get(null, "/")).text;
  check("kategori ağacı sayılarla", (home.match(/class="cat-tree-main"/g) || []).length >= 10 && /class="cat-tree-main"[^>]*>[\s\S]*?class="count">\d+</.test(home));
  const vitrinItems = ((home.split('class="box vitrin-box"')[1] || '').split('</section>')[0].match(/class="showcase-item"/g) || []).length;
  check("vitrin satırları tam", vitrinItems > 0 && vitrinItems % 5 === 0, String(vitrinItems));
  check("acil işler bölümü acil talepleri gösterir", /class="box urgent-box"[\s\S]*?href="\/requests\?urgent=on"/.test(home) && (home.match(/class="urgent-item"/g) || []).length >= 3);
  check("nasıl işler üç adım", /class="how-steps"(?:[\s\S]*?<li>){3}/.test(home));
  check("ana sayfada süs yok: slogan dalgası ve sayaç kutusu", !home.includes('class="squiggle"') && !home.includes('composer-stats'));
  const priceGuidePage = (await get(null, "/fiyat-rehberi")).text;
  const charts = priceGuidePage.match(/<svg class="dist-chart"[\s\S]*?<\/svg>/g) || [];
  check("fiyat rehberinde teklif dağılımı grafikleri", charts.length >= 3 && charts.every(svg => (svg.match(/class="dist-bar/g) || []).length === 8 && /dist-bar is-mid/.test(svg) && /aria-label="[^"]+ arasında"/.test(svg)), String(charts.length));
  const firmPage = (await get(null, `/companies/${firmId}`)).text;
  check("açık talebi olmayan ziyaretçiye firmadan teklif alma yolu", firmPage.includes("Bu Firmadan Teklif Alın") && firmPage.includes('href="/requests/new'));
  const guestDetail = (await get(null, path)).text;
  check("talep sayfasında talep no ve bölüm bağlantıları", /class="detail-meta">Talep No <strong>\d+<\/strong>/.test(guestDetail) && guestDetail.includes('href="#teklifler"'));
  check("ziyaretçiye benzer talep ver kutusu", guestDetail.includes("Benzer bir iş mi yaptıracaksınız?") && !(await get(owner, path)).text.includes("Benzer bir iş mi yaptıracaksınız?"));
  const byDistrict = (await get(null, "/requests?search=" + encodeURIComponent("Kadıköy"))).text;
  const districtPlaces = [...byDistrict.matchAll(/class="listing-place">([^<]+)</g)].map(m => m[1]);
  check("arama ilçe adıyla da bulur", districtPlaces.some(place => place.includes("Kadıköy")), districtPlaces.join(", "));
  const listPage = (await get(null, "/requests")).text;
  check("talep listesi sütunlu: başlık, bütçe, teklif, tarih, il", /<th>Talep Başlığı<\/th>[\s\S]*?<th class="col-budget"[^>]*>[\s\S]*?Bütçe[\s\S]*?<\/th>[\s\S]*?<th class="col-date"[^>]*>[\s\S]*?Tarih[\s\S]*?<\/th>[\s\S]*?<th class="col-place">İl \/ İlçe<\/th>/.test(listPage));
  const cityList = (await get(null, "/requests?city=" + encodeURIComponent("İstanbul"))).text;
  const cityDetailPath = (cityList.match(/class="listing-title" href="(\/requests\/[a-f0-9]{24})"/) || [])[1];
  const cityDetail = cityDetailPath ? (await get(null, cityDetailPath)).text : "";
  check("talep sayfasında haritada göster bağlantısı", /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&(amp;)?query=[^"]+"/.test(cityDetail) && cityDetail.includes(encodeURIComponent("İstanbul")));
  check("vitrinde kısa tutar, tam tutar ipucunda", /class="showcase-price" title="[^"]*\d TL">[^<]*bin TL</.test(home));
  const boya = (await get(null, "/requests?search=boya")).text;
  const boyaTotal = Number((boya.match(/<strong>(\d+)<\/strong> talep bulundu/) || [])[1]);
  const menuAll = Number((boya.match(/Tüm Talepler <span class="count">(\d+)</) || [])[1]);
  check("aramada kategori sayıları aramaya göre", boyaTotal > 0 && menuAll === boyaTotal && boya.includes("Sayılar bu aramaya göre") && /class="side-main[^"]* is-empty"/.test(boya), `${boyaTotal} / ${menuAll}`);
  check("menü bağlantıları aramayı korur", boya.includes('href="/requests?search=boya&amp;category='));
  const none = (await get(null, "/requests?search=" + encodeURIComponent("zzqx boya"))).text;
  check("sonuçsuz arama yol gösterir", none.includes("zzqx boya&#34; için açık talep bulunamadı") && none.includes("Son eklenen talepler") && /kategorisindeki \d+ açık talebe bakın/.test(none) && /class="listing-title"/.test(none));
  const districtList = (await get(null, "/requests?city=" + encodeURIComponent("İstanbul") + "&district=" + encodeURIComponent("Kadıköy"))).text;
  const districtRows = [...districtList.matchAll(/class="listing-place">([^<]+)</g)].map(m => m[1]);
  const lowerDistrict = (await get(null, "/requests?city=" + encodeURIComponent("İstanbul") + "&district=" + encodeURIComponent("kadıköy"))).text;
  check("ilçe filtresi yalnız o ilçeyi listeler", districtRows.length > 0 && districtRows.every(place => place === "İstanbul / Kadıköy") && /<option value="Kadıköy" selected>/.test(districtList) && /class="filter-chip"[^>]*>Kadıköy/.test(districtList) && (lowerDistrict.match(/class="listing-place">/g) || []).length === districtRows.length, districtRows.join(", "));
  const sortedList = (await get(null, "/requests?sort=budget_high")).text;
  check("sütun başlığıyla sıralama", /<th class="col-budget" aria-sort="descending">/.test(sortedList) && sortedList.includes('href="/requests?sort=budget_low" data-sort-head="budget"'));
  check("talep yolunda ilçe bağlantısı", cityDetail.includes("&amp;district="));
  const suggestPlaces = async q => (await (await fetch(`${BASE}/requests/suggest?q=${encodeURIComponent(q)}`)).json()).items;
  check("öneride ilçe gelir", (await suggestPlaces("kadık")).some(item => item.hint.startsWith("İlçe") && item.label === "Kadıköy, İstanbul" && item.url.includes("district=")));
  check("öneride il gelir", (await suggestPlaces("ankar")).some(item => item.hint.startsWith("İl ·") && item.url === "/requests?city=Ankara"));
  const formWithCity = (await get(null, "/requests/new?city=" + encodeURIComponent("İstanbul"))).text;
  check("talep formu ildeki ilçeleri önerir", /<datalist id="locationOptions">[\s\S]*?<option value="Kadıköy">/.test(formWithCity) && formWithCity.includes('list="locationOptions"'));
  const shortSuggest = await suggestPlaces("ist");
  check("kısa aramada önerilerde alakasız başlık yok", shortSuggest.some(item => item.label === "İstanbul") && shortSuggest.every(item => !item.hint.startsWith("No:")) && !shortSuggest.some(item => item.label === "Nakliye & Lojistik"));
  check("ana sayfa kısayollarında acil işler", /href="\/requests\?urgent=on">Acil işler <span class="count">\d+<\/span>/.test(home));
  check("talep sayfasında önceki / sonraki talep", /<nav class="detail-pager"[^>]*>[\s\S]*?href="\/requests\/[a-f0-9]{24}"/.test(cityDetail));
  check("yol bilgisi verisinde il de var", /"@type":"BreadcrumbList"[\s\S]*?"name":"İstanbul"/.test(cityDetail));
  const announced = await newRequest(stranger, { title: `Ofis halısı yıkanacak ${stamp}`, description: FILLER, category: "Temizlik" });
  check("yayınlanınca kaç firmaya haber verildiği yazar", /\d+ firmaya haber verdik/.test((await get(stranger, announced)).text));
  const list50 = (await get(null, "/requests?perPage=50")).text;
  const rows50 = (list50.match(/class="listing-title"/g) || []).length;
  const rows20 = (listPage.match(/class="listing-title"/g) || []).length;
  check("sayfada 20 / 50 talep", rows20 === 20 && rows50 > 20 && rows50 <= 50 && list50.includes('data-per-page="50" aria-current="true"') && list50.includes("perPage=50&amp;page=2"), `${rows20} / ${rows50}`);
  const guideNewest = (await get(null, "/companies?sort=newest")).text;
  check("firma rehberinde başlıkla sıralama", /<th class="col-date" aria-sort="descending"><a class="sort-head is-descending" href="\/companies\?sort=newest" data-company-sort="newest">Üyelik<\/a>/.test(guideNewest));
  const insaatList = (await get(null, "/requests?category=" + encodeURIComponent("İnşaat & Tadilat"))).text;
  const insaatPath = (insaatList.match(/class="listing-title" href="(\/requests\/[a-f0-9]{24})"/) || [])[1];
  const insaatDetail = insaatPath ? (await get(null, insaatPath)).text : "";
  check("ortalama tekliften dağılım grafiğine bağlantı", insaatDetail.includes('href="/fiyat-rehberi#dagilim-insaat-tadilat"') && priceGuidePage.includes('id="dagilim-insaat-tadilat"'));
  check("kategori sayfası büyük fotoğraf kullanmaz", !(await get(null, "/hizmet/temizlik")).text.includes("landing-photo"));
  check("yeni firma rozeti üyelik tarihinden gelir", /class="firm-badge firm-badge-newcomer"/.test(firmPage) && !/firm-badge-favorite/.test(firmPage));
  const guide = (await get(null, "/companies")).text;
  check("rehberde rozetler görünür", /class="firm-badge firm-badge-(favorite|fast)"/.test(guide));
  const guideIds = [...new Set([...guide.matchAll(/data-compare value="([a-f0-9]{24})"/g)].map(m => m[1]))];
  const similarPage = (await get(null, `/companies/${guideIds[0]}`)).text;
  const similarLinks = [...similarPage.matchAll(/class="similar-name" href="\/companies\/([a-f0-9]{24})"/g)].map(m => m[1]);
  check("firma sayfasında benzer firmalar", similarPage.includes("Benzer Firmalar") && similarLinks.length > 0 && !similarLinks.includes(guideIds[0]));
  check("firma sayfasında teklif hızı", /Genelde \d+ (saat|gün) içinde teklif verir/.test(similarPage));
  const compare = (await get(null, `/companies/karsilastir?ids=${guideIds.slice(0, 2).join(",")}`)).text;
  check("karşılaştırma iki firmayı yan yana gösterir", guideIds.length >= 5 && (compare.match(/<th scope="col" data-firm=/g) || []).length === 2 && compare.includes("Ortalama teslim süresi"));
  check("karşılaştırmada teklif hızı", compare.includes("Teklif hızı"));
  const formPage = (await get(null, "/requests/new")).text;
  check("talep formunda sayaç ve hızlı son tarih", formPage.includes('data-char-count-for="description" data-min="20"') && (formPage.match(/data-days="\d+"/g) || []).length === 3);
  check("karşılaştırma seçim olmadan yol gösterir", (await get(null, "/companies/karsilastir")).text.includes("en az iki firma seçin"));
  check("karşılaştırma en fazla üç firma alır", ((await get(null, `/companies/karsilastir?ids=${guideIds.slice(0, 5).join(",")}`)).text.match(/<th scope="col" data-firm=/g) || []).length === 3);
  const urgentList = (await get(null, "/requests?urgent=on")).text;
  const urgentRows = (urgentList.match(/class="listing-title"/g) || []).length;
  check("acil filtresi yalnız acil talepleri listeler", urgentRows > 0 && urgentRows === (urgentList.match(/class="label label-urgent"/g) || []).length && /class="quick-chip is-active" data-quick="urgent"/.test(urgentList), String(urgentRows));
  check("son teklif zamanı gerçek kayıttan", /son teklif <strong>[^<]*(önce|dün)[^<]*<\/strong>/.test(home));
  check("fotoğrafsız ilan kategori adını taşır", /class="no-photo is-placeholder" data-cat="[^"]+"/.test(home));

  console.log(`${passed} geçti, ${failures} hata`);
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
