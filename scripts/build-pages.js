// GitHub Pages için statik önizleme üretir: npm run pages:build
// Gerçek veritabanı ve .env kullanılmaz; site boş, geçici bir veritabanındaki örnek verilerle
// çalıştırılıp oturum açmamış bir ziyaretçi gibi gezilir ve sayfalar dist-pages klasörüne yazılır.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-pages');
const SITE = process.env.PAGES_SITE || 'https://sswird.github.io';
const BASE = process.env.PAGES_BASE || '/teklifver';
const PORT = 3199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROW = /<tr>\s*<td class="col-photo"[\s\S]*?<\/tr>/g;

const hasExtension = value => /\.[a-z0-9]+$/i.test(value);

function startSite(mongoUri, cwd) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    // .env çalışma klasöründen okunur; boş klasörde çalıştığı için yalnızca aşağıdaki değerler geçerlidir.
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      MONGODB_URI: mongoUri,
      PORT: String(PORT),
      SITE_URL: SITE + BASE,
      SESSION_SECRET: crypto.randomBytes(24).toString('hex'),
      RATE_LIMIT_PER_MINUTE: '100000'
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  child.stdout.on('data', chunk => {
    if (String(chunk).includes('Gömülü')) {
      console.error('Geçici veritabanına bağlanılamadı; yerel veriler yayınlanmasın diye durduruldu.');
      child.kill();
      process.exit(1);
    }
  });
  return child;
}

async function waitForSite() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(ORIGIN + '/')).ok) return;
    } catch { /* henüz açılmadı */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Site açılmadı.');
}

// Sunucu boşta kalan bağlantıyı kapatırsa yeniden kullanılmak istenen bağlantı kopar ("fetch failed").
// Bu yüzden ağ hatasında birkaç kez yeniden denenir; HTTP hataları olduğu gibi döner.
async function request(url, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(ORIGIN + url, options);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url} alınamadı: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }
}

const getHtml = async url => (await request(url)).text();

// Bağlantıları izleyerek herkese açık sayfaları toplar; yönlendirmeleri (ör. /dashboard -> /login) not eder.
async function crawl(extraPaths) {
  const pages = new Map();
  const aliases = new Map();
  const seen = new Set(['/', ...extraPaths]);
  const queue = [...seen];

  while (queue.length) {
    const url = queue.shift();
    const res = await request(url, { redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const target = new URL(res.headers.get('location'), ORIGIN).pathname;
      aliases.set(url, target);
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
      continue;
    }
    if (!res.ok) throw new Error(`${url} sayfası ${res.status} döndürdü.`);

    const html = await res.text();
    pages.set(url, html);
    for (const [, href] of html.matchAll(/\bhref="(\/[^"#?]*)/g)) {
      if (hasExtension(href) || href.startsWith('//') || seen.has(href)) continue;
      seen.add(href);
      queue.push(href);
    }
  }
  return { pages, aliases };
}

// Tüm satırları listeden alır; filtreleme tarayıcıda yapıldığı için satırlar ayrı saklanır.
async function collectListingParts() {
  const rows = new Map();
  const cards = new Map();
  const ads = [];

  for (let page = 1; ; page += 1) {
    const list = await getHtml(`/requests?page=${page}`);
    const found = list.match(ROW) || [];
    const before = rows.size;
    found.forEach(row => rows.set(row.match(/href="\/requests\/([a-f0-9]{24})"/)[1], row));
    ads.push(...(list.match(/<tr class="ad-row">[\s\S]*?<\/tr>/g) || []));

    const gallery = await getHtml(`/requests?page=${page}&view=gallery`);
    for (const match of gallery.matchAll(/<a class="showcase-item" href="\/requests\/([a-f0-9]{24})">[\s\S]*?<\/a>/g)) {
      cards.set(match[1], match[0]);
    }
    if (!found.length || rows.size === before) break;
  }

  const companyRows = new Map();
  for (let page = 1; ; page += 1) {
    const found = (await getHtml(`/companies?page=${page}`)).match(ROW) || [];
    const before = companyRows.size;
    for (const row of found) companyRows.set(row.match(/class="listing-title" href="\/companies\/([a-f0-9]{24})"/)[1], row);
    if (companyRows.size === before) break;
  }
  return { rows, cards, ads: [...new Set(ads)], companyRows };
}

async function collectData(parts, rewrite) {
  const Request = require(path.join(ROOT, 'models', 'Request'));
  const User = require(path.join(ROOT, 'models', 'User'));
  const categories = require(path.join(ROOT, 'config', 'categories'));
  const { liveFilter } = require(path.join(ROOT, 'lib', 'listing'));

  const [requests, companies] = await Promise.all([
    Request.find(liveFilter())
      .select('no title description category city budget images bidCount viewCount createdAt deadline')
      .lean(),
    User.find({ role: 'company', suspended: { $ne: true } })
      .select('companyName name address serviceCities specialties categories rating ratingCount verified createdAt')
      .lean()
  ]);
  const time = value => (value ? new Date(value).getTime() : 0);

  return {
    builtAt: Date.now(),
    categories: categories.map(({ name, subs }) => ({ name, subs })),
    adRows: parts.ads.map(rewrite),
    requests: requests
      .filter(item => parts.rows.has(String(item._id)))
      .map(item => ({
        id: String(item._id),
        no: item.no,
        title: item.title,
        description: item.description,
        category: item.category,
        city: item.city || '',
        min: (item.budget && item.budget.min) || 0,
        max: (item.budget && item.budget.max) || 0,
        created: time(item.createdAt),
        deadline: time(item.deadline),
        photos: (item.images || []).length,
        bids: item.bidCount || 0,
        views: item.viewCount || 0,
        row: rewrite(parts.rows.get(String(item._id))),
        card: rewrite(parts.cards.get(String(item._id)) || '')
      })),
    companies: companies
      .filter(item => parts.companyRows.has(String(item._id)))
      .map(item => ({
        name: item.companyName || item.name,
        city: item.address || '',
        areas: item.serviceCities || [],
        specialties: item.specialties || [],
        categories: item.categories || [],
        rating: item.rating || 0,
        reviews: item.ratingCount || 0,
        verified: Boolean(item.verified),
        created: time(item.createdAt),
        row: rewrite(parts.companyRows.get(String(item._id)))
      }))
  };
}

// Kök adresli bağlantıları /teklifver/... biçimine çevirir; yönlendirmeleri hedefine bağlar.
function makeRewriter(aliases) {
  const convert = value => {
    if (value.startsWith('//')) return value;
    const [withoutHash, hash] = value.split('#');
    const [rawPath, rawQuery] = withoutHash.split('?');
    const target = aliases.get(rawPath) || rawPath;

    let query = rawQuery || '';
    if (query && /^\/(login|register)$/.test(target)) {
      query = query.split('&').filter(part => !part.startsWith('next=') && !part.startsWith('amp;next=')).join('&');
    }
    if (aliases.has(rawPath)) query = '';

    const clean = hasExtension(target) || target.endsWith('/') ? target : `${target}/`;
    return BASE + clean + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');
  };
  return html => html.replace(/\b(href|src|action|data-full|data-poll)="(\/[^"]*)"/g,
    (match, attribute, value) => `${attribute}="${convert(value)}"`);
}

