// Sitenin kendi ikonları. Köşeler keskin, uçlar düzdür; hepsi 24 birimlik ızgarada elle çizildi.
// Kullanım: <%- icon('search') %> veya <%- icon('search', { size: 20, class: 'x' }) %>
const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  heart: '<path d="M12 20.5 3.6 12a5 5 0 0 1 7.1-7.1L12 6.2l1.3-1.3a5 5 0 0 1 7.1 7.1z"/>',
  star: '<path d="m12 3 2.8 6 6.7.8-5 4.5 1.4 6.7-5.900-3.400L6.100 21l1.400-6.700-5-4.500 6.700-.800z"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  'chevron-up': '<path d="m5 15 7-7 7 7"/>',
  x: '<path d="m5 5 14 14M19 5 5 19"/>',
  check: '<path d="m4 12.500 5.500 5.500L20 6.500"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.500 3.500-7 8-7s8 2.500 8 7"/>',
  flag: '<path d="M6 21V4h12l-3 4.500L18 13H6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.500L6 21z"/>',
  mail: '<path d="M3 5h18v14H3z"/><path d="m3 6 9 7 9-7"/>',
  'message-square': '<path d="M3 4h18v13H9l-5 4v-4H3z"/>',
  'message-circle': '<path d="M3 4h18v13H9l-5 4v-4H3z"/>',
  send: '<path d="M21 3 3 10.500l7 3 3 7.500zM10 13.500l4-4"/>',
  printer: '<path d="M7 9V3h10v6M7 17H3V9h18v8h-4M7 14h10v7H7z"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4.200 4.200 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4.200 4.200 0 0 0 6 6l1-1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  'layout-grid': '<path d="M4 4h6.500v6.500H4zM13.500 4H20v6.500h-6.500zM4 13.500h6.500V20H4zM13.500 13.500H20V20h-6.500z"/>',
  house: '<path d="m3 11 9-8 9 8M5 9.500V21h5v-6h4v6h5V9.500"/>',
  eye: '<path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><path d="m4 4 16 16"/>',
  'circle-plus': '<path d="M3 3h18v18H3zM12 7.500v9M7.500 12h9"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.500"/>',
  'building-2': '<path d="M4 21V4h10v17M14 9h6v12M2 21h20M8 8h2M8 12h2M8 16h2"/>',
  briefcase: '<path d="M3 7h18v13H3zM9 7V4h6v3M3 12.500h18"/>',
  'badge-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12.500 3 3 5.500-6.500"/>',
  'shield-alert': '<path d="m12 3 8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM12 8v5M12 16v.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  moon: '<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4 7 7 0 0 0 20 14.500z"/>',
  bell: '<path d="M18 16V10a6 6 0 0 0-12 0v6l-2 2h16zM10 21h4"/>'
};

function icon(name, { size = 18, class: className = '' } = {}) {
  const inner = ICONS[name];
  if (!inner) throw new Error(`Bilinmeyen ikon: ${name}`);
  const classes = ['icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;
}

module.exports = icon;
