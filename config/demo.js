// Geliştirme ortamı için örnek veri. Veritabanında hiç talep yoksa sunucu açılışında eklenir.
// Kapatmak için .env dosyasına DEMO_DATA=false yazın; silmek için: npm run demo:sil
// Firmalar ve kişiler uydurmadır, sitede "örnek veri" uyarısıyla gösterilir.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Request = require('../models/Request');
const Bid = require('../models/Bid');
const Message = require('../models/Message');
const Review = require('../models/Review');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const SavedSearch = require('../models/SavedSearch');
const { monthKey } = require('../lib/plans');

const DEMO_DOMAIN = 'teklifver.test';
const DEMO_PASSWORD = 'demo1234';
// Örnek veriler değişince artır: eski örnek veriler kendiliğinden yenilenir, gerçek kullanıcılara dokunulmaz.
const DEMO_VERSION = 4;

// Giriş sayfasındaki tek tıkla giriş butonları
const demoAccounts = [
  { label: 'Müşteri hesabı', email: `musteri@${DEMO_DOMAIN}`, password: DEMO_PASSWORD },
  { label: 'Firma hesabı', email: `sirket@${DEMO_DOMAIN}`, password: DEMO_PASSWORD },
  { label: 'Yönetici hesabı', email: `yonetici@${DEMO_DOMAIN}`, password: DEMO_PASSWORD }
];

// Örnek yorumlar: tamamlanan talebe göre [puan, yorum, firmanın cevabı]
const demoReviews = {
  'Ofis derin temizlik (tadilat sonrası)': [5, 'Söz verdikleri gün geldiler, camlar dahil tertemiz bıraktılar.'],
  'Depo kurulumu ve palet taşıma': [4, 'İş sorunsuz bitti, sadece sabah biraz geç başladılar.'],
  'Teras su yalıtımı, 60 m2': [5, 'İlk yağmurda kontrol ettik, hiç sızıntı yok. Ustalar çok düzenliydi.'],
  'Ürün kataloğu tasarımı, 24 sayfa': [5, 'Revizyonlarda çok yardımcı oldu, baskı dosyaları da eksiksizdi.'],
  'Kurumsal site yenileme': [4, 'Site hızlandı, telefonda da düzgün görünüyor. Teslim birkaç gün gecikti ama haber verdiler.'],
  'Banyo tadilatı, 5 m2 komple': [5, 'Söylenen fiyatın üstüne çıkmadılar, 10 günde bitti. Temiz çalıştılar.'],
  'Salon ve yatak odası boya': [4, 'İşçilik iyi, eşyaları güzel korudular. Bir gün geç başladılar.'],
  'Ankara - Eskişehir evden eve nakliyat': [5, 'Hiçbir eşyamız çizilmedi. Sabah 8 dediler, 8de kapıdaydılar.'],
  'Apartman giriş ve merdiven boyası': [3, 'Boya iyi ama iş uzadı, 3 gün dediler 6 gün sürdü. Fiyat uygundu.', 'Haklısınız, malzeme geç geldi. Bir dahaki işte önceden haber vereceğiz.'],
  'Taşınmadan önce ev temizliği': [4, 'Gayet iyi temizlediler. Fırının içini unutmuşlar, söyleyince hallettiler.'],
  'Kahve dükkanı için logo': [5, 'Üç ayrı taslak gönderdi, hepsi birbirinden iyiydi. Seçmek zor oldu.'],
  'Google reklam kurulumu': [3, 'Reklamlar çalışıyor ama raporları ben istemeden göndermediler.'],
  'Düğün fotoğrafı ve klip': [5, 'Fotoğraflar çok güzel çıktı. Klibi 3 haftada teslim etti.'],
  'Kına organizasyonu, 60 kişi': [4, 'Süsleme güzeldi. Ses sistemi ilk yarım saat sorun çıkardı.'],
  'Lise diploması yeminli çeviri': [5, 'Aynı gün noterden alıp kargoladılar.'],
  'Limited şirket kuruluşu': [5, 'Evrak işlerini hiç uğraştırmadan hallettiler. Muhasebeye de devam ediyoruz.'],
  'LGS için matematik dersi': [5, 'Oğlum matematiği sevmeye başladı, netleri de arttı.'],
  'Atölyeye pano ve aydınlatma': [4, 'Temiz iş. Malzeme fiyatı başta söylenenden biraz yüksek çıktı.'],
  'Balkon camı, 5 metre': [4, 'Montaj iyi, ufak bir ayar için tekrar geldiler.'],
  'İzmir - Aydın parça eşya': [5, 'Hızlı ve uygun.'],
  'Küçük stok programı': [4, 'İşimi gördü. Arayüzü sade ama ben de öyle istemiştim.'],
  'Mutfak dolabı yenileme': [3, 'Dolaplar güzel ama söz verilen tarihten 2 hafta sonra bitti.']
};

// Örnek bildirimler: [kişi, metin, kaçSaatÖnce, okundu, talep başlığı]
const demoNotifications = [
  ['elif', 'Demir Tadilat, "Mutfak dolapları ve tezgah yenilenecek" talebinize teklif verdi.', 3, false, 'Mutfak dolapları ve tezgah yenilenecek'],
  ['elif', 'Yılmaz Mobilya Dekorasyon, "Mutfak dolapları ve tezgah yenilenecek" talebinize teklif verdi.', 2, false, 'Mutfak dolapları ve tezgah yenilenecek'],
  ['elif', 'Öztürk Bilişim, "Kafem için web sitesi yaptırmak istiyorum" talebinize teklif verdi.', 16, true, 'Kafem için web sitesi yaptırmak istiyorum'],
  ['usta', '"45 m2 salon ve koridor boya badana" talebindeki teklifiniz kabul edildi.', 190, true, '45 m2 salon ve koridor boya badana'],
  ['usta', 'İnşaat & Tadilat kategorisinde yeni talep: "3+1 daire boya badana, kiracı çıktı"', 2, false, '3+1 daire boya badana, kiracı çıktı'],
  ['usta', 'İnşaat & Tadilat kategorisinde yeni talep: "Lavabo gideri ve batarya değişimi"', 6, false, 'Lavabo gideri ve batarya değişimi']
];

const verifiedCompanies = ['usta', 'kodhane', 'mavi', 'kadraj', 'dilmer'];

const customers = {
  elif: { name: 'Elif Yılmaz', email: `musteri@${DEMO_DOMAIN}`, phone: '0555 000 00 01', months: 14 },
  burak: { name: 'Burak Aydın', months: 31 },
  zeynep: { name: 'Zeynep Kara', months: 8 },
  murat: { name: 'Murat Şahin', months: 22 },
  sevgi: { name: 'Sevgi Doğan', months: 5 },
  okan: { name: 'Okan Tekin', months: 41 },
  hatice: { name: 'Hatice Ünal', months: 17 },
  kerem: { name: 'Kerem Aksoy', months: 3 },
  gamze: { name: 'Gamze Polat', months: 11 },
  ali: { name: 'Ali Rıza Şen', months: 26 },
  nur: { name: 'Nurcan Yıldız', months: 2 },
  tuncay: { name: 'Tuncay Erdem', months: 19 },
  derya: { name: 'Derya Çetin', months: 7 },
  baris: { name: 'Barış Kaya', months: 35 },
  emine: { name: 'Emine Bozkurt', months: 4 },
  cem: { name: 'Cem Uslu', months: 1 },
  fatma: { name: 'Fatma Akın', months: 13 },
  yusuf: { name: 'Yusuf Akgül', months: 6 },
  aysel: { name: 'Aysel Kurt', months: 9 },
  onur: { name: 'Onur Deniz', months: 15 },
  melis: { name: 'Melis Tunç', months: 2 },
  seda: { name: 'Seda Aras', months: 4 },
  sinan: { name: 'Sinan Yavuz', months: 28 },
  hulya: { name: 'Hülya Öz', months: 12 },
  kadir: { name: 'Kadir Polat', months: 37 },
  pinar: { name: 'Pınar Erol', months: 21 },
  ibrahim: { name: 'İbrahim Çakır', months: 10 },
  tolga: { name: 'Tolga Sezer', months: 16 },
  ipek: { name: 'İpek Sarı', months: 3 },
  ozan: { name: 'Ozan Güven', months: 24 },
  yasemin: { name: 'Yasemin Ateş', months: 6 },
  deniz: { name: 'Deniz Kurt', months: 18 },
  hale: { name: 'Hale Türk', months: 8 },
  levent: { name: 'Levent Işık', months: 29 },
  ayten: { name: 'Ayten Kılıç', months: 14 },
  songul: { name: 'Songül Demir', months: 5 },
  canan: { name: 'Canan Er', months: 7 }
};