function finishPage(html, rewrite) {
  const page = rewrite(html.replace(/<div class="demo-note">[\s\S]*?<\/div>\s*<\/div>/, ''));

  return page
    .replace('<html lang="tr">', `<html lang="tr" data-base="${BASE}">`)
    .replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta name="robots" content="noindex">')
    .replace(/<script src="[^"]*\/js\/main\.js[^"]*" defer><\/script>/, match =>
      `<link href="${BASE}/css/static.css" rel="stylesheet">\n  <script src="${BASE}/js/search-terms.js" defer></script>\n  <script src="${BASE}/js/static.js" defer></script>\n  ${match}`)
    .replace('<body>', `<body>\n  <div class="preview-bar">Önizleme sürümü: talepler, firmalar ve puanlar örnek veridir. Üyelik, talep verme, teklif ve mesajlaşma kapalıdır.</div>`);
}

const writePage = (url, html) => {
  const dir = path.join(OUT, ...url.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};

// Yayına çıkmaması gerekenleri son kez arar; bulursa çıktıyı yayınlatmaz.
function checkOutput(files) {
  const problems = [];
  const leftover = new RegExp(`\\b(?:href|src|action|data-full)="/(?!/)(?!${BASE.slice(1)}/)`);
  for (const [name, text] of files) {
    const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
    if (emails) problems.push(`${name}: e-posta adresi: ${[...new Set(emails)].join(', ')}`);
    for (const word of ['demo1234', 'data-demo', 'localhost', '127.0.0.1', '0555 000']) {
      if (text.includes(word)) problems.push(`${name}: "${word}" geçiyor`);
    }
    if (name.endsWith('.html') && leftover.test(text)) problems.push(`${name}: çevrilmemiş bağlantı: ${text.match(leftover)[0]}`);
  }
  if (problems.length) throw new Error(`Çıktı denetimi başarısız:\n  ${problems.join('\n  ')}`);
}

async function main() {
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'teklifver-pages-'));
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('teklifver_pages');
  let site;

  try {
    await mongoose.connect(uri);
    site = startSite(uri, tempCwd);
    await waitForSite();

    // Filtreli listelerden ulaşılan ilanlar bağlantı izlenerek bulunamaz; hepsi baştan eklenir.
    const parts = await collectListingParts();
    const { pages, aliases } = await crawl([
      ...[...parts.rows.keys()].map(id => `/requests/${id}`),
      ...[...parts.companyRows.keys()].map(id => `/companies/${id}`)
    ]);
    const rewrite = makeRewriter(aliases);
    const data = await collectData(parts, rewrite);
    if (!data.requests.length || !data.companies.length) throw new Error('Örnek veri bulunamadı.');

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pages', 'static.js'), path.join(OUT, 'js', 'static.js'));
    fs.copyFileSync(path.join(__dirname, 'pages', 'static.css'), path.join(OUT, 'css', 'static.css'));
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

    const outputs = [];
    for (const [url, html] of pages) {
      const finished = finishPage(html, rewrite);
      writePage(url, finished);
      outputs.push([`${url}.html`, finished]);
    }

    const notFound = finishPage(await getHtml('/bu-sayfa-yok'), rewrite);
    fs.writeFileSync(path.join(OUT, '404.html'), notFound);
    outputs.push(['404.html', notFound]);

    const json = JSON.stringify(data);
    fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'data', 'site.json'), json);
    outputs.push(['data/site.json', json]);

    checkOutput(outputs);
    console.log(`  ${pages.size} sayfa, ${data.requests.length} talep, ${data.companies.length} firma yazıldı: dist-pages`);
    console.log(`  Yönlendirilen adresler: ${[...aliases.keys()].join(', ') || 'yok'}`);
  } finally {
    if (site) site.kill();
    await mongoose.disconnect();
    await mongo.stop();
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
