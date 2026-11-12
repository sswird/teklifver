// Statik önizlemede sunucunun yaptığı işleri tarayıcıda yapar:
// talep ve firma filtreleri, arama önerileri, kapalı formlar.
(function () {
  const BASE = document.documentElement.dataset.base || '';
  const route = location.pathname.slice(BASE.length);
  const PAGE_SIZE = 20;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const fold = text => String(text || '').replace(/[İI]/g, 'i').replace(/ı/g, 'i').toLowerCase();
  const positive = value => (Number(value) > 0 ? Number(value) : 0);

  let dataPromise;
  const loadData = () => {
    if (!dataPromise) {
      dataPromise = nativeFetch(`${BASE}/data/site.json`).then(response => {
        if (!response.ok) throw new Error('Veri okunamadı');
        return response.json();
      });
    }
    return dataPromise;
  };

  const element = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  function setHidden(form, name, value) {
    let input = $(`input[type="hidden"][name="${name}"]`, form);
    if (!value) {
      if (input) input.remove();
      return;
    }
    if (!input) {
      input = element('input', { type: 'hidden', name });
      form.prepend(input);
    }
    input.value = value;
  }

  function setCount(prefix, total, suffix) {
    const count = $('.result-count');
    count.replaceChildren(prefix, element('strong', { textContent: total }), suffix);
  }

  /* Talepler */
  const REQUEST_SORTS = {
    newest: (a, b) => b.created - a.created,
    oldest: (a, b) => a.created - b.created,
    budget_high: (a, b) => b.max - a.max || b.created - a.created,
    budget_low: (a, b) => a.min - b.min || b.created - a.created,
    deadline: (a, b) => a.deadline - b.deadline || b.created - a.created,
    bids: (a, b) => b.bids - a.bids || b.created - a.created,
    views: (a, b) => b.views - a.views || b.created - a.created
  };

  function readRequestFilters(data) {
    const query = new URLSearchParams(location.search);
    const category = query.get('category');
    const sort = query.get('sort');
    const period = query.get('period');
    return {
      search: (query.get('search') || '').trim(),
      category: data.categories.some(item => item.name === category) ? category : 'all',
      city: query.get('city') || '',
      district: (query.get('district') || '').trim(),
      budgetMin: positive(query.get('budgetMin')),
      budgetMax: positive(query.get('budgetMax')),
      period: ['1', '7', '30'].includes(period) ? period : '',
      photos: query.get('photos') === 'on',
      noBids: query.get('noBids') === 'on',
      urgent: query.get('urgent') === 'on',
      sort: Object.hasOwn(REQUEST_SORTS, sort) ? sort : 'newest',
      view: query.get('view') === 'gallery' ? 'gallery' : 'list',
      page: Math.max(parseInt(query.get('page'), 10) || 1, 1)
    };
  }

  function matchesRequest(item, filters, builtAt) {
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.city && item.city !== filters.city) return false;
    if (filters.district && fold(item.location) !== fold(filters.district)) return false;
    if (filters.budgetMin && item.max < filters.budgetMin && item.min < filters.budgetMin) return false;
    if (filters.budgetMax && item.min > filters.budgetMax) return false;
    if (filters.period && item.created < builtAt - Number(filters.period) * DAY_MS) return false;
    if (filters.photos && !item.photos) return false;
    if (filters.noBids && item.bids > 0) return false;
    if (filters.urgent && !item.urgent) return false;
    if (filters.search) {
      const byNumber = /^\d{6,}$/.test(filters.search) && String(item.no) === filters.search;
      if (!byNumber && !window.TeklifverSearch.matchesText(filters.search, [item.title, item.description, item.category, item.location, item.city])) return false;
    }
    return true;
  }

  function requestUrl(filters, overrides) {
    const state = { ...filters, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.city) params.set('city', state.city);
    if (state.district) params.set('district', state.district);
    if (state.budgetMin) params.set('budgetMin', state.budgetMin);
    if (state.budgetMax) params.set('budgetMax', state.budgetMax);
    if (state.period) params.set('period', state.period);
    if (state.photos) params.set('photos', 'on');
    if (state.noBids) params.set('noBids', 'on');
    if (state.urgent) params.set('urgent', 'on');
    if (state.sort !== 'newest') params.set('sort', state.sort);
    if (state.view !== 'list') params.set('view', state.view);
    if (state.page > 1) params.set('page', state.page);
    const text = params.toString();
    return `${BASE}/requests/${text ? `?${text}` : ''}`;
  }

  function pagination(filters, page, totalPages) {
    if (totalPages < 2) return null;
    const link = (label, target) => element('a', { href: requestUrl(filters, { page: target }), textContent: label });
    const nav = element('nav', { className: 'pagination' });
    nav.setAttribute('aria-label', 'Sayfalar');
    if (page > 1) nav.append(link('‹ Önceki', page - 1));
    for (let n = Math.max(1, page - 3); n <= Math.min(totalPages, page + 3); n += 1) {
      nav.append(n === page ? element('span', { className: 'is-current', textContent: n }) : link(String(n), n));
    }
    if (page < totalPages) nav.append(link('Sonraki ›', page + 1));
    return nav;
  }

  const hasActiveFilters = filters => Boolean(filters.search || filters.city || filters.district || filters.budgetMin || filters.budgetMax ||
    filters.period || filters.photos || filters.noBids || filters.urgent);

  // Sunucudaki categories.guess ile aynı kural: en uzun eşleşen anahtar kelime kazanır.
  function guessCategory(data, text) {
    const title = String(text || '').toLocaleLowerCase('tr-TR');
    let best = '';
    let bestLength = 0;
    data.categories.forEach(category => {
      String(category.keywords || '').split(',').forEach(word => {
        if (word && word.length > bestLength && title.includes(word)) {
          best = category.name;
          bestLength = word.length;
        }
      });
    });
    return best;
  }

  function syncCategoryMenu(data, filters) {
    const filtered = hasActiveFilters(filters);
    const menuCounts = {};
    if (filtered) {
      data.requests
        .filter(item => matchesRequest(item, { ...filters, category: 'all' }, data.builtAt))
        .forEach(item => { menuCounts[item.category] = (menuCounts[item.category] || 0) + 1; });
    }
    const note = $('[data-menu-note]');
    if (note) note.hidden = !filtered;
    $$('.category-menu .side-list > li > a').forEach(link => {
      const category = new URL(link.href).searchParams.get('category') || 'all';
      if (filtered) {
        const count = category === 'all' ? Object.values(menuCounts).reduce((a, b) => a + b, 0) : menuCounts[category] || 0;
        const counter = $('.count', link);
        if (counter) counter.textContent = count;
        link.classList.toggle('is-empty', category !== 'all' && !count);
        link.href = requestUrl(filters, { category });
      }
    });
    $$('.side-list a').forEach(link => {
      const category = new URL(link.href).searchParams.get('category') || 'all';
      link.classList.toggle('is-active', category === filters.category);
    });
    if (filters.category === 'all') return;

    const active = $('.side-list a.side-main.is-active');
    const category = data.categories.find(item => item.name === filters.category);
    if (!active || !category || active.nextElementSibling) return;
    const subs = element('div', { className: 'side-subs' });
    category.subs.forEach(([label, term]) => {
      const params = new URLSearchParams({ category: category.name, search: term.trim() });
      subs.append(element('a', { href: `${BASE}/requests/?${params}`, textContent: label }));
    });
    active.after(subs);
  }

  function syncRequestForms(filters) {
    const form = $('aside form[action]');
    if (form) {
      setHidden(form, 'category', filters.category === 'all' ? '' : filters.category);
      setHidden(form, 'sort', filters.sort === 'newest' ? '' : filters.sort);
      setHidden(form, 'view', filters.view === 'list' ? '' : filters.view);
      form.elements.search.value = filters.search;
      form.elements.city.value = filters.city;
      const districtSelect = form.elements.district;
      if (districtSelect) {
        let map = {};
        try { map = JSON.parse(districtSelect.dataset.districts || '{}'); } catch { /* bozuk veri yok sayılır */ }
        const names = map[filters.city] || [];
        districtSelect.replaceChildren(new Option('Tümü', ''), ...names.map(name => new Option(name, name)));
        districtSelect.value = names.find(name => fold(name) === fold(filters.district)) || '';
        const group = districtSelect.closest('[data-district-group]');
        if (group) group.hidden = names.length === 0;
      }
      form.elements.budgetMin.value = filters.budgetMin || '';
      form.elements.budgetMax.value = filters.budgetMax || '';
      form.elements.period.value = filters.period;
      form.elements.photos.checked = filters.photos;
      form.elements.noBids.checked = filters.noBids;
      if (form.elements.urgent) form.elements.urgent.checked = filters.urgent;

      const hasFilters = filters.search || filters.category !== 'all' || filters.city || filters.budgetMin ||
        filters.budgetMax || filters.period || filters.photos || filters.noBids || filters.urgent || filters.district;
      if (hasFilters) {
        const clear = element('a', { className: 'small', href: `${BASE}/requests/`, textContent: 'Filtreleri temizle' });
        const holder = element('div', {}, [clear]);
        holder.style.cssText = 'text-align:center;margin-top:6px';
        $('button[type="submit"]', form).after(holder);
      }
    }

    const sortForm = $('.result-bar form');
    if (sortForm) {
      sortForm.elements.sort.value = filters.sort;
      setHidden(sortForm, 'search', filters.search);
      setHidden(sortForm, 'category', filters.category === 'all' ? '' : filters.category);
      setHidden(sortForm, 'city', filters.city);
      setHidden(sortForm, 'district', filters.district);
      setHidden(sortForm, 'budgetMin', filters.budgetMin || '');
      setHidden(sortForm, 'budgetMax', filters.budgetMax || '');
      setHidden(sortForm, 'period', filters.period);
      setHidden(sortForm, 'photos', filters.photos ? 'on' : '');
      setHidden(sortForm, 'noBids', filters.noBids ? 'on' : '');
      setHidden(sortForm, 'urgent', filters.urgent ? 'on' : '');
      setHidden(sortForm, 'view', filters.view === 'list' ? '' : filters.view);
    }

    const search = $('#siteSearch');
    if (search) search.value = filters.search;
    const headerCity = $('.searchbar select');
    if (headerCity) headerCity.value = filters.city;
  }

  function renderChips(filters) {
    const box = $('#filterChips');
    if (!box) return;
    const chips = [];
    const money = value => `${Number(value).toLocaleString('tr-TR')} TL`;
    if (filters.search) chips.push([`"${filters.search}"`, { search: '' }]);
    if (filters.category !== 'all') chips.push([filters.category, { category: 'all' }]);
    if (filters.city) chips.push([filters.city, { city: '', district: '' }]);
    if (filters.district) chips.push([filters.district, { district: '' }]);
    if (filters.budgetMin) chips.push([`En az ${money(filters.budgetMin)}`, { budgetMin: 0 }]);
    if (filters.budgetMax) chips.push([`En çok ${money(filters.budgetMax)}`, { budgetMax: 0 }]);
    if (filters.period) chips.push([filters.period === '1' ? 'Son 24 saat' : `Son ${filters.period} gün`, { period: '' }]);
    if (filters.photos) chips.push(['Fotoğraflı', { photos: false }]);
    if (filters.noBids) chips.push(['Teklif almamış', { noBids: false }]);
    if (filters.urgent) chips.push(['Acil', { urgent: false }]);
    box.hidden = chips.length === 0;
    box.replaceChildren(...chips.map(([label, overrides]) => element('a', {
      className: 'filter-chip',
      href: requestUrl(filters, overrides),
      textContent: `${label} ×`
    })));
    if (chips.length > 1) box.append(element('a', { className: 'filter-clear', href: `${BASE}/requests/`, textContent: 'Tümünü temizle' }));
  }

  function renderFilterButton(filters) {
    const button = $('[data-open-filters]');
    if (!button || !button.lastChild) return;
    const active = [filters.search, filters.city, filters.district, filters.budgetMin, filters.budgetMax, filters.period, filters.photos, filters.noBids, filters.urgent].filter(Boolean).length;
    button.lastChild.textContent = ' Filtrele' + (active ? ` (${active})` : '');
  }

  function renderSortHeads(filters) {
    const next = { budget: filters.sort === 'budget_high' ? 'budget_low' : 'budget_high', bids: 'bids', date: filters.sort === 'newest' ? 'oldest' : 'newest' };
    const dir = {
      budget: filters.sort === 'budget_high' ? 'descending' : filters.sort === 'budget_low' ? 'ascending' : '',
      bids: filters.sort === 'bids' ? 'descending' : '',
      date: filters.sort === 'newest' ? 'descending' : filters.sort === 'oldest' ? 'ascending' : ''
    };
    $$('[data-sort-head]').forEach(link => {
      const key = link.dataset.sortHead;
      link.href = requestUrl(filters, { sort: next[key] });
      link.classList.toggle('is-descending', dir[key] === 'descending');
      link.classList.toggle('is-ascending', dir[key] === 'ascending');
      const th = link.closest('th');
      if (dir[key]) th.setAttribute('aria-sort', dir[key]);
      else th.removeAttribute('aria-sort');
    });
  }

  function renderQuickFilters(filters) {
    $$('[data-quick]').forEach(link => {
      const kind = link.dataset.quick;
      const on = kind === 'period' ? filters.period === '1' : kind === 'deadline' ? filters.sort === 'deadline' : Boolean(filters[kind]);
      const overrides = kind === 'period' ? { period: on ? '' : '1' } : kind === 'deadline' ? { sort: on ? 'newest' : 'deadline' } : { [kind]: !on };
      link.classList.toggle('is-active', on);
      link.href = requestUrl(filters, overrides);
    });
  }

  function renderRequests(data) {
    const filters = readRequestFilters(data);
    const matched = data.requests
      .filter(item => matchesRequest(item, filters, data.builtAt))
      .sort(REQUEST_SORTS[filters.sort]);
    const totalPages = Math.max(Math.ceil(matched.length / PAGE_SIZE), 1);
    const page = Math.min(filters.page, totalPages);
    const visible = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const section = $('.result-bar').parentElement;
    const table = $('.listing-table', section);
    $$('.empty, .pagination, .showcase-grid', section).forEach(node => node.remove());

    setCount(filters.search ? `"${filters.search}" aramanızda ` : '', matched.length, ' talep bulundu');

    const isGallery = filters.view === 'gallery';
    table.hidden = isGallery || visible.length === 0;
    $$('.empty-more', section).forEach(node => node.remove());
    if (!visible.length) {
      const tips = element('ul', { className: 'empty-tips' });
      if (hasActiveFilters(filters) || filters.category !== 'all') tips.append(element('li', { textContent: 'Yukarıdaki filtrelerden birini kaldırın.' }));
      const suggestion = filters.search ? guessCategory(data, filters.search) : '';
      if (suggestion && suggestion !== filters.category) {
        const total = data.requests.filter(item => item.category === suggestion).length;
        tips.append(element('li', {}, [
          element('a', { href: requestUrl(filters, { category: suggestion, search: '' }), textContent: suggestion }),
          ` kategorisindeki ${total} açık talebe bakın.`
        ]));
      }
      const children = [
        element('h2', { textContent: filters.search ? `"${filters.search}" için açık talep bulunamadı` : 'Bu filtrelerle açık talep bulunamadı' }),
        tips
      ];
      if (filters.search) {
        const params = new URLSearchParams({ title: filters.search, ...(filters.city ? { city: filters.city } : {}) });
        children.push(
          element('p', { className: 'empty-cta', textContent: 'Bu işi siz mi yaptıracaksınız? Talebinizi yazın, firmalar size teklif göndersin.' }),
          element('a', { className: 'btn btn-primary', href: `${BASE}/requests/new/?${params}`, textContent: 'Bu İş İçin Talep Ver' }),
          ' '
        );
      }
      children.push(element('a', { className: 'btn', href: `${BASE}/requests/`, textContent: 'Tüm Talepler' }));
      table.before(element('div', { className: 'empty empty-search' }, children));
      // Altında son eklenen talepler: aynı tablo, en yeni beş satırla
      const latest = [...data.requests].sort((a, b) => b.created - a.created).slice(0, 5);
      if (latest.length && !isGallery) {
        table.before(element('h2', { className: 'empty-more', textContent: 'Son eklenen talepler' }));
        $('tbody', table).innerHTML = latest.map(item => item.row).join('');
        table.hidden = false;
      }
    } else if (isGallery) {
      section.append(element('div', { className: 'showcase-grid', innerHTML: visible.map(item => item.card).join('') }));
    } else {
      const ads = data.adRows;
      const start = Math.floor(Math.random() * Math.max(ads.length, 1));
      $('tbody', table).innerHTML = visible.map((item, index) => {
        const ad = ads.length && index > 0 && index % 8 === 0 ? ads[(start + index / 8) % ads.length] : '';
        return ad + item.row;
      }).join('');
    }

    const nav = pagination(filters, page, totalPages);
    if (nav) section.append(nav);

    $$('.view-switch a').forEach(link => {
      const view = link.textContent.includes('Galeri') ? 'gallery' : 'list';
      link.href = requestUrl(filters, { view, page });
      link.classList.toggle('is-active', view === filters.view);
    });

    renderChips(filters);
    renderQuickFilters(filters);
    renderFilterButton(filters);
    renderSortHeads(filters);

    if (filters.category !== 'all') {
      document.title = `${filters.category} - TeklifVer`;
      const crumbs = $('.crumbs');
      crumbs.append(' › ', element('span', { textContent: filters.category }));
    }
    syncCategoryMenu(data, filters);
    syncRequestForms(filters);
  }

  /* Firma rehberi */
  const COMPANY_SORTS = {
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews || b.rating - a.rating,
    newest: (a, b) => b.created - a.created
  };

  function renderCompanies(data) {
    const query = new URLSearchParams(location.search);
    const search = (query.get('search') || '').trim();
    const category = query.get('category') || '';
    const city = query.get('city') || '';
    const minRating = ['3', '4', '4.5'].includes(query.get('minRating')) ? query.get('minRating') : '';
    const verified = query.get('verified') === 'on';
    const sort = Object.hasOwn(COMPANY_SORTS, query.get('sort')) ? query.get('sort') : 'rating';

    const matched = data.companies.filter(item =>
      (!search || window.TeklifverSearch.matchesText(search, [item.name, item.specialties.join(' '), item.categories.join(' ')])) &&
      (!category || item.categories.includes(category)) &&
      (!city || item.city === city || item.areas.includes(city)) &&
      (!minRating || item.rating >= Number(minRating)) &&
      (!verified || item.verified)
    ).sort(COMPANY_SORTS[sort]);

    const section = $('.result-bar').parentElement;
    const table = $('.listing-table', section);
    $$('.empty', section).forEach(node => node.remove());
    setCount('', matched.length, ' firma bulundu');

    table.hidden = matched.length === 0;
    if (matched.length) {
      $('tbody', table).innerHTML = matched.map(item => item.row).join('');
    } else {
      section.append(element('div', { className: 'empty' }, [
        element('h2', { textContent: 'Firma bulunamadı' }),
        element('a', { className: 'btn', href: `${BASE}/companies/`, textContent: 'Tüm Firmalar' })
      ]));
    }

    const form = $('aside form[action]');
    form.elements.search.value = search;
    form.elements.category.value = category;
    form.elements.city.value = city;
    form.elements.minRating.value = minRating;
    form.elements.verified.checked = verified;
    form.elements.sort.value = sort;

    const sortForm = $('.result-bar form');
    sortForm.elements.sort.value = sort;
    setHidden(sortForm, 'search', search);
    setHidden(sortForm, 'category', category);
    setHidden(sortForm, 'city', city);
    setHidden(sortForm, 'minRating', minRating);
    setHidden(sortForm, 'verified', verified ? 'on' : '');
  }

  /* Firma karşılaştırma: seçilen firmaların sunucuda üretilmiş sütunları birleştirilir */
  function markBest(root) {
    $$('tr[data-better]', root).forEach(row => {
      const cells = $$('td[data-value]', row);
      const numbers = cells.map(cell => (cell.dataset.value === '' ? null : Number(cell.dataset.value)));
      const valid = numbers.filter(value => value !== null);
      const top = valid.length >= 2 && new Set(valid).size > 1
        ? (row.dataset.better === 'low' ? Math.min(...valid) : Math.max(...valid))
        : null;
      cells.forEach((cell, index) => cell.classList.toggle('is-best', top !== null && numbers[index] === top));
    });
  }

  function renderCompare(data) {
    const ids = (new URLSearchParams(location.search).get('ids') || '').split(',').filter(Boolean).slice(0, 3);
    const firms = [...new Set(ids)].map(id => data.companies.find(item => item.id === id)).filter(item => item && item.compare.length);
    const holder = $('[data-compare-page]');
    if (!holder || firms.length < 2 || !data.compareRows.length) return;
    const head = '<tr><th scope="col"><span class="visually-hidden">Özellik</span></th>' + firms.map(firm => firm.compare[0]).join('') + '</tr>';
    const body = data.compareRows.map((row, index) =>
      '<tr' + (row.better ? ' data-better="' + row.better + '"' : '') + '>' + row.head + firms.map(firm => firm.compare[index + 1] || '<td></td>').join('') + '</tr>'
    ).join('');
    holder.innerHTML = '<div class="compare-scroll"><table class="compare-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Her satırda en iyi değer sarıyla işaretlidir. Sayılar sitedeki teklif ve işlerden hesaplanır.</p>';
    markBest(holder);
  }

  /* Arama önerileri: main.js sunucuya sorar, burada yerel veriden yanıtlanır */
  window.fetch = (url, options) => {
    if (typeof url !== 'string' || !url.startsWith('/requests/suggest')) return nativeFetch(url, options);
    const term = new URLSearchParams(url.split('?')[1]).get('q') || '';
    return loadData().then(data => {
      const categories = data.categories
        .filter(item => window.TeklifverSearch.matchesText(term, [item.name]))
        .slice(0, 3)
        .map(item => ({
          label: item.name,
          hint: 'Kategori',
          url: `${BASE}/requests/?category=${encodeURIComponent(item.name)}`
        }));
      const requests = data.requests
        .filter(item => window.TeklifverSearch.matchesText(term, [item.title]))
        .sort((a, b) => b.views - a.views)
        .slice(0, 6)
        .map(item => ({ label: item.title, hint: `No: ${item.no}`, url: `${BASE}/requests/${item.id}/` }));
      return new Response(JSON.stringify({ items: [...categories, ...requests] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    });
  };

  /* Sunucu gerektiren formlar */
  const CLOSED_MESSAGE = 'Bu önizleme sürümünde üyelik, talep verme, teklif ve mesajlaşma kapalıdır.';

  function showClosedDialog() {
    let dialog = $('#previewDialog');
    if (!dialog) {
      const ok = element('button', { className: 'btn btn-primary btn-sm', type: 'button', textContent: 'Tamam' });
      ok.addEventListener('click', () => dialog.close());
      dialog = element('dialog', { className: 'dialog', id: 'previewDialog' }, [
        element('p', { textContent: CLOSED_MESSAGE }),
        element('div', { className: 'dialog-actions' }, [ok])
      ]);
      document.body.append(dialog);
    }
    dialog.showModal();
  }

  document.addEventListener('submit', event => {
    if (event.target.method.toLowerCase() !== 'post') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showClosedDialog();
  }, true);

  document.addEventListener('click', event => {
    if (!event.target.closest('.social-btn')) return;
    event.preventDefault();
    showClosedDialog();
  });

  function closeAccountForms() {
    if (!['/login/', '/register/', '/forgot/'].includes(route)) return;
    // Sunucu olmadan hesap açılamaz; ziyaretçiye açıkça söylenir.
    const form = $('main form');
    if (!form) return;
    $$('input, select, textarea, button', form).forEach(control => { control.disabled = true; });
    form.prepend(element('div', { className: 'preview-note', textContent: CLOSED_MESSAGE }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    closeAccountForms();

    const render = { '/requests/': renderRequests, '/companies/': renderCompanies, '/companies/karsilastir/': renderCompare }[route];
    if (!render) return;
    loadData()
      .then(render)
      .catch(err => console.error(err))
      .finally(() => document.documentElement.classList.remove('static-loading'));
  });

  if (location.search && (route === '/requests/' || route === '/companies/' || route === '/companies/karsilastir/')) {
    document.documentElement.classList.add('static-loading');
  }
})();