const companies = {
  usta: {
    name: 'Hakan Demir', companyName: 'Demir Tadilat', email: `sirket@${DEMO_DOMAIN}`, phone: '0555 000 00 02', plan: 'pro',
    address: 'İstanbul', serviceCities: ['İstanbul', 'Kocaeli'], months: 52, specialties: ['Mutfak', 'Banyo', 'Boya badana', 'Anahtar teslim'],
    companyDescription: "2012'den beri Anadolu Yakası'nda ev tadilatı yapıyorum. Gelip bakmadan fiyat vermem, keşif ücretsiz. Yaptığım işin 2 yıl arkasındayım."
  },
  yilmaz: {
    name: 'İsmail Yılmaz', companyName: 'Yılmaz Mobilya Dekorasyon', address: 'İstanbul', serviceCities: ['İstanbul'], months: 61,
    specialties: ['Mutfak dolabı', 'Gardırop', 'TV ünitesi'],
    companyDescription: 'Kendi atölyemizde üretiyoruz. Ölçüye gelip çizim yapıyoruz, beğenirseniz başlıyoruz.'
  },
  temel: {
    name: 'Serkan Polat', companyName: 'Polat İnşaat Ltd. Şti.', plan: 'enterprise', address: 'Ankara', serviceCities: ['Ankara', 'Kırıkkale', 'Çankırı'], months: 76,
    specialties: ['Kaba inşaat', 'Tadilat', 'Su yalıtımı'],
    companyDescription: 'Konut ve dükkan tadilatı, su yalıtımı, kaba inşaat. Ankara ve çevre illere gidiyoruz. Faturalı çalışırız.'
  },
  ege: {
    name: 'Tolga Er', companyName: 'Er Dekorasyon', address: 'İzmir', serviceCities: ['İzmir'], months: 39,
    specialties: ['Alçıpan', 'Asma tavan', 'Parke', 'Boya'],
    companyDescription: 'Alçıpan, asma tavan, parke, boya. Sadece İzmir içi çalışıyoruz.'
  },
  yildirim: {
    name: 'Kemal Yıldırım', companyName: 'Yıldırım Elektrik', address: 'Bursa', serviceCities: ['Bursa'], months: 44,
    specialties: ['Elektrik', 'Pano', 'Aydınlatma'],
    companyDescription: 'Yetki belgeli elektrik ustasıyım. Pano, tesisat, aydınlatma.'
  },
  kara: {
    name: 'Ramazan Kara', companyName: 'Kara Boya Badana', address: 'Antalya', serviceCities: ['Antalya'], months: 23,
    specialties: ['Boya badana'],
    companyDescription: '20 yıldır boya badana yapıyorum. Antalya içi her yere gelirim.'
  },
  aydin: {
    name: 'Murat Aydın', companyName: 'Aydın Cam Balkon', address: 'Muğla', serviceCities: ['Muğla', 'Aydın'], months: 18,
    specialties: ['Cam balkon', 'PVC doğrama']
  },
  kodhane: {
    name: 'Can Öztürk', companyName: 'Öztürk Bilişim', address: 'İstanbul', months: 47,
    specialties: ['Web sitesi', 'Mobil uygulama', 'E-ticaret'],
    companyDescription: 'Küçük işletmelere web sitesi ve e-ticaret kuruyoruz. 3 kişilik ekibiz. Teslimden sonra 3 ay ücretsiz destek veriyoruz.'
  },
  bulut: {
    name: 'Mert Bulut', companyName: 'Mert Bulut Yazılım', address: 'Eskişehir', months: 9,
    specialties: ['Python', 'Otomasyon', 'Web uygulaması'],
    companyDescription: 'Serbest yazılımcıyım. Excel ile dönen işleri programa çeviriyorum.'
  },
  piksel: {
    name: 'Selin Arslan', companyName: 'Selin Arslan Tasarım', address: 'İzmir', months: 28,
    specialties: ['Logo', 'Kurumsal kimlik', 'Ambalaj'],
    companyDescription: 'Serbest grafik tasarımcıyım. Logo, ambalaj, katalog. Her işte 2 revizyon dahil.'
  },
  reklamhane: {
    name: 'Gökhan Tan', companyName: 'Tan Reklam Ajansı', address: 'Ankara', months: 19,
    specialties: ['Google Ads', 'Sosyal medya', 'SEO'],
    companyDescription: 'Google Ads ve Meta reklamları, sosyal medya yönetimi. Her ay rapor gönderiyoruz.'
  },
  mavi: {
    name: 'Emre Çelik', companyName: 'Çelik Evden Eve Nakliyat', address: 'Ankara', months: 88,
    specialties: ['Evden eve', 'Ofis taşıma', 'Şehirler arası'],
    companyDescription: 'Asansörlü taşıma yapıyoruz, sigortalıyız. Ankara çıkışlı şehirler arası da çalışırız.'
  },
  anadolu: {
    name: 'Fatih Güneş', companyName: 'Güneş Lojistik', address: 'Kocaeli', months: 60,
    specialties: ['Parsiyel', 'Komple araç', 'Depolama'],
    companyDescription: "Parsiyel ve komple yük taşıyoruz. Depomuz Gebze'de."
  },
  gezgin: {
    name: 'Okan Gezgin', companyName: 'Gezgin Nakliyat', address: 'İzmir', serviceCities: ['İzmir', 'Aydın', 'Manisa', 'Muğla'], months: 15,
    specialties: ['Evden eve', 'Parça eşya'],
    companyDescription: 'İzmir ve Ege geneli evden eve, parça eşya.'
  },
  isilti: {
    name: 'Ayşe Koç', companyName: 'Koç Temizlik Hizmetleri', address: 'İstanbul', serviceCities: ['İstanbul'], months: 33,
    specialties: ['Ofis temizliği', 'İnşaat sonrası', 'Koltuk yıkama'],
    companyDescription: 'Ev, ofis ve inşaat sonrası temizlik. Malzeme bizden, personelimiz sigortalı.'
  },
  piril: {
    name: 'Nuray Şen', companyName: 'Şen Temizlik', address: 'Bursa', serviceCities: ['Bursa'], months: 12,
    specialties: ['Apartman', 'Ofis', 'Cam silme'],
    companyDescription: 'Bursa merkez ilçelerde apartman ve ofis temizliği.'
  },
  kadraj: {
    name: 'Deniz Yıldız', companyName: 'Deniz Yıldız Fotoğraf', address: 'Bursa', serviceCities: ['Bursa', 'Balıkesir'], months: 26,
    specialties: ['Tanıtım filmi', 'Drone çekimi', 'Düğün çekimi'],
    companyDescription: 'Düğün, tanıtım filmi, ürün çekimi. Drone ehliyetim var.'
  },
  sahne: {
    name: 'Merve Aslan', companyName: 'Aslan Organizasyon', address: 'İstanbul', serviceCities: ['İstanbul', 'Kocaeli'], months: 44,
    specialties: ['Düğün', 'Kurumsal etkinlik', 'Ses ışık'],
    companyDescription: 'Düğün, kına, şirket etkinliği. Ses ve ışık sistemi kendimizin.'
  },
  dilmer: {
    name: 'Aylin Korkmaz', companyName: 'Korkmaz Tercüme', address: 'Ankara', months: 66,
    specialties: ['Yeminli çeviri', 'Noter onayı'],
    companyDescription: 'Yeminli tercüme bürosu. İngilizce, Almanca, Fransızca, Arapça. Noter işlemini de biz takip ediyoruz.'
  },
  nalan: {
    name: 'Nalan Güler', companyName: 'Nalan Öğretmen', address: 'İzmir', months: 16,
    specialties: ['Matematik', 'LGS', 'TYT'],
    companyDescription: '15 yıllık matematik öğretmeniyim. LGS ve TYT hazırlık, yüz yüze ya da çevrim içi.'
  },
  akin: {
    name: 'Volkan Akın', companyName: 'Akın Mali Müşavirlik', address: 'İstanbul', months: 30,
    specialties: ['Mali müşavirlik', 'Şirket kuruluşu', 'Teşvik'],
    companyDescription: 'SMMM. Şirket kuruluşu, aylık muhasebe, teşvik başvuruları.'
  }
};

// Kategoriye göre teklif verebilecek firmalar
const companiesByCategory = {
  'İnşaat & Tadilat': ['usta', 'yilmaz', 'temel', 'ege', 'yildirim', 'kara', 'aydin'],
  'Nakliye & Lojistik': ['mavi', 'anadolu', 'gezgin'],
  Temizlik: ['isilti', 'piril'],
  'Web Tasarım': ['kodhane', 'bulut', 'piksel'],
  'Yazılım Geliştirme': ['kodhane', 'bulut'],
  'Grafik Tasarım': ['piksel', 'reklamhane'],
  'Dijital Pazarlama': ['reklamhane', 'piksel'],
  'Video & Animasyon': ['kadraj'],
  'Etkinlik & Organizasyon': ['sahne', 'kadraj'],
  'Çeviri & Metin': ['dilmer'],
  Eğitim: ['nalan', 'dilmer'],
  Danışmanlık: ['akin'],
  Diğer: ['usta', 'isilti']
};

