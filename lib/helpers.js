const categories = require('../config/categories');
const cities = require('../config/cities');

// Sunucu dünyanın neresinde çalışırsa çalışsın tarihler Türkiye saatiyle gösterilir.
const TIME_ZONE = 'Europe/Istanbul';

const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
const monthFormat = new Intl.DateTimeFormat('tr-TR', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

// Puanlar virgülle yazılır: 4,7
const ratingFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ratingLabel = rating => ratingFormat.format(rating || 0);

// Türkiye'de fiyatlar sayıdan sonra TL ile yazılır: 18.000 TL
const money = amount => `${numberFormat.format(amount || 0)} TL`;
const formatDate = date => dateFormat.format(new Date(date));
const memberSince = date => monthFormat.format(new Date(date));
const formatDateTime = date => dateTimeFormat.format(new Date(date));

// <input type="date"> için YYYY-AA-GG
const inputDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const dateInput = date => inputDateFormat.format(date ? new Date(date) : new Date());

// Seçilen günün sonuna kadar geçerlidir (Türkiye saati). Geçersiz tarihte null döner.
function parseDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T23:59:59+03:00`);
  return !Number.isNaN(date.getTime()) && dateInput(date) === value ? date : null;
}

// Liste satırlarında bütçe tek satıra sığsın diye kısa yazılır.
function budgetLabel(budget) {
  const min = budget && budget.min > 0 ? budget.min : 0;
  const max = budget && budget.max > 0 ? budget.max : 0;
  if (min && max) return min === max ? money(max) : `${numberFormat.format(min)} - ${money(max)}`;
  if (max) return `En fazla ${money(max)}`;
  if (min) return `En az ${money(min)}`;
  return 'Belirtilmemiş';
}

// Dar vitrin hücresi için kısa tutar: 90.000 - 160.000 TL -> "90-160 bin TL".
// Bine bölünmeyen ya da milyonu aşan tutarlar tam yazılır.
function shortBudget(budget) {
  const min = budget && budget.min > 0 ? budget.min : 0;
  const max = budget && budget.max > 0 ? budget.max : 0;
  const fits = value => value >= 1000 && value < 1000000 && value % 1000 === 0;
  const k = value => numberFormat.format(value / 1000);
  if (min && max && min !== max && fits(min) && fits(max)) return `${k(min)}-${k(max)} bin TL`;
  if (max && !min && fits(max)) return `En çok ${k(max)} bin TL`; // "En fazla" dar hücreye sığmıyor
  if (min && !max && fits(min)) return `En az ${k(min)} bin TL`;
  return budgetLabel(budget);
}

function placeLabel(request) {
  return [request.city, request.location].filter(Boolean).join(' / ') || 'Belirtilmemiş';
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase('tr-TR'))
    .join('');
}

// Herkese açık sayfalarda soyadı gizlenir: "Elif Yılmaz" -> "Elif Y."
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'Üye';
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toLocaleUpperCase('tr-TR')}.`;
}

const truncate = (text, length) =>
  text && text.length > length ? `${text.slice(0, length).trimEnd()}...` : text || '';

const DAY_MS = 24 * 60 * 60 * 1000;

// Listelerde "5 saat önce" gibi; bir aydan eskiler tarihle yazılır.
function timeAgo(date) {
  const elapsed = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dakika önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'dün';
  if (days < 30) return `${days} gün önce`;
  return formatDate(date);
}

// Telefonu arama ve WhatsApp bağlantılarına çevirir. Türkiye dışı veya eksik numarada yalnızca arama döner.
function phoneLinks(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  let national = digits;
  if (national.startsWith('90') && national.length === 12) national = national.slice(2);
  if (national.startsWith('0')) national = national.slice(1);
  if (national.length !== 10) return { display: String(phone || ''), tel: `tel:${digits}`, whatsapp: '' };
  return {
    display: `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8)}`,
    tel: `tel:+90${national}`,
    whatsapp: national.startsWith('5') ? `https://wa.me/90${national}` : ''
  };
}

// Son tarihe kalan gün (bugün için 1)
const daysLeft = date => Math.max(Math.ceil((new Date(date).getTime() - Date.now()) / DAY_MS), 1);

// Son tarihe kalan süre: "4 gün", "1 gün 6 saat", "5 saat", "20 dakika"
function timeLeft(date) {
  const minutes = Math.max(Math.floor((new Date(date).getTime() - Date.now()) / 60000), 0);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days >= 2) return `${days} gün`;
  if (days === 1) return hours ? `1 gün ${hours} saat` : '1 gün';
  if (hours >= 1) return `${hours} saat`;
  return `${Math.max(minutes, 1)} dakika`;
}

// Talep sahibinin acil dediği ya da son tarihi 7 gün içinde olan açık talepler
function isUrgent(request) {
  if (request.status !== 'open') return false;
  if (request.isUrgent) return !request.deadline || new Date(request.deadline).getTime() > Date.now();
  if (!request.deadline) return false;
  const left = new Date(request.deadline).getTime() - Date.now();
  return left > 0 && left <= 7 * DAY_MS;
}

// Talep formundaki keşif zamanı seçenekleri; formdan yalnızca bunlar kabul edilir.
const discoveryTimes = ['Hafta içi gündüz (09:00 - 17:00)', 'Hafta içi akşam (18:00 - 21:00)', 'Hafta sonu herhangi bir saat'];
const isExpired = request =>
  request.status === 'open' && Boolean(request.deadline) && new Date(request.deadline).getTime() < Date.now();
const isFresh = request => Date.now() - new Date(request.createdAt).getTime() < DAY_MS / 4;

const requestStatus = {
  open: { label: 'Yayında', tone: 'green' },
  in_progress: { label: 'İşlemde', tone: 'amber' },
  completed: { label: 'Tamamlandı', tone: 'blue' },
  cancelled: { label: 'Kapatıldı', tone: 'gray' },
  removed: { label: 'Kaldırıldı', tone: 'gray' }
};

const bidStatus = {
  pending: { label: 'Beklemede', tone: 'amber' },
  accepted: { label: 'Kabul edildi', tone: 'green' },
  rejected: { label: 'Reddedildi', tone: 'gray' },
  cancelled: { label: 'Anlaşma iptal', tone: 'gray' }
};

// Listelerde küçük sürüm kullanılır; sayfa çok daha hızlı açılır.
function thumb(image) {
  if (!image) return '';
  if (image.startsWith('/uploads/')) return image.replace(/\.webp$/, '_t.webp');
  return image.replace(/^\/img\/ilan\/([^/]+)\.[^.]+$/, '/img/ilan/t/$1.webp');
}

// <script type="application/ld+json"> içine güvenle yazar.
const jsonLd = data => JSON.stringify(data).replace(/</g, '\\u003c');

const requestTips = require('../config/request-tips');
const firmBadgeInfo = require('../config/badges');
const categoryContent = require('../config/category-content');
const { categoryUrl, cityUrl, categoryCityUrl } = require('./slug');

module.exports = {
  requestTips,
  categoryContent,
  categoryUrl,
  cityUrl,
  categoryCityUrl,
  allCategories: categories,
  firmBadgeInfo,
  allCities: cities,
  money,
  ratingLabel,
  formatDate,
  timeAgo,
  daysLeft,
  timeLeft,
  discoveryTimes,
  phoneLinks,
  formatDateTime,
  dateInput,
  parseDateInput,
  shortName,
  thumb,
  jsonLd,
  memberSince,
  budgetLabel,
  shortBudget,
  placeLabel,
  initials,
  truncate,
  isUrgent,
  isExpired,
  isFresh,
  requestStatus,
  bidStatus
};
