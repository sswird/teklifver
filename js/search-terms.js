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

  // Aranan kelimelerin metinde kelime başında geçtiği yerleri bulur (vurgu ve açıklama kesiti için).
  // wholeWord: eşleşme kelimenin sonuna kadar uzar ("boya" araması "boyanacak" kelimesinin tamamını kalın yazar).
  function hitPattern(text, flags, wholeWord) {
    const sources = text ? searchPatterns(text) : [];
    const tail = wholeWord ? '[\\p{L}\\p{N}]*' : '';
    return sources.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join('|')})${tail}`, flags) : null;
  }

  // Uzun açıklamadan aranan kelimenin ilk geçtiği yerin çevresini alır; kelime yoksa baştan kısaltır.
  function snippetAround(text, query, length) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    const pattern = hitPattern(query, 'iu');
    const found = pattern ? value.search(pattern) : -1;
    let start = 0;
    if (found > 30) {
      // Kelimenin önünde birkaç kelimelik bağlam kalır; kelime ortasından başlanmaz.
      const space = value.lastIndexOf(' ', found - 24);
      start = space < 0 ? 0 : space + 1;
    }
    const end = start + length;
    if (start === 0 && end >= value.length) return value;
    return `${start > 0 ? '...' : ''}${value.slice(start, end).trim()}${end < value.length ? '...' : ''}`;
  }

  // Metni aranan kelimelerin geçtiği yerlerden parçalara ayırır: [{ text, hit }].
  function highlightParts(text, query) {
    const value = String(text || '');
    const pattern = hitPattern(query, 'giu', true);
    if (!value || !pattern) return [{ text: value, hit: false }];
    const parts = [];
    let last = 0;
    for (const match of value.matchAll(pattern)) {
      if (!match[0]) continue;
      if (match.index > last) parts.push({ text: value.slice(last, match.index), hit: false });
      parts.push({ text: match[0], hit: true });
      last = match.index + match[0].length;
    }
    if (last < value.length) parts.push({ text: value.slice(last), hit: false });
    return parts;
  }

  // Benzerlikte işe yaramayan genel fiil ve dolgu kelimeleri ("boya yapılacak" yalnız "boya" gibi aranır)
  const SIMILAR_SKIP = new Set(['yapılacak', 'yapılması', 'yapmak', 'yapacak', 'edilecek', 'olacak', 'gerek', 'gerekiyor', 'acil', 'hemen', 'adet', 'tane', 'kadar', 'gibi']);

  // Benzer talep bulmak için kelime kökleri: durak kelimeler ve kısa kelimeler atılır, her kelimenin ilk dört harfi alınır
  // ("boyanacak" -> "boya", "dolapları" -> "dola"). source veritabanı araması için, pattern kelime başında eşleşir.
  function similarityPatterns(text) {
    const words = String(text || '').split(/[^\p{L}\p{N}+]+/u)
      .filter(word => word.length >= 3 && !STOP_WORDS.has(lower(word)) && !SIMILAR_SKIP.has(lower(word)));
    const roots = [...new Set(words.map(word => lower(word).slice(0, 4)))].slice(0, 8);
    return roots.map(root => {
      const source = escapeRegex(root).replace(/[iıİI]/g, '[iıİI]');
      return { source, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${source}`, 'iu') };
    });
  }

  // Başlıkları benzerliğe göre sıralar: eşleşen kökler (işi anlatan son kelime biraz daha ağır: "salon boyanacak"ta
  // boya, salondan önemlidir), aynı kategori, teklif sayısı, yenilik.
  function rankSimilar(items, text, category) {
    const patterns = similarityPatterns(text);
    if (!patterns.length) return [];
    const weight = index => (patterns.length > 1 && index === patterns.length - 1 ? 1.5 : 1);
    return items
      .map(item => ({
        item,
        score: patterns.reduce((sum, { pattern }, index) => sum + (pattern.test(item.title) ? weight(index) : 0), 0) + (category && item.category === category ? 0.5 : 0)
      }))
      .filter(entry => entry.score >= 1)
      .sort((a, b) => b.score - a.score || (b.item.bids || 0) - (a.item.bids || 0) || (b.item.created || 0) - (a.item.created || 0))
      .map(entry => entry.item);
  }

  // İki kelime arasındaki harf farkı; yan yana iki harfin yer değiştirmesi bir sayılır. Sınırı geçince erken biter.
  function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
    for (let i = 1; i <= a.length; i += 1) {
      rows[i] = [i];
      let best = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
        rows[i][j] = value;
        if (value < best) best = value;
      }
      if (best > limit) return limit + 1;
    }
    return rows[a.length][b.length];
  }

  // Yazım önerisi sözlüğü: metinlerdeki en az dört harfli kelimeler ve kaç kez geçtikleri
  function vocabularyOf(texts) {
    const words = new Map();
    texts.forEach(text => String(text || '').split(/[^\p{L}]+/u).forEach(word => {
      if (word.length >= 4) words.set(lower(word), (words.get(lower(word)) || 0) + 1);
    }));
    return words;
  }

  // "Bunu mu demek istediniz?": sözlükte olmayan kelime en yakın sözlük kelimesiyle değişir
  // (4-6 harfli kelimede 1, daha uzunda 2 harf fark; eşitlikte sık geçen kelime). Değişen yoksa boş döner.
  function didYouMean(text, vocabulary) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) return '';
    let changed = false;
    const fixed = words.map(word => {
      const plain = lower(word);
      if (plain.length < 4 || vocabulary.has(plain) || STOP_WORDS.has(plain) || /\d/.test(plain)) return plain;
      const limit = plain.length >= 7 ? 2 : 1;
      let best = '';
      let bestDistance = limit + 1;
      let bestCount = 0;
      vocabulary.forEach((count, candidate) => {
        const distance = editDistance(plain, candidate, limit);
        if (distance < bestDistance || (distance === bestDistance && count > bestCount)) {
          best = candidate;
          bestDistance = distance;
          bestCount = count;
        }
      });
      if (!best || bestDistance > limit) return plain;
      changed = true;
      return best;
    });
    return changed ? fixed.join(' ') : '';
  }

  return { searchPatterns, matchesText, snippetAround, highlightParts, similarityPatterns, rankSimilar, vocabularyOf, didYouMean };
}));