const onSiteCategories = ['İnşaat & Tadilat', 'Nakliye & Lojistik', 'Temizlik', 'Diğer'];

const onSiteBidTexts = [
  'Gelip bakmadan net fiyat vermek istemem, yazdığım tutar tahmini. Keşif ücretsiz.',
  'Fiyata işçilik ve malzeme dahil. Malzemeyi siz alırsanız düşeriz.',
  'Bu hafta müsaidiz, hemen başlayabiliriz. Yarısı başta, yarısı iş bitince.',
  'Faturalı fiyattır, KDV dahil değil.',
  'Benzer bir işi geçen ay yaptık, isterseniz fotoğraflarını gönderebilirim.'
];
const remoteBidTexts = [
  'Önce kısa bir görüşme yapalım, kapsamı netleştirince son fiyatı söylerim.',
  'KDV dahil değil. Yüzde 30 ön ödeme, kalanı teslimde.',
  'Benzer işlerden örnek gönderebilirim, mesaj atmanız yeterli.',
  'Süreyi yoğunluğumuza göre yazdım, acelesi varsa kısaltabiliriz.',
  'Bu fiyata iki revizyon dahil.'
];

const img = (...names) => names.map(name => `/img/ilan/${name}.jpg`);

// [sahip, başlık, kategori, il, ilçe, enAz, enFazla, kaçSaatÖnce, görüntülenme, teklifSayısı, fotoğraflar, açıklama, ek]
const listings = [
  // İnşaat ve tadilat
  ['elif', 'Mutfak dolapları ve tezgah yenilenecek', 'İnşaat & Tadilat', 'İstanbul', 'Kadıköy', 60000, 95000, 5, 64, 0, img('mutfak2', 'mutfak3'),
    'Yaklaşık 12 m2 mutfak. Eski dolaplar sökülecek, moloz da alınsın. Tezgah kuvars olsun diye düşünüyorum ama başka önerilere açığım.\n\nAnkastre fırın ve ocak bende var, aynısını kullanacağım. 3. kat, asansör var.',
    { deadline: 40, discoveryTime: 'Hafta içi akşam (18:00 - 21:00)',
      questions: [
        ['yilmaz', 'Dolaplar L mi düz mü? Ölçüleri yazabilir misiniz, ona göre çizim hazırlayayım.', 'L şeklinde. Kısa kenar 2,1 m, uzun kenar 3,4 m. Kolon yok.', 0.6],
        ['usta', 'Davlumbaz da değişecek mi, yoksa mevcut olan mı takılacak?', null, 0.3]
      ],
      bids: [['usta', 78000, 21, 'Keşif ücretsiz. Söküm, moloz, MDF lake dolap ve kuvars tezgah fiyata dahil. İşçiliğe 2 yıl garanti.', 'pending'], ['yilmaz', 91000, 30, 'Dolapları kendi atölyemizde yapıyoruz. Tezgah ve aydınlatma dahil anahtar teslim.', 'pending']] }],
  ['burak', 'Banyo komple yenilenecek, 6 m2', 'İnşaat & Tadilat', 'Ankara', 'Çankaya', 70000, 0, 30, 88, 0, [],
    'Fayans, lavabo, klozet ve duş kabini değişecek. Tesisat 25 yıllık, o da yenilenmeli. Malzemeyi birlikte seçebiliriz.',
    { deadline: 25, discoveryTime: 'Hafta sonu herhangi bir saat',
      questions: [['temel', 'Altınızda daire var mı? Su yalıtımını ona göre planlıyoruz.', 'Var, ikinci kattayım. Alt komşunun tavanında eskiden leke olmuştu.', 0.7]],
      bids: [['temel', 76500, 15, 'Ankara içi keşif ücretsiz. Su yalıtımı dahil.', 'pending'], ['usta', 82000, 12, 'Tesisat, seramik işçiliği ve vitrifiye montajı dahil. Ankara dışından geliyoruz, yol masrafı içinde.', 'pending']] }],
  ['aysel', '3+1 daire boya badana, kiracı çıktı', 'İnşaat & Tadilat', 'Antalya', 'Muratpaşa', 18000, 28000, 2, 19, 1, [],
    '110 m2 boş daire. Komple boyanacak, tavanlar dahil. Renk beyaz, salonda bir duvar açık gri olabilir. Bu hafta başlanırsa iyi olur.', { deadline: 6 }],
  ['hatice', 'Alt komşuya su sızıyor, kaçak tespiti lazım', 'İnşaat & Tadilat', 'Konya', 'Selçuklu', 0, 0, 3, 41, 1, img('tesisat'),
    'Banyodan alt kata su iniyor. Kırmadan cihazla kaçak tespiti yapan tesisat ustası arıyorum. Acele.', { deadline: 3, urgent: true }],
  ['okan', 'Eski evin elektrik tesisatı yenilenecek', 'İnşaat & Tadilat', 'Muğla', 'Milas', 30000, 50000, 80, 52, 2, img('elektrik'),
    '30 yıllık 2 katlı ev. Pano ve hatlar komple değişecek. Yetki belgeli usta olsun, abonelik işlerinde de yardım lazım.', {}],
  ['elif', 'Lavabo gideri ve batarya değişimi', 'İnşaat & Tadilat', 'İstanbul', 'Maltepe', 1500, 4000, 6, 23, 2, [],
    'Banyo lavabosu su kaçırıyor, batarya da eski. Hafta içi akşam gelebilecek usta olursa süper olur.', { deadline: 3 }],
  ['onur', 'Salon parke değişimi 35 m2', 'İnşaat & Tadilat', 'Antalya', 'Konyaaltı', 14000, 24000, 36, 47, 2, img('salon2'),
    'Laminat parke sökülüp yenisi döşenecek, süpürgelik dahil. Malzemeyi firma getirsin.', {}],
  ['okan', 'Müstakil ev dış cephe mantolama', 'İnşaat & Tadilat', 'Muğla', 'Milas', 120000, 200000, 15, 104, 3, img('ev', 'insaat'),
    '2 katlı müstakil ev, yaklaşık 220 m2 cephe. Mantolama, sıva ve boya yapılacak. İskele de sizden olsun.', { deadline: 60 }],
  ['baris', 'Apartman dış cephe mantolama, 5 kat', 'İnşaat & Tadilat', 'Antalya', 'Kepez', 450000, 700000, 50, 156, 3, img('santiye'),
    'Yönetim olarak fiyat topluyoruz. Yaklaşık 900 m2 cephe, iskele dahil. Karar kat malikleri toplantısında verilecek, o yüzden yazılı teklif lazım.', { deadline: 21 }],
  ['ipek', 'Mutfak dolabı kapakları değişecek', 'İnşaat & Tadilat', 'Eskişehir', 'Odunpazarı', 12000, 22000, 17, 33, 2, [],
    'Gövdeler sağlam, sadece kapak ve kulplar değişecek. 14 kapak var. Mat beyaz düşünüyorum.', {}],
  ['nur', 'Banyo fayans tamiri, derzler de yenilensin', 'İnşaat & Tadilat', 'Konya', 'Meram', 5000, 12000, 42, 29, 2, img('banyo2'),
    'Birkaç kırık fayans ve kararmış derzler var. Komple yenileme istemiyorum, masraflı olur.', {}],
  ['fatma', 'Cam balkon yaptırmak istiyorum', 'İnşaat & Tadilat', 'Muğla', 'Fethiye', 45000, 80000, 28, 61, 2, [],
    '8 metre balkon, ısıcamlı katlanır sistem. Fiyata montaj dahil olsun. Site yönetiminden izin aldım.', {}],
  ['tuncay', 'Dükkan elektrik panosu ve led aydınlatma', 'İnşaat & Tadilat', 'Bursa', 'Yıldırım', 18000, 32000, 21, 38, 2, [],
    '60 m2 dükkan. Pano yenilenecek, floresanlar kalkıp led gelecek. Belgeli usta arıyorum.', {}],
  ['derya', '2+1 daire boya, kapılar dahil', 'İnşaat & Tadilat', 'Ankara', 'Keçiören', 15000, 22000, 4, 17, 2, img('oda'),
    'Yaklaşık 85 m2. İç kapılar ve pervazlar da boyanacak. Daire boş, ay sonuna kadar bitmeli.', { deadline: 6 }],
  ['yasemin', 'Laminat parke döşeme 90 m2', 'İnşaat & Tadilat', 'İzmir', 'Buca', 28000, 45000, 31, 44, 2, [],
    'Eskiler sökülecek. 8 mm laminat, süpürgelik, işçilik dahil fiyat istiyorum.', {}],
  ['hale', 'Salona alçıpan asma tavan ve spot', 'İnşaat & Tadilat', 'Ankara', 'Etimesgut', 10000, 18000, 58, 39, 2, img('salon'),
    'Salon ve antre toplam 40 m2. Gizli led ve 12 spot yapılacak.', {}],
  ['gamze', 'TV ünitesi yaptırmak istiyorum', 'İnşaat & Tadilat', 'Antalya', 'Kepez', 15000, 28000, 90, 36, 1, img('marangoz'),
    'Duvar boyu, kapaklı raflı TV ünitesi. Marangoz arıyorum, ölçüleri gönderebilirim.', {}],
  ['emine', 'Kombi petek temizliği ve tesisat kontrolü', 'İnşaat & Tadilat', 'İzmir', 'Karşıyaka', 0, 3000, 11, 12, 0, [],
    'Petekler alttan ısınmıyor. Kışa girmeden temizlik yaptırmak istiyorum. 3 oda 1 salon.', {}],
  ['ali', 'Dükkan vitrin ve iç düzenleme', 'İnşaat & Tadilat', 'Konya', 'Karatay', 35000, 60000, 26, 58, 2, img('magaza'),
    'Giyim mağazası, 70 m2. Raf sistemi, vitrin ve aydınlatma yenilenecek.', { deadline: 30 }],
  ['yusuf', 'Çatı aktarımı, kiremitler kırık', 'İnşaat & Tadilat', 'Trabzon', 'Akçaabat', 0, 0, 70, 27, 1, [],
    'Müstakil ev, yaklaşık 120 m2 çatı. Yağmurda içeri su alıyor. Gelip baksınlar, ona göre fiyat versinler.', {}],

  // Nakliye
  ['derya', 'Ankara içi evden eve nakliyat, 2+1', 'Nakliye & Lojistik', 'Ankara', 'Mamak', 8000, 15000, 3, 31, 2, img('kargo'),
    '4. kat asansörsüz, yeni ev 2. kat asansörlü. Ay sonunda taşınacağız. Beyaz eşya sökülüp takılıyor mu onu da yazın.', { deadline: 5 }],
  ['melis', 'Evden eve nakliyat Antalya - İstanbul', 'Nakliye & Lojistik', 'Antalya', 'Kepez', 25000, 45000, 11, 89, 2, img('tir'),
    '3+1 ev eşyası. Antalya 2. kat asansörsüz, İstanbul Ataşehir 7. kat asansörlü. Ocak başında taşınacağım. Sigortalı olsun lütfen.', { deadline: 50 }],
  ['canan', 'İstanbul - Bursa evden eve nakliyat', 'Nakliye & Lojistik', 'İstanbul', 'Ataşehir', 22000, 38000, 37, 72, 2, [],
    '3+1 ev. Mobilya söküm ve kurulum dahil fiyat istiyorum.', {}],
  ['burak', '12 kişilik ofis taşınacak, Kızılay - Söğütözü', 'Nakliye & Lojistik', 'Ankara', 'Çankaya', 0, 40000, 30, 64, 2, img('tasima'),
    'Masalar, dolaplar, sunucu kabini var. Paketleme ve yeni ofiste kurulum dahil olmalı. Hafta sonu taşınmak istiyoruz.', { deadline: 14 }],
  ['songul', 'Konya - Ankara parça eşya, buzdolabı ve koliler', 'Nakliye & Lojistik', 'Konya', 'Selçuklu', 0, 7000, 19, 25, 2, [],
    'Bir buzdolabı, bir çamaşır makinesi ve 10 koli. Ambalajlı alınsın.', {}],
  ['tuncay', 'Bursa - İzmir 2 palet parça yük', 'Nakliye & Lojistik', 'Bursa', 'Nilüfer', 0, 9000, 12, 30, 2, img('depo'),
    'Paletli tekstil ürünü, toplam 800 kg. Haftaya gidecek. Faturalı.', { deadline: 7 }],
  ['ozan', 'İzmir limanına konteyner taşıması', 'Nakliye & Lojistik', 'Eskişehir', 'Tepebaşı', 0, 0, 86, 41, 1, img('konteyner'),
    '20 ft konteyner. Aylık düzenli iş olabilir.', {}],
  ['sinan', 'Depodaki koliler taşınacak', 'Nakliye & Lojistik', 'Muğla', 'Milas', 0, 6000, 9, 14, 2, [],
    'Depodaki 30 koli ve birkaç raf ilçe içinde taşınacak. Kamyonet yeterli.', {}],
  ['cem', 'Öğrenci evi taşıma, birkaç parça eşya', 'Nakliye & Lojistik', 'İzmir', 'Bornova', 0, 2500, 7, 11, 1, [],
    'Bir yatak, masa, dolap ve 5-6 koli. Aynı ilçe içinde. Kamyonetli biri yeter.', {}],

  // Temizlik
  ['yasemin', 'Ev temizliği, haftada bir gün', 'Temizlik', 'İzmir', 'Karşıyaka', 2500, 4500, 10, 28, 2, [],
    '3+1 ev temizliği. Düzenli gelecek, referansı olan kişi veya firma arıyorum.', {}],
  ['hatice', 'Apartman merdiven temizliği', 'Temizlik', 'Konya', 'Meram', 3000, 5000, 28, 26, 1, img('cam'),
    '6 katlı, 12 daireli apartman. Haftada 2 gün merdiven, asansör ve giriş. Yıllık anlaşma yapılabilir.', {}],
  ['hale', 'İnşaat sonrası ev temizliği', 'Temizlik', 'Ankara', 'Çankaya', 5000, 9000, 15, 35, 1, img('temizlik'),
    '140 m2 dubleks. Tadilat bitti, her yer boya ve toz.', { deadline: 5 }],
  ['deniz', 'Ofis temizliği, haftada 2 gün', 'Temizlik', 'İzmir', 'Bornova', 3000, 6000, 23, 20, 1, [],
    '90 m2 ofis. Malzeme firmadan olsun.', { deadline: 10 }],
  ['ayten', 'Koltuk ve halı yıkama, muayenehane', 'Temizlik', 'Bursa', 'Osmangazi', 3000, 7000, 46, 24, 2, [],
    'Bekleme salonundaki koltuklar ve 40 m2 halı yerinde yıkanacak. Pazar günü olursa iyi olur.', {}],
  ['hulya', 'Yazlık açılış temizliği', 'Temizlik', 'Muğla', 'Datça', 2500, 5000, 66, 31, 1, [],
    '2+1 yazlık, kışın kapalı kaldı. Cam dahil genel temizlik yapılacak.', {}],
  ['elif', 'Koltuk yıkama, 3+3+1 takım', 'Temizlik', 'İstanbul', 'Kadıköy', 0, 2000, 170, 18, 0, [],
    'Yerinde koltuk yıkama. Bir de 2 sandalye var.', {}],

  // Web
  ['elif', 'Kafem için web sitesi yaptırmak istiyorum', 'Web Tasarım', 'İstanbul', 'Beşiktaş', 15000, 30000, 20, 96, 0, img('kafe'),
    'Yeni açtığımız kafe için menü, konum ve iletişim sayfası olan sade bir site lazım. Telefonda düzgün görünsün. Menüyü kendim güncelleyebilmeliyim.\n\nAlan adı ve hosting de dahil olursa iyi olur.',
    { deadline: 30, bids: [['kodhane', 22000, 14, 'Tasarım, kurulum ve 1 yıl hosting dahil. Menü için yönetim paneli de ekliyoruz.', 'pending'], ['piksel', 18500, 21, 'Size özel tasarım yaparım. Alan adının ilk yılı benden.', 'pending']] }],
  ['kerem', 'Yazılım firmamıza tanıtım sitesi ve SEO', 'Web Tasarım', 'Eskişehir', 'Tepebaşı', 12000, 25000, 96, 59, 2, [],
    '5 sayfalık tanıtım sitesi ve temel SEO. İçerikleri biz vereceğiz.', {}],
  ['sevgi', 'Pansiyonum için web sitesi', 'Web Tasarım', 'Antalya', 'Kaş', 15000, 28000, 19, 50, 2, img('web'),
    'Rezervasyon formu, fotoğraf galerisi, Türkçe ve İngilizce. Telefondan rahat kullanılmalı.', {}],
  ['tolga', 'Emlak ofisi kurumsal web sitesi', 'Web Tasarım', 'Muğla', 'Bodrum', 25000, 45000, 63, 66, 2, [],
    'İlan ekleme paneli olmalı. Hazır tema da olur, yeter ki kurumsal dursun.', {}],
  ['nur', 'WordPress sitem yenilenecek', 'Web Tasarım', 'Konya', 'Selçuklu', 6000, 12000, 25, 30, 2, [],
    'Mevcut site çok yavaş, telefonda da bozuk. Site yenileme yapılacak, içerik aynı kalacak.', {}],

  // Yazılım
  ['zeynep', '200 ürünlük butik için e-ticaret sitesi', 'Yazılım Geliştirme', 'İzmir', 'Konak', 40000, 75000, 48, 150, 1, img('odeme'),
    'Sanal POS, kargo entegrasyonu ve stok takibi olmalı. Ürünleri kendim ekleyeceğim. Hazır altyapı da olur, özel yazılım da.', { deadline: 45 }],
  ['murat', 'Restoran zinciri için mobil sipariş uygulaması', 'Yazılım Geliştirme', 'Bursa', 'Osmangazi', 90000, 160000, 72, 160, 1, img('mobil', 'yazilimci'),
    'iOS ve Android mobil uygulama. Üyelik, sepet, online ödeme, şube seçimi. Kasa sistemiyle entegrasyon olursa artı.', { deadline: 60 }],
  ['tuncay', 'Stok ve üretim takip otomasyonu', 'Yazılım Geliştirme', 'Bursa', 'Nilüfer', 120000, 220000, 34, 100, 1, [],
    'Tekstil atölyesi için sipariş, üretim ve stok takibi. Barkod desteği olmalı.', { deadline: 45 }],
  ['ozan', 'Python ile Excel raporlama aracı', 'Yazılım Geliştirme', 'Eskişehir', 'Tepebaşı', 20000, 40000, 110, 64, 1, img('kod'),
    'Excel dosyalarından haftalık rapor çıkaran basit bir araç. Windows üzerinde çalışacak.', {}],
  ['sevgi', 'Pansiyon için mobil rezervasyon uygulaması', 'Yazılım Geliştirme', 'Antalya', 'Kaş', 60000, 110000, 77, 57, 1, [],
    'iOS ve Android. Oda takvimi, ödeme ve bildirim olmalı.', {}],

  // Grafik
  ['zeynep', 'Seramik markam için logo ve etiket', 'Grafik Tasarım', 'İzmir', 'Karşıyaka', 8000, 18000, 3, 20, 2, img('logo'),
    'El yapımı seramik satacağız. Logo, kartvizit ve ambalaj etiketi lazım. Sade ve sıcak bir şey olsun.', { deadline: 20 }],
  ['elif', 'Kafe menüsü ve kartvizit', 'Grafik Tasarım', 'İstanbul', 'Beşiktaş', 3000, 7000, 8, 17, 2, [],
    'A4 menü, masa üstü kart ve kartvizit. Logomuz var.', {}],
  ['levent', 'Şirket logosu yenilenecek', 'Grafik Tasarım', 'Ankara', 'Yenimahalle', 5000, 12000, 56, 42, 2, [],
    'Eski logoyu güncellemek istiyoruz. Üç alternatif görmek isterim.', {}],
  ['kerem', 'Uygulama için arayüz tasarımı (Figma)', 'Grafik Tasarım', 'Eskişehir', 'Odunpazarı', 15000, 30000, 44, 52, 2, img('tablet'),
    'Yaklaşık 25 ekranlık mobil uygulama. Wireframe bizde hazır, görsel tasarım lazım.', {}],
  ['ali', 'Mobilya kataloğu ve broşür', 'Grafik Tasarım', 'Konya', 'Selçuklu', 5000, 11000, 30, 32, 2, img('grafik'),
    '16 sayfa katalog ve tek sayfa broşür. Fotoğraflar hazır.', {}],

  // Pazarlama
  ['zeynep', 'Instagram yönetimi ve reklam (aylık)', 'Dijital Pazarlama', '', '', 12000, 22000, 26, 33, 2, [],
    'Aylık içerik planı, görsel üretimi ve reklam yönetimi lazım. Uzaktan çalışılabilir.', {}],
  ['tolga', 'Emlak ofisi için Instagram yönetimi', 'Dijital Pazarlama', 'Muğla', 'Bodrum', 10000, 18000, 39, 37, 2, img('analiz'),
    'Haftada 3 paylaşım, reklam yönetimi ve aylık rapor.', {}],
  ['ozan', 'Google Ads kurulumu, küçük bütçe', 'Dijital Pazarlama', 'Eskişehir', 'Tepebaşı', 3000, 8000, 54, 28, 1, [],
    'Aylık 10 bin TL reklam bütçesi için kampanya kurulumu ve takibi.', {}],
  ['sevgi', 'Yerel SEO ve Google işletme profili', 'Dijital Pazarlama', 'Antalya', 'Kaş', 5000, 12000, 68, 24, 2, [],
    'Kaş pansiyon aramalarında üst sıralara çıkmak istiyorum. Google profilim de düzenlenecek.', {}],

  // Video
  ['tuncay', 'Fabrika tanıtım filmi, yaklaşık 2 dk', 'Video & Animasyon', 'Bursa', 'Nilüfer', 35000, 60000, 14, 47, 1, img('klaket'),
    'Tekstil fabrikamızın üretim sürecini anlatan film. Fuarda ve web sitesinde kullanacağız. Dış ses ve İngilizce altyazı gerekli.', { deadline: 35 }],
  ['seda', 'Düğün fotoğraf ve video çekimi', 'Video & Animasyon', 'Antalya', 'Muratpaşa', 20000, 40000, 13, 80, 1, [],
    "Haziran'da kır düğünü. Dış çekim, drone ve klip dahil paket arıyorum.", { deadline: 90 }],
  ['zeynep', 'Instagram için 5 ürün videosu', 'Video & Animasyon', 'İzmir', 'Konak', 12000, 22000, 29, 41, 1, img('kamera'),
    'Seramik ürünlerimizin kısa dikey videoları. Atölyemizde çekilebilir.', {}],
  ['kerem', 'Uygulama tanıtım animasyonu', 'Video & Animasyon', 'Eskişehir', 'Tepebaşı', 8000, 16000, 92, 28, 1, img('montaj'),
    '60 saniyelik 2D animasyon. Senaryo bizde hazır.', {}],

  // Etkinlik
  ['burak', 'Şirket yıl sonu yemeği, 120 kişi', 'Etkinlik & Organizasyon', 'Ankara', 'Çankaya', 80000, 130000, 16, 39, 2, img('davet'),
    'Mekan, menü, sahne, ses sistemi ve canlı müzik dahil. Aralığın ikinci haftası düşünüyoruz.', { deadline: 32 }],
  ['songul', 'Kına gecesi organizasyonu, 80 kişi', 'Etkinlik & Organizasyon', 'Konya', 'Karatay', 25000, 45000, 38, 42, 1, [],
    'Salon var. Süsleme, ses sistemi ve yemek ayarlanacak.', { deadline: 45 }],
  ['elif', 'Doğum günü organizasyonu, 40 kişi', 'Etkinlik & Organizasyon', 'İstanbul', 'Kadıköy', 15000, 28000, 24, 45, 2, img('balon'),
    '5 yaş doğum günü. Süsleme, pasta ve animatör dahil. Mekan bizde.', { deadline: 18 }],
  ['murat', 'Şirket pikniği, ses sistemi ve sahne', 'Etkinlik & Organizasyon', 'Bursa', 'İnegöl', 30000, 55000, 83, 35, 2, [],
    '150 kişilik şirket pikniği. Ses sistemi, sahne ve çocuklar için oyun alanı lazım.', {}],

  // Çeviri
  ['hatice', 'Diploma ve transkript yeminli İngilizce çeviri', 'Çeviri & Metin', 'Konya', 'Selçuklu', 500, 2000, 18, 20, 1, [],
    '4 sayfa. Noter onaylı olacak. Yurt dışı başvurusu için 1 hafta içinde lazım.', { deadline: 7 }],
  ['kadir', 'Teknik şartname çevirisi, 60 sayfa', 'Çeviri & Metin', 'Muğla', 'Bodrum', 8000, 15000, 120, 21, 1, [],
    'Türkçeden Almancaya. Makine sektörü, teknik terim çok.', {}],
  ['kerem', 'Web sitesi metin yazarlığı, 10 sayfa', 'Çeviri & Metin', 'Eskişehir', 'Tepebaşı', 4000, 9000, 45, 23, 1, [],
    'Yazılım firmamız için hizmet sayfası metinleri. SEO bilen biri olsun.', {}],
  ['burak', 'Ticari sözleşme yeminli Almanca çeviri', 'Çeviri & Metin', 'Ankara', 'Çankaya', 1500, 4000, 35, 19, 1, img('sozlesme'),
    '12 sayfa ticari sözleşme, noter onayı gerekli.', { deadline: 6 }],

  // Eğitim
  ['aysel', '8. sınıf matematik özel ders (LGS)', 'Eğitim', 'Antalya', 'Konyaaltı', 0, 6000, 8, 18, 1, [],
    'LGS hazırlık, haftada 2 gün. Yüz yüze tercih ederim.', {}],
  ['deniz', 'Fizik özel ders, 12. sınıf', 'Eğitim', 'İzmir', 'Bornova', 0, 8000, 13, 27, 1, img('egitim'),
    'Üniversite sınavına hazırlanıyor. Haftada 2 gün yüz yüze.', {}],
  ['murat', 'Satış ekibine iş İngilizcesi eğitimi', 'Eğitim', 'Bursa', 'Osmangazi', 20000, 35000, 40, 30, 1, img('ingilizce'),
    '8 kişilik ekibimiz, haftada 2 gün, 3 ay. Yüz yüze ya da online olabilir. Seviyeler karışık.', { deadline: 21 }],
  ['pinar', 'Otel ekibine ilk yardım eğitimi', 'Eğitim', 'Muğla', 'Bodrum', 6000, 12000, 98, 17, 1, [],
    '20 kişilik ekibimiz için sertifikalı ilk yardım eğitimi.', {}],

  // Danışmanlık
  ['kerem', 'Limited şirket kuruluşu ve muhasebe', 'Danışmanlık', 'Eskişehir', 'Tepebaşı', 8000, 15000, 22, 38, 1, [],
    'İki ortaklı yazılım şirketi kuracağız. Kuruluş ve aylık muhasebe için fiyat almak istiyoruz. Genç girişimci desteğini de sormak isterim.', {}],
  ['ali', 'Dükkan kira sözleşmesi için hukuk desteği', 'Danışmanlık', 'Konya', 'Selçuklu', 2000, 6000, 20, 25, 1, [],
    'Kira sözleşmesini imzalamadan önce avukata kontrol ettirmek istiyorum.', {}],
  ['deniz', '80 m2 showroom yerleşim ve aydınlatma', 'Danışmanlık', 'İzmir', 'Bornova', 10000, 25000, 60, 26, 1, img('oda2'),
    'Mobilya showroomumuz var. Yerleşim planı ve aydınlatma için danışmanlık almak istiyoruz. 3D görsel olursa iyi olur.', { deadline: 28 }],
  ['levent', "Çin'den ithalat için gümrük danışmanlığı", 'Danışmanlık', 'Ankara', 'Yenimahalle', 0, 0, 130, 31, 1, [],
    'İlk kez konteyner getireceğim. Süreç hakkında destek arıyorum.', {}],
  ['sevgi', 'Pansiyon muhasebesi, aylık', 'Danışmanlık', 'Antalya', 'Kaş', 0, 5000, 71, 20, 1, [],
    'Aylık muhasebe ve beyanname takibi. Uzaktan olabilir.', {}],

  // Diğer
  ['ibrahim', 'Bahçe düzenleme ve çim serimi', 'Diğer', 'Muğla', 'Bodrum', 40000, 70000, 33, 56, 1, img('bahce'),
    'Villa bahçesi yaklaşık 300 m2. Çim, sulama sistemi ve birkaç ağaç dikimi yapılacak. Peyzaj önerisi de alırım.', {}],
  ['ibrahim', 'Villaya kamera ve akıllı kilit sistemi', 'Diğer', 'Muğla', 'Bodrum', 55000, 90000, 52, 69, 0, img('kilit'),
    'Akıllı kilit, 6 kamera, alarm ve aydınlatma kontrolü. Telefondan yönetilebilsin. Kablolama için tadilat istemiyorum.', {}],
  ['ipek', 'Ofise 10 adet sandalye tedariği', 'Diğer', 'Eskişehir', 'Tepebaşı', 25000, 40000, 74, 27, 1, img('sandalye'),
    '10 adet ofis sandalyesi tedarik edilecek. Faturalı, teslim dahil fiyat.', {}],
  ['murat', 'Toplantı odası ses ve görüntü sistemi', 'Diğer', 'Bursa', 'Nilüfer', 30000, 50000, 100, 33, 1, [],
    'Video konferans ekranı, kamera, tavan mikrofonu. Kurulum dahil teklif rica ederim.', {}],
  ['canan', 'Teras için bahçe mobilyası ve bitki', 'Diğer', 'İstanbul', 'Sarıyer', 20000, 40000, 44, 39, 1, [],
    '30 m2 teras. Oturma grubu, saksı ve bitki önerisiyle birlikte fiyat istiyorum.', {}],

  // Devam eden işler
  ['elif', '45 m2 salon ve koridor boya badana', 'İnşaat & Tadilat', 'İstanbul', 'Üsküdar', 12000, 20000, 216, 74, 0, img('boya'),
    'Salon ve koridor boyanacak. Birkaç yerde küçük çatlak var, alçı tamiri gerekiyor. Eşyalar evde, üstleri örtülmeli.',
    { status: 'in_progress', bids: [['usta', 16500, 4, 'Silinebilir boya ve alçı tamiri dahil. Mobilyaları örtüp 4 günde bitiriyoruz.', 'accepted']] }],
  ['murat', 'Fuar standı için ürün videosu', 'Video & Animasyon', 'Bursa', 'Osmangazi', 15000, 28000, 144, 53, 0, [],
    '45 saniyelik, sessiz, döngülü ürün videosu. Fuar ekranlarında dönecek.',
    { status: 'in_progress', bids: [['kadraj', 22000, 10, 'Stüdyo çekimi, kurgu ve döngüye uygun çıktı dahil.', 'accepted']] }],

  // Tamamlanan işler
  ['elif', 'Ofis derin temizlik (tadilat sonrası)', 'Temizlik', 'İstanbul', 'Şişli', 4000, 8000, 504, 58, 0, [],
    '120 m2 ofis. Tadilat yeni bitti, cam, zemin ve mutfak dahil derin temizlik yapılacak.',
    { status: 'completed', bids: [['isilti', 6200, 1, '4 kişilik ekiple tek günde bitiriyoruz. Malzeme bize ait.', 'accepted']] }],
  ['murat', 'Depo kurulumu ve palet taşıma', 'Nakliye & Lojistik', 'Bursa', 'Nilüfer', 30000, 55000, 672, 102, 0, [],
    '400 m2 deponun raf ve paletleri yeni depoya taşınacak.',
    { status: 'completed', bids: [['mavi', 42000, 3, 'Forklift, 3 kamyon ve 6 kişilik ekip dahil. Raf kurulumu bizden.', 'accepted'], ['anadolu', 48000, 4, 'Komple araçla taşıma, sigorta dahil.', 'rejected']] }],
  ['burak', 'Teras su yalıtımı, 60 m2', 'İnşaat & Tadilat', 'Ankara', 'Etimesgut', 18000, 32000, 360, 71, 0, [],
    'Teras katta su sızıntısı var. Yalıtım yenilenecek.',
    { status: 'completed', bids: [['temel', 26000, 6, 'Söküm, iki kat yalıtım ve seramik dahil. 5 yıl garanti.', 'accepted'], ['usta', 29500, 8, 'Yalıtım ve seramik işçiliği dahil, 2 yıl garanti.', 'rejected']] }],
  ['zeynep', 'Ürün kataloğu tasarımı, 24 sayfa', 'Grafik Tasarım', 'İzmir', 'Konak', 6000, 14000, 840, 88, 0, img('kitap'),
    'Yeni sezon ürünleri için baskıya hazır katalog.',
    { status: 'completed', bids: [['piksel', 9500, 12, 'Sayfa düzeni, görsel düzenleme ve baskı dosyası dahil.', 'accepted']] }],
  ['burak', 'Kurumsal site yenileme', 'Web Tasarım', 'Ankara', 'Çankaya', 25000, 45000, 1150, 164, 0, img('toplanti'),
    '10 yıllık siteyi mobil uyumlu ve hızlı hale getirmek istiyoruz.',
    { status: 'completed', bids: [['kodhane', 36000, 25, 'Yeni tasarım, içerik aktarımı ve 1 yıl bakım dahil.', 'accepted'], ['piksel', 41000, 30, 'Tasarım ağırlıklı çözüm.', 'rejected']] }],
  ['hatice', 'Banyo tadilatı, 5 m2 komple', 'İnşaat & Tadilat', 'İstanbul', 'Bakırköy', 45000, 70000, 1400, 143, 0, img('banyo'),
    'Fayans, vitrifiye ve tesisat komple yenilendi.',
    { status: 'completed', bids: [['usta', 58000, 10, 'Malzeme seçimi dahil anahtar teslim.', 'accepted']] }],
  ['zeynep', 'Salon ve yatak odası boya', 'İnşaat & Tadilat', 'İstanbul', 'Maltepe', 9000, 16000, 900, 88, 0, img('salon5'),
    'İki oda boyanacak, eşyalar evde.',
    { status: 'completed', bids: [['usta', 12500, 3, 'Silinebilir boya, koruma örtüsü dahil.', 'accepted'], ['yilmaz', 15000, 5, 'İşçilik ve malzeme dahil.', 'rejected']] }],
  ['gamze', 'Ankara - Eskişehir evden eve nakliyat', 'Nakliye & Lojistik', 'Ankara', 'Çankaya', 15000, 25000, 620, 76, 0, [],
    '2+1 ev. Yeni ev zemin kat.',
    { status: 'completed', bids: [['mavi', 19000, 1, 'Asansörlü araç, paketleme dahil.', 'accepted']] }],
  ['ali', 'Apartman giriş ve merdiven boyası', 'İnşaat & Tadilat', 'Antalya', 'Kepez', 10000, 18000, 780, 40, 0, [],
    'Giriş ve 4 katın merdiven boşluğu boyanacak.',
    { status: 'completed', bids: [['kara', 14000, 3, 'Boya benden, 3 günde biter.', 'accepted']] }],
  ['derya', 'Taşınmadan önce ev temizliği', 'Temizlik', 'Bursa', 'Nilüfer', 2000, 4000, 410, 33, 0, [],
    '2+1 boş ev. Mutfak dolaplarının içi de silinecek.',
    { status: 'completed', bids: [['piril', 3400, 1, 'İki kişi tek günde hallederiz.', 'accepted']] }],
  ['cem', 'Kahve dükkanı için logo', 'Grafik Tasarım', 'İzmir', 'Konak', 4000, 9000, 980, 67, 0, [],
    'Yeni açılacak küçük bir kahve dükkanı. Kartvizit de olabilir.',
    { status: 'completed', bids: [['piksel', 6500, 7, 'Üç taslak, iki revizyon.', 'accepted']] }],
  ['kerem', 'Google reklam kurulumu', 'Dijital Pazarlama', 'Eskişehir', 'Tepebaşı', 3000, 7000, 1250, 45, 0, [],
    'Yeni açtığımız site için arama reklamı.',
    { status: 'completed', bids: [['reklamhane', 4500, 5, 'Kurulum ve ilk ay takibi dahil.', 'accepted']] }],
  ['fatma', 'Düğün fotoğrafı ve klip', 'Video & Animasyon', 'Bursa', 'Mudanya', 18000, 30000, 1620, 121, 0, img('konferans'),
    'Eylül sonunda sahilde düğün.',
    { status: 'completed', bids: [['kadraj', 24000, 21, 'Tüm gün çekim, drone ve klip dahil.', 'accepted']] }],
  ['nur', 'Kına organizasyonu, 60 kişi', 'Etkinlik & Organizasyon', 'İstanbul', 'Esenyurt', 15000, 25000, 1080, 58, 0, [],
    'Salon belli, süsleme ve ses sistemi lazım.',
    { status: 'completed', bids: [['sahne', 19000, 1, 'Süsleme, ses sistemi ve kına tepsisi dahil.', 'accepted']] }],
  ['yusuf', 'Lise diploması yeminli çeviri', 'Çeviri & Metin', 'Ankara', 'Çankaya', 500, 1500, 300, 22, 0, [],
    'İngilizce, noter onaylı.',
    { status: 'completed', bids: [['dilmer', 900, 1, 'Noter dahil, aynı gün kargolarız.', 'accepted']] }],
  ['baris', 'Limited şirket kuruluşu', 'Danışmanlık', 'İstanbul', 'Kartal', 5000, 10000, 1500, 49, 0, [],
    'Tek ortaklı inşaat şirketi kurulacak.',
    { status: 'completed', bids: [['akin', 7500, 5, 'Kuruluş ve ilk ay beyannameleri dahil.', 'accepted']] }],
  ['emine', 'LGS için matematik dersi', 'Eğitim', 'İzmir', 'Karşıyaka', 4000, 8000, 860, 36, 0, [],
    '8. sınıf, haftada 2 gün.',
    { status: 'completed', bids: [['nalan', 6000, 30, 'Aylık ücrettir, haftada 2 ders.', 'accepted']] }],
  ['tuncay', 'Atölyeye pano ve aydınlatma', 'İnşaat & Tadilat', 'Bursa', 'Yıldırım', 15000, 25000, 720, 39, 0, [],
    '120 m2 atölye, pano değişecek.',
    { status: 'completed', bids: [['yildirim', 21000, 4, 'Malzeme dahil, belgeli işçilik.', 'accepted']] }],
  ['gamze', 'Balkon camı, 5 metre', 'İnşaat & Tadilat', 'Muğla', 'Fethiye', 30000, 45000, 1300, 44, 0, [],
    'Katlanır sistem, 5 metre.',
    { status: 'completed', bids: [['aydin', 38000, 7, 'Isıcam, montaj dahil.', 'accepted']] }],
  ['cem', 'İzmir - Aydın parça eşya', 'Nakliye & Lojistik', 'İzmir', 'Bornova', 0, 4000, 460, 19, 0, [],
    'Bir kanepe ve 6 koli.',
    { status: 'completed', bids: [['gezgin', 3000, 1, 'Yarın çıkan araca ekleyebilirim.', 'accepted']] }],
  ['hatice', 'Küçük stok programı', 'Yazılım Geliştirme', 'Konya', 'Selçuklu', 10000, 20000, 1040, 51, 0, [],
    'Dükkan için giriş çıkış takibi yapan basit bir program.',
    { status: 'completed', bids: [['bulut', 15000, 12, 'Windows için, kurulum ve eğitim dahil.', 'accepted']] }],
  ['ali', 'Mutfak dolabı yenileme', 'İnşaat & Tadilat', 'İstanbul', 'Pendik', 40000, 65000, 1720, 81, 0, [],
    'L mutfak, dolaplar komple değişecek.',
    { status: 'completed', bids: [['yilmaz', 52000, 20, 'Kendi atölyemizde lake dolap, montaj dahil.', 'accepted']] }]
];

