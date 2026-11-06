// Arama kelimelerini düzenli ifadeye çevirir. Sunucu ve statik önizleme aynı kuralları kullanır.
// "boyacı" boyayı, "mutfağı" mutfağı, "nakliyeci" nakliyatı bulur; kelime sırası önemli değildir.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TeklifverSearch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // Aynı işi anlatan kelimeler
  const SYNONYMS = [
    ['nakliye', 'nakliyat', 'taşıma', 'taşınma'],
    ['boya', 'badana'],
    ['seramik', 'fayans'],
    ['parke', 'laminat'],
    ['mantolama', 'cephe'],
    ['kombi', 'petek'],
    ['çatı', 'kiremit'],
    ['marangoz', 'mobilya'],
    ['koltuk', 'kanepe'],
    ['logo', 'amblem'],
    ['çeviri', 'tercüme'],
    ['muhasebe', 'müşavir'],
    ['hukuk', 'avukat'],
    ['ders', 'öğretmen'],
    ['düğün', 'nikah'],
    ['e-ticaret', 'eticaret'],
    ['fotoğraf', 'çekim']
  ];

  // Aramada iş görmeyen kelimeler: "boya yaptırmak istiyorum" boya gibi aranır.
  const STOP_WORDS = new Set(['ve', 'ile', 'için', 'bir', 'bu', 'şu', 'lazım', 'gerekli', 'yaptırmak', 'yaptırılacak', 'istiyorum', 'arıyorum', 'olan', 'çok', 'en']);

  const SUFFIX = /(?:cılık|cilik|culuk|cülük|çılık|çilik|çuluk|çülük|cılar|ciler|cular|cüler|çılar|çiler|çular|çüler|ları|leri|lar|ler|nın|nin|nun|nün|cı|ci|cu|cü|çı|çi|çu|çü|sı|si|su|sü|yı|yi|yu|yü|ı|i|u|ü)$/;

  // Kelime sonundaki ünsüz ek alınca değişir: kitap/kitabı, mutfak/mutfağı, ağaç/ağacı
  const SOFT = { p: '[pb]', b: '[pb]', ç: '[çc]', c: '[çc]', t: '[td]', d: '[td]', k: '[kğg]', ğ: '[kğg]' };

  const lower = text => text.toLocaleLowerCase('tr-TR');
  const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function stem(word) {
    if (word.length < 5) return word;
    const cut = word.replace(SUFFIX, '');
    return cut.length >= 4 ? cut : word;
  }

  function toSource(word) {
    const last = word[word.length - 1];
    const body = word.length >= 4 && SOFT[last] ? escapeRegex(word.slice(0, -1)) + SOFT[last] : escapeRegex(word);
    // Büyük/küçük i Türkçede ayrı harflerdir; dördü de eşleşsin.
    return body.replace(/[iıİI]/g, '[iıİI]');
  }

  function wordSource(raw) {
    const word = lower(raw).slice(0, 60);
    const stemmed = stem(word);
    const forms = new Set([word, stemmed]);
    SYNONYMS.forEach(group => {
      if (group.includes(word) || group.includes(stemmed)) group.forEach(item => forms.add(item));
    });
    return `(?:${[...forms].map(toSource).join('|')})`;
  }

  // Her kelime için bir düzenli ifade kaynağı döndürür; hepsi eşleşmelidir.
  function searchPatterns(text) {
    const words = String(text || '').split(/[\s,;/]+/).filter(Boolean);
    const useful = words.filter(word => !STOP_WORDS.has(lower(word)));
    return (useful.length ? useful : words).slice(0, 8).map(wordSource);
  }

  // Verilen metinlerde tüm kelimeler geçiyor mu?
  function matchesText(text, values) {
    return searchPatterns(text).every(source => {
      const pattern = new RegExp(source, 'i');
      return values.some(value => pattern.test(value || ''));
    });
  }

  return { searchPatterns, matchesText };
}));
