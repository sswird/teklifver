// Tek kaynak: kategori listesi hem modelde hem arayüzde buradan okunur.
// subs: [menüde görünen ad, arama kelimesi]. image: kategori fotoğrafı. icon ve color: kategori ağacındaki ikon
const categories = [
  {
    name: 'İnşaat & Tadilat',
    image: '/img/ilan/usta.jpg',
    icon: 'hammer',
    color: '#d9480f',
    keywords: 'boya,badana,tadilat,mutfak,banyo,fayans,seramik,tesisat,kaçak,kombi,petek,elektrik,pano,parke,laminat,alçıpan,asma tavan,mantolama,çatı,kiremit,cam balkon,balkon,kapı,dolap,marangoz,su yalıtım,sıva,usta',
    subs: [['Boya Badana', 'boya'], ['Mutfak', 'mutfak'], ['Banyo', 'banyo'], ['Elektrik', 'elektrik'], ['Tesisat', 'tesisat'], ['Parke', 'parke'], ['Mantolama', 'mantolama']]
  },
  {
    name: 'Nakliye & Lojistik',
    image: '/img/ilan/tasima.jpg',
    icon: 'truck',
    color: '#1971c2',
    keywords: 'nakliye,nakliyat,taşıma,taşınma,evden eve,ambar,palet,koli,kamyon,kamyonet,konteyner,lojistik,kargo',
    subs: [['Evden Eve', 'evden eve'], ['Ofis Taşıma', 'ofis'], ['Parça Eşya', 'parça'], ['Depo', 'depo']]
  },
  {
    name: 'Temizlik',
    image: '/img/ilan/temizlik.jpg',
    icon: 'sparkle',
    color: '#0c8599',
    keywords: 'temizlik,temizliği,koltuk yıkama,halı yıkama,cam silme,merdiven',
    subs: [['Ofis', 'ofis'], ['Apartman', 'apartman'], ['Koltuk', 'koltuk'], ['Ev', 'ev ']]
  },
  {
    name: 'Web Tasarım',
    image: '/img/ilan/web.jpg',
    icon: 'browser',
    color: '#5f3dc4',
    keywords: 'web sitesi,web tasarım,wordpress,alan adı,hosting,internet sitesi',
    subs: [['Kurumsal Site', 'kurumsal'], ['Tanıtım Sitesi', 'tanıtım'], ['Site Yenileme', 'yenileme']]
  },
  {
    name: 'Yazılım Geliştirme',
    image: '/img/ilan/kod.jpg',
    icon: 'code',
    color: '#2b8a3e',
    keywords: 'yazılım,mobil uygulama,e-ticaret,otomasyon,program,python,uygulama',
    subs: [['E-ticaret', 'e-ticaret'], ['Mobil Uygulama', 'mobil'], ['Otomasyon', 'otomasyon']]
  },
  {
    name: 'Grafik Tasarım',
    image: '/img/ilan/grafik.jpg',
    icon: 'pen',
    color: '#c2255c',
    keywords: 'logo,kartvizit,katalog,broşür,afiş,arayüz,ambalaj,figma,grafik',
    subs: [['Logo', 'logo'], ['Katalog', 'katalog'], ['Arayüz', 'arayüz']]
  },
  {
    name: 'Dijital Pazarlama',
    image: '/img/ilan/analiz.jpg',
    icon: 'megaphone',
    color: '#e8590c',
    keywords: 'instagram,sosyal medya,google ads,reklam,seo,facebook,pazarlama',
    subs: [['Sosyal Medya', 'instagram'], ['Google Ads', 'google'], ['SEO', 'seo']]
  },
  {
    name: 'Video & Animasyon',
    image: '/img/ilan/kamera.jpg',
    icon: 'video',
    color: '#c92a2a',
    keywords: 'video,drone,tanıtım filmi,klip,animasyon,fotoğraf çekimi,düğün çekimi,düğün fotoğraf',
    subs: [['Tanıtım Filmi', 'tanıtım'], ['Düğün Çekimi', 'düğün'], ['Ürün Videosu', 'ürün']]
  },
  {
    name: 'Etkinlik & Organizasyon',
    image: '/img/ilan/balon.jpg',
    icon: 'balloon',
    color: '#9c36b5',
    keywords: 'organizasyon,düğün,kına,nişan,doğum günü,piknik,etkinlik,ses sistemi',
    subs: [['Düğün & Kına', 'kına'], ['Kurumsal Etkinlik', 'şirket'], ['Doğum Günü', 'doğum']]
  },
  {
    name: 'Çeviri & Metin',
    image: '/img/ilan/kitap.jpg',
    icon: 'globe',
    color: '#1864ab',
    keywords: 'çeviri,tercüme,yeminli,metin yazar,noter',
    subs: [['Yeminli Çeviri', 'yeminli'], ['Teknik Çeviri', 'teknik'], ['Metin Yazarlığı', 'metin']]
  },
  {
    name: 'Eğitim',
    image: '/img/ilan/egitim.jpg',
    icon: 'cap',
    color: '#087f5b',
    keywords: 'özel ders,ders,öğretmen,eğitim,kurs,lgs,yks,tyt',
    subs: [['Özel Ders', 'özel ders'], ['Yabancı Dil', 'ingilizce'], ['Kurumsal Eğitim', 'ekib']]
  },
  {
    name: 'Danışmanlık',
    image: '/img/ilan/toplanti.jpg',
    icon: 'bulb',
    color: '#b08800',
    keywords: 'muhasebe,mali müşavir,avukat,hukuk,danışman,şirket kuruluşu,gümrük',
    subs: [['Mali Müşavirlik', 'muhasebe'], ['Hukuk', 'hukuk'], ['İç Mimari', 'showroom']]
  },
  {
    name: 'Diğer',
    image: '/img/ilan/bahce.jpg',
    icon: 'layout-grid',
    color: '#5c6670',
    keywords: 'bahçe,peyzaj,kamera,alarm,tedarik',
    subs: [['Bahçe & Peyzaj', 'bahçe'], ['Güvenlik Sistemi', 'kamera'], ['Tedarik', 'tedarik']]
  }
];

module.exports = categories;
module.exports.names = categories.map(c => c.name);

// Talep başlığından kategori tahmini: en uzun eşleşen kelime kazanır. Tarayıcı da aynı kuralı izler.
module.exports.guess = text => {
  const title = String(text || '').toLocaleLowerCase('tr-TR');
  let best = '';
  let bestLength = 0;
  for (const category of categories) {
    for (const word of category.keywords.split(',')) {
      if (word.length > bestLength && title.includes(word)) {
        best = category.name;
        bestLength = word.length;
      }
    }
  }
  return best;
};