// Örnek konuşmalar: [talep başlığı, kişi 1, kişi 2, [[gönderen, metin, kaçSaatÖnce, okundu], ...]]
const conversations = [
  ['Mutfak dolapları ve tezgah yenilenecek', 'elif', 'usta', [
    ['usta', 'Merhaba, keşif için bu hafta uygun olduğunuz bir gün var mı?', 4, true],
    ['elif', 'Merhaba, perşembe öğleden sonra evdeyim.', 3.5, true],
    ['usta', 'Tamam, perşembe 15.00 gibi gelelim. Tezgah için birkaç numune de getiririm.', 3, false]
  ]],
  ['Kafem için web sitesi yaptırmak istiyorum', 'elif', 'kodhane', [
    ['elif', 'Menüyü sonradan kendim güncelleyebilecek miyim?', 12, true],
    ['kodhane', 'Evet, yönetim paneli teklife dahil. Fiyatları ve fotoğrafları kendiniz değiştirebilirsiniz.', 11, true],
    ['elif', 'Süper, teşekkürler. Birkaç gün içinde dönüş yaparım.', 10, true]
  ]],
  ['45 m2 salon ve koridor boya badana', 'elif', 'usta', [
    ['usta', 'Pazartesi sabah 09.00 gibi başlıyoruz, anahtar için arayacağım.', 40, true],
    ['elif', 'Tamamdır, kapıcıya bırakırım.', 38, true]
  ]],
  ['Banyo komple yenilenecek, 6 m2', 'burak', 'temel', [
    ['temel', 'Merhaba, tesisat değişirken su kesintisi 1-2 gün sürer, sorun olur mu?', 5, true],
    ['burak', 'Olmaz, ama hafta içi başlanırsa daha iyi. Fayans seçimini de görüşelim.', 2, false]
  ]]
];

const hoursAgo = hours => new Date(Date.now() - hours * 60 * 60 * 1000);
const daysFromNow = days => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// Örnek veriler her kurulumda aynı çıksın diye sabit tohumlu sayı üreteci
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// Tarihlerin korunması için Mongoose zaman damgası atlanır, doğrulama yine de çalışır.
async function insertRaw(Model, data) {
  const doc = new Model(data);
  await doc.validate();
  await Model.collection.insertOne(doc.toObject());
  return doc;
}

async function removeDemoData() {
  const users = await User.find({ email: new RegExp(`@${DEMO_DOMAIN.replace('.', '\\.')}$`) }).select('_id');
  const ids = users.map(user => user._id);
  const demoRequests = await Request.find({ customer: { $in: ids } }).select('_id');
  const requestIds = demoRequests.map(request => request._id);

  await Bid.deleteMany({ $or: [{ company: { $in: ids } }, { request: { $in: requestIds } }] });
  await Message.deleteMany({
    $or: [{ sender: { $in: ids } }, { receiver: { $in: ids } }, { request: { $in: requestIds } }]
  });
  await Review.deleteMany({ $or: [{ company: { $in: ids } }, { customer: { $in: ids } }, { request: { $in: requestIds } }] });
  await Report.deleteMany({ $or: [{ reporter: { $in: ids } }, { request: { $in: requestIds } }] });
  await Notification.deleteMany({ user: { $in: ids } });
  await SavedSearch.deleteMany({ user: { $in: ids } });
  await Request.deleteMany({ _id: { $in: requestIds } });
  await User.updateMany({}, { $pull: { favorites: { $in: requestIds } } });
  await User.deleteMany({ _id: { $in: ids } });
  return { users: ids.length, requests: requestIds.length };
}

// Otomatik teklif: bütçeye yakın tutar, kategoriye uygun firma. Aynı ildeki firmalar önce gelir.
function makeBids(category, city, min, max, count, status, random) {
  const pool = companiesByCategory[category] || companiesByCategory['Diğer'];
  const base = max || (min ? min * 1.2 : 2000 + random() * 18000);
  const start = Math.floor(random() * pool.length);
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const ordered = [
    ...rotated.filter(key => companies[key].address === city),
    ...rotated.filter(key => companies[key].address !== city)
  ];
  const texts = onSiteCategories.includes(category) ? onSiteBidTexts : remoteBidTexts;
  return ordered.slice(0, Math.min(count, ordered.length)).map((company, index) => {
    const raw = base * (0.72 + random() * 0.26);
    // İnsanlar yuvarlak fiyat verir: küçük işte 50, büyük işte 500 liranın katı
    const step = raw >= 10000 ? 500 : raw >= 2000 ? 100 : 50;
    const amount = Math.max(Math.round(raw / step) * step, step);
    // Süre işin büyüklüğüne uysun
    const [shortest, longest] = raw < 5000 ? [1, 3] : raw < 30000 ? [2, 10] : raw < 100000 ? [5, 20] : [15, 45];
    const days = shortest + Math.floor(random() * (longest - shortest + 1));
    const text = texts[Math.floor(random() * texts.length)];
    const bidState = status === 'open' ? 'pending' : index === 0 ? 'accepted' : 'rejected';
    return [company, amount, days, text, bidState];
  });
}

async function createDemoData({ showcase = false } = {}) {
  await removeDemoData();
  // Vitrin modunda (canlıda) örnek hesaplara kimse giremesin diye şifre rastgeledir.
  const password = await bcrypt.hash(showcase ? crypto.randomBytes(32).toString('hex') : DEMO_PASSWORD, 10);
  const monthsAgo = months => hoursAgo(months * 30 * 24);

  const people = {};
  for (const [key, { months, email, ...data }] of Object.entries(customers)) {
    people[key] = await insertRaw(User, {
      ...data, password, role: 'customer', email: email || `${key}@${DEMO_DOMAIN}`,
      createdAt: monthsAgo(months), updatedAt: monthsAgo(1)
    });
  }
  for (const [key, { months, email, ...data }] of Object.entries(companies)) {
    people[key] = await insertRaw(User, {
      ...data, password, role: 'company', email: email || `${key}@${DEMO_DOMAIN}`,
      categories: Object.keys(companiesByCategory).filter(category => companiesByCategory[category].includes(key)),
      verified: verifiedCompanies.includes(key),
      profileViews: 40 + ((months * 37 + key.length * 53) % 360),
      createdAt: monthsAgo(months), updatedAt: monthsAgo(1)
    });
  }
  await insertRaw(User, {
    name: 'Site Yöneticisi', email: `yonetici@${DEMO_DOMAIN}`, password, role: 'customer', isAdmin: true,
    createdAt: monthsAgo(60), updatedAt: monthsAgo(1)
  });

  const random = seededRandom(20261104);
  const requestIds = new Map();
  const ratings = new Map();

  for (const [owner, title, category, city, location, min, max, hours, views, autoBids, images, description, extra] of listings) {
    const status = extra.status || 'open';
    // Açık talepler son saatlere yığılmasın: yeniler sık, eskiler seyrek.
    const listedHours = status === 'open' ? hours ** 1.25 : hours;
    const requestId = new mongoose.Types.ObjectId();
    requestIds.set(title, requestId);
    const planned = extra.bids || makeBids(category, city, min, max, autoBids, status, random);
    const bidDocs = [];

    for (const [company, amount, deliveryTime, text, bidState] of planned) {
      const age = listedHours * (0.2 + random() * 0.75);
      bidDocs.push(await insertRaw(Bid, {
        request: requestId,
        company: people[company]._id,
        amount,
        deliveryTime,
        description: text,
        status: bidState,
        createdAt: hoursAgo(age),
        updatedAt: hoursAgo(age)
      }));
    }

    const accepted = bidDocs.find(bid => bid.status === 'accepted');
    if (status === 'completed' && accepted && demoReviews[title]) {
      const [rating, comment, reply] = demoReviews[title];
      await insertRaw(Review, {
        company: accepted.company,
        customer: people[owner]._id,
        request: requestId,
        rating,
        comment,
        ...(reply ? { reply: { text: reply, at: hoursAgo(hours * 0.2) } } : {}),
        createdAt: hoursAgo(hours * 0.3),
        updatedAt: hoursAgo(hours * 0.3)
      });
      const key = String(accepted.company);
      ratings.set(key, [...(ratings.get(key) || []), rating]);
    }
    await insertRaw(Request, {
      _id: requestId,
      title,
      description,
      category,
      budget: { min, max },
      city: city || undefined,
      location,
      images,
      customer: people[owner]._id,
      status,
      acceptedBid: accepted ? accepted._id : undefined,
      bidCount: bidDocs.length,
      // Sahibi talebe en son yayın süresinin yarısında (en çok 12 saat önce) baktı; sonra gelen teklifler "yeni" görünür. Kapanmış talepte hepsi görülmüş.
      ownerSeenAt: status === 'open' ? hoursAgo(Math.min(12, listedHours / 2)) : hoursAgo(0),
      viewCount: views,
      deadline: extra.deadline ? daysFromNow(extra.deadline) : undefined,
      discoveryTime: extra.discoveryTime || '',
      isUrgent: Boolean(extra.urgent),
      questions: (extra.questions || []).map(([company, question, answer, share]) => ({
        asker: people[company]._id,
        askerName: companies[company].companyName,
        question,
        answer: answer || undefined,
        createdAt: hoursAgo(listedHours * share),
        answeredAt: answer ? hoursAgo(listedHours * share * 0.5) : undefined
      })),
      createdAt: hoursAgo(listedHours),
      updatedAt: hoursAgo(listedHours)
    });
  }

  const thisMonth = monthKey();
  const monthly = await Bid.aggregate([
    { $match: { company: { $in: Object.keys(companies).map(key => people[key]._id) } } },
    { $project: { company: 1, month: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+03:00' } } } },
    { $match: { month: thisMonth } },
    { $group: { _id: '$company', count: { $sum: 1 } } }
  ]);
  for (const { _id, count } of monthly) {
    await User.collection.updateOne({ _id }, { $set: { bidUsage: { month: thisMonth, count } } });
  }

  // Puanlar yalnızca gerçekten yazılmış yorumlardan hesaplanır, sayfadaki sayılar tutar.
  for (const [company, values] of ratings) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(company) },
      { $set: { rating: Math.round(average * 10) / 10, ratingCount: values.length } }
    );
  }

  for (const [person, text, age, read, title] of demoNotifications) {
    await insertRaw(Notification, {
      user: people[person]._id,
      text,
      url: `/requests/${requestIds.get(title)}`,
      read,
      createdAt: hoursAgo(age),
      updatedAt: hoursAgo(age)
    });
  }

  for (const [title, first, second, messages] of conversations) {
    for (const [from, content, age, read] of messages) {
      const to = from === first ? second : first;
      await insertRaw(Message, {
        request: requestIds.get(title),
        sender: people[from]._id,
        receiver: people[to]._id,
        content,
        read,
        createdAt: hoursAgo(age),
        updatedAt: hoursAgo(age)
      });
    }
  }
}

// Yönetici örnek verileri sildiyse sunucu yeniden başlayınca geri gelmesin.
const siteState = () => mongoose.connection.collection('site_state');
const markDemoRemoved = () => siteState().updateOne({ _id: 'demo' }, { $set: { removed: true } }, { upsert: true });

// Boş veritabanına örnek veri ekler; örnek verinin varlığını döndürür.
async function seedDemoData({ showcase = false } = {}) {
  if (process.env.DEMO_DATA === 'false') return false;
  const state = await siteState().findOne({ _id: 'demo' });
  if (state && state.removed) return false;
  const hasDemo = (await User.countDocuments({ email: demoAccounts[0].email })) > 0;
  const outdated = hasDemo && (!state || state.version !== DEMO_VERSION);
  if ((await Request.countDocuments()) === 0 || outdated) {
    await createDemoData({ showcase });
    await siteState().updateOne({ _id: 'demo' }, { $set: { version: DEMO_VERSION } }, { upsert: true });
    console.log('  Örnek veriler eklendi.');
  }
  return (await User.countDocuments({ email: demoAccounts[0].email })) > 0;
}

module.exports = { seedDemoData, removeDemoData, markDemoRemoved, demoAccounts };
