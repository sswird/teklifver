// TeklifVer — arayüz davranışları
(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const BASE = document.documentElement.dataset.base || ''; // statik önizleme alt klasörde yayınlanır

  /* Siyah ve beyaz tema: seçim yalnızca düğmeye basılınca bu tarayıcıda saklanır */
  function initTheme() {
    const root = document.documentElement;
    const meta = $('meta[name="theme-color"]');
    const paintBar = () => {
      if (meta) meta.content = root.dataset.theme === 'dark' ? '#0b0b0b' : '#16181b';
    };

    paintBar();
    $$('[data-theme-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        const apply = () => {
          root.dataset.theme = next;
          paintBar();
        };
        try { localStorage.setItem('theme', next); } catch { /* depolama kapalı olabilir */ }

        // Destekleyen tarayıcıda iki görüntü arasında tek bir geçiş yapılır; yeniden çizim takılması olmaz.
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (document.startViewTransition && !calm) document.startViewTransition(apply);
        else apply();
      });
    });

  }

  /* Küçük hareketler: fotoğraflar yumuşakça belirir, sayfa geçişinde ince çubuk akar.
     Yalnızca cihazda "hareketi azalt" kapalıysa çalışır; betik çalışmazsa her şey normal görünür. */
  function initMotion() {
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

    // Henüz yüklenmemiş fotoğraflar hazır olunca belirir.
    $$('.showcase-photo img, .thumb img, .portfolio-grid img').forEach(image => {
      if (image.complete) return;
      image.classList.add('is-arriving');
      const show = () => image.classList.remove('is-arriving');
      image.addEventListener('load', show, { once: true });
      image.addEventListener('error', show, { once: true });
    });

    // Sayfa geçişi çubuğu
    const bar = document.createElement('div');
    bar.className = 'nav-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);
    const startBar = () => bar.classList.add('is-running');

    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (link.target === '_blank' || link.hasAttribute('download') || link.origin !== location.origin) return;
      if (link.pathname === location.pathname && link.search === location.search) return;
      startBar();
    });
    window.addEventListener('pagehide', () => bar.classList.remove('is-running'));
    window.addEventListener('pageshow', () => bar.classList.remove('is-running'));
  }

  /* Bildirimleri kapatma */
  function initAlerts() {
    $$('.alert-close').forEach(button => {
      button.addEventListener('click', () => button.closest('.alert').remove());
    });
  }

  /* Hesap menüsü */
  function initMenu() {
    const button = $('.menu-button');
    const panel = $('.menu-panel');
    if (!button) return;

    const set = open => {
      button.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
    };
    button.addEventListener('click', () => set(panel.hidden));
    document.addEventListener('click', event => {
      if (!event.target.closest('.menu')) set(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') set(false);
    });
  }

  /* Küçük ekranda filtre ve kategori kutuları kapalı başlar */
  function initCollapsedBoxes() {
    if (window.innerWidth > 760) return;
    $$('details[data-collapse-mobile]').forEach(box => { box.open = false; });
  }

  /* Şifre alanları */
  function initPasswordFields() {
    $$('.password-toggle').forEach(button => {
      const input = button.parentElement.querySelector('input');
      button.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(show));
        button.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
        input.focus();
      });
    });

    $$('[data-password-hint]').forEach(hint => {
      const input = document.getElementById(hint.dataset.passwordHint);
      const min = Number(input.getAttribute('minlength')) || 8;
      input.addEventListener('input', () => {
        const remaining = min - input.value.length;
        hint.classList.toggle('is-ok', remaining <= 0);
        if (input.value.length === 0) hint.textContent = `En az ${min} karakter`;
        else hint.textContent = remaining > 0 ? `${remaining} karakter daha` : 'Şifre uzunluğu uygun';
      });
    });
  }

  /* Kayıt: hesap türü */
  function initRolePicker() {
    const companyFields = $('#companyFields');
    if (!companyFields) return;
    const companyInput = $('input', companyFields);

    const apply = () => {
      const isCompany = $('input[name="role"]:checked').value === 'company';
      companyFields.classList.toggle('is-open', isCompany);
      companyInput.required = isCompany;
    };
    $$('input[name="role"]').forEach(radio => radio.addEventListener('change', apply));
    apply();
  }

  /* Görsel yükleme */
  function initDropzone() {
    const input = $('#images');
    if (!input) return;
    const zone = input.closest('.dropzone');
    const thumbs = $('#imagePreviews');
    const error = $('#imagesError');
    const maxImages = Number(input.dataset.max) || 5;
    const maxSize = 5 * 1024 * 1024;
    let selected = [];

    const showError = message => {
      error.textContent = message;
      error.hidden = !message;
    };

    const sync = () => {
      const transfer = new DataTransfer();
      selected.forEach(file => transfer.items.add(file));
      input.files = transfer.files;

      thumbs.replaceChildren(
        ...selected.map((file, index) => {
          const item = document.createElement('div');
          item.className = 'upload-thumb';

          const image = document.createElement('img');
          image.src = URL.createObjectURL(file);
          image.alt = file.name;
          image.onload = () => URL.revokeObjectURL(image.src);

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'thumb-remove';
          remove.setAttribute('aria-label', `${file.name} görselini kaldır`);
          remove.textContent = '×';
          remove.addEventListener('click', () => {
            selected.splice(index, 1);
            showError('');
            sync();
          });

          item.append(image, remove);
          return item;
        })
      );
    };

    const add = files => {
      showError('');
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          showError('Yalnızca görsel dosyası ekleyebilirsiniz.');
        } else if (file.size > maxSize) {
          showError(`"${file.name}" 5 MB'tan büyük.`);
        } else if (selected.length >= maxImages) {
          showError(`En fazla ${maxImages} görsel ekleyebilirsiniz.`);
          break;
        } else {
          selected.push(file);
        }
      }
      sync();
    };

    input.addEventListener('change', () => add(Array.from(input.files)));

    ['dragenter', 'dragover'].forEach(type =>
      zone.addEventListener(type, event => {
        event.preventDefault();
        zone.classList.add('is-over');
      })
    );
    ['dragleave', 'drop'].forEach(type =>
      zone.addEventListener(type, event => {
        event.preventDefault();
        zone.classList.remove('is-over');
      })
    );
    zone.addEventListener('drop', event => add(Array.from(event.dataTransfer.files)));
  }

  /* Favori: sayfa yenilenmeden eklenir, JavaScript yoksa form normal gönderilir */
  async function toggleFavorite(form) {
    const button = $('button', form);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!response.ok) throw new Error('İstek başarısız');
      const { favorite } = await response.json();

      const selector = `form[action="${form.getAttribute('action')}"] button`;
      $$(selector).forEach(other => {
        other.classList.toggle('is-active', favorite);
        other.title = favorite ? 'Favorilerden çıkar' : 'Favorilere ekle';
        const label = $('[data-fav-label]', other);
        if (label) label.textContent = favorite ? 'Favorilerden Çıkar' : 'Favorilerime Ekle';
      });

      if (favorite) {
        button.classList.remove('just-faved');
        void button.offsetWidth; // animasyon yeniden başlasın
        button.classList.add('just-faved');
      }

      const counter = $('#favCount');
      if (counter) counter.textContent = Math.max(0, Number(counter.textContent) + (favorite ? 1 : -1));
    } catch {
      form.submit();
    } finally {
      button.blur();
    }
  }

  /* Onay penceresi, gönderim durumu, favoriler */
  function initForms() {
    const dialog = $('#confirmDialog');
    let pending = null;

    document.addEventListener('submit', event => {
      const form = event.target;

      if (form.classList.contains('fav-form')) {
        event.preventDefault();
        toggleFavorite(form);
        return;
      }

      if (form.dataset.confirm && !form.dataset.confirmed && dialog) {
        event.preventDefault();
        pending = { form, submitter: event.submitter };
        $('#confirmMessage').textContent = form.dataset.confirm;
        const accept = $('#confirmAccept');
        accept.textContent = form.dataset.confirmLabel || 'Onayla';
        accept.className = `btn btn-sm ${form.dataset.confirmTone === 'danger' ? 'btn-danger' : 'btn-primary'}`;
        dialog.showModal();
        return;
      }

      if (form.method.toLowerCase() === 'post') {
        const button = event.submitter || $('button[type="submit"]', form);
        if (button) button.classList.add('is-loading');
      }
    });

    if (dialog) {
      $('#confirmCancel').addEventListener('click', () => dialog.close());
      $('#confirmAccept').addEventListener('click', () => {
        dialog.close();
        if (!pending) return;
        pending.form.dataset.confirmed = 'true';
        pending.form.submit();
      });
    }

    // Geri tuşuyla dönüldüğünde butonlar kilitli kalmasın.
    window.addEventListener('pageshow', () => {
      $$('.is-loading').forEach(button => button.classList.remove('is-loading'));
      $$('form[data-confirmed]').forEach(form => delete form.dataset.confirmed);
    });

    $$('[data-autosubmit]').forEach(control => {
      control.addEventListener('change', () => control.form.requestSubmit());
    });
  }

  /* Durum sekmeleri */
  function initTabs() {
    $$('[data-tabs]').forEach(tabs => {
      const list = document.getElementById(tabs.dataset.tabs);
      const emptyNote = tabs.parentElement.querySelector('.tabs-empty');
      const rows = $$('[data-status]', list);

      $$('.tab', tabs).forEach(tab => {
        tab.addEventListener('click', () => {
          $$('.tab', tabs).forEach(other => other.setAttribute('aria-selected', String(other === tab)));
          let visible = 0;
          rows.forEach(row => {
            const match = tab.dataset.filter === 'all' || row.dataset.status === tab.dataset.filter;
            row.hidden = !match;
            if (match) visible += 1;
          });
          list.hidden = visible === 0;
          emptyNote.hidden = visible !== 0;
        });
      });
    });
  }

  /* Sekme grupları (ana sayfa vitrini): oklarla da gezilir */
  function initTabsets() {
    $$('[data-tabset]').forEach(list => {
      const tabs = $$('[role="tab"]', list);
      const select = tab => {
        tabs.forEach(other => {
          const active = other === tab;
          other.setAttribute('aria-selected', String(active));
          other.tabIndex = active ? 0 : -1;
          const panel = document.getElementById(other.getAttribute('aria-controls'));
          if (panel) panel.hidden = !active;
        });
      };
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', event => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = tabs[(index + step + tabs.length) % tabs.length];
          select(next);
          next.focus();
        });
      });
    });
  }

  /* Talep galerisi */
  function initGallery() {
    const frame = $('a.gallery-main');
    if (!frame) return;
    const thumbs = $$('.gallery-thumb');
    const image = $('img', frame);
    const counter = $('.gallery-count');
    let current = 0;

    frame.addEventListener('click', event => {
      if (event.target.closest('.gallery-nav')) return;
      event.preventDefault();
      const urls = thumbs.length ? thumbs.map(thumb => thumb.dataset.full) : [frame.getAttribute('href')];
      openLightbox(urls, current, image.alt);
    });
    if (!thumbs.length) return;

    const show = index => {
      current = (index + thumbs.length) % thumbs.length;
      const src = thumbs[current].dataset.full;
      image.src = src;
      frame.href = src;
      image.classList.remove('is-swapping');
      void image.offsetWidth; // animasyon yeniden başlasın
      image.classList.add('is-swapping');
      thumbs.forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === current)));
      if (counter) counter.textContent = `${current + 1} / ${thumbs.length}`;
    };

    thumbs.forEach((thumb, index) => thumb.addEventListener('click', () => show(index)));
    $$('.gallery-nav').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        show(current + Number(button.dataset.step));
      });
    });
  }

  /* Fotoğraf görüntüleyici: ok tuşları, Esc ve dışına tıklama çalışır */
  function openLightbox(urls, start, alt) {
    let dialog = $('#lightbox');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'lightbox';
      dialog.className = 'lightbox';
      dialog.innerHTML = '<img alt=""><button class="lightbox-close" type="button" aria-label="Kapat">×</button>' +
        '<button class="lightbox-nav lightbox-prev" type="button" aria-label="Önceki fotoğraf">‹</button>' +
        '<button class="lightbox-nav lightbox-next" type="button" aria-label="Sonraki fotoğraf">›</button>' +
        '<span class="lightbox-count"></span>';
      document.body.append(dialog);
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      $('.lightbox-close', dialog).addEventListener('click', () => dialog.close());
    }
    const picture = $('img', dialog);
    const counter = $('.lightbox-count', dialog);
    let index = start;
    const show = next => {
      index = (next + urls.length) % urls.length;
      picture.src = urls[index];
      picture.alt = alt || '';
      counter.textContent = urls.length > 1 ? `${index + 1} / ${urls.length}` : '';
    };
    $$('.lightbox-nav', dialog).forEach(button => { button.hidden = urls.length < 2; });
    $('.lightbox-prev', dialog).onclick = () => show(index - 1);
    $('.lightbox-next', dialog).onclick = () => show(index + 1);
    dialog.onkeydown = event => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
    };
    show(start);
    dialog.showModal();
  }

  function initPortfolio() {
    const links = $$('.portfolio-grid a');
    links.forEach((link, index) => {
      link.addEventListener('click', event => {
        event.preventDefault();
        openLightbox(links.map(item => item.getAttribute('href')), index, $('img', link).alt);
      });
    });
  }

  /* Bağlantı kopyalama */
  function initCopyLink() {
    const button = $('[data-copy-link]');
    if (!button) return;
    const label = $('span', button);
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        label.textContent = 'Kopyalandı';
      } catch {
        label.textContent = 'Kopyalanamadı';
      }
      setTimeout(() => { label.textContent = 'Bağlantıyı Kopyala'; }, 1800);
    });
  }

  /* Paylaş menüsü: dışarı tıklayınca kapanır; telefonda cihazın kendi paylaşım penceresi açılır */
  function initShareMenu() {
    const menu = $('.share-menu');
    if (!menu) return;
    const summary = $('summary', menu);
    summary.addEventListener('click', event => {
      if (menu.open || !navigator.share || !window.matchMedia('(pointer: coarse)').matches) return;
      event.preventDefault();
      navigator.share({ title: menu.dataset.shareTitle || document.title, url: location.href })
        .catch(error => { if (error.name !== 'AbortError') menu.open = true; });
    });
    document.addEventListener('click', event => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); }
    });
    $$('.share-item', menu).forEach(item => item.addEventListener('click', () => {
      if (!item.hasAttribute('data-copy-link')) menu.open = false;
    }));
  }

  /* Konuşma: en alttan başlar, sayfa açıkken yeni mesajları alır */
  function initThread() {
    const thread = $('#thread');
    if (!thread) return;
    const emptyNote = $('.thread-empty', thread);
    const scrollDown = () => { thread.scrollTop = thread.scrollHeight; };
    scrollDown();

    const textarea = $('#messageContent');
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) textarea.form.requestSubmit();
    });

    let last = thread.dataset.last;
    let polling = false;

    const addMessage = message => {
      const box = document.createElement('div');
      box.className = `msg${message.mine ? ' msg-mine' : ''}`;
      // Yalnızca sitenin kendi yüklediği görseller gösterilir.
      if (/^\/uploads\/[\w.-]+$/.test(message.image || '')) {
        const link = document.createElement('a');
        link.className = 'msg-image';
        link.href = message.image;
        link.target = '_blank';
        link.rel = 'noopener';
        const image = document.createElement('img');
        image.src = message.image.replace(/\.webp$/, '_t.webp');
        image.alt = 'Gönderilen fotoğraf';
        image.width = 200;
        image.height = 150;
        link.append(image);
        box.append(link);
      }
      if (message.content) {
        const text = document.createElement('div');
        text.className = 'msg-text';
        text.textContent = message.content; // HTML olarak yorumlanmaz
        box.append(text);
      }
      const time = document.createElement('div');
      time.className = 'msg-time';
      time.textContent = message.time;
      box.append(time);
      thread.append(box);
    };

    const poll = async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const query = last ? `?after=${encodeURIComponent(last)}` : '';
        const response = await fetch(thread.dataset.poll + query, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const { messages } = await response.json();
        if (messages.length) {
          emptyNote.hidden = true;
          const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
          messages.forEach(addMessage);
          last = messages[messages.length - 1].id;
          if (atBottom) scrollDown();
        }
      } catch {
        // Bağlantı geçici olarak kesildiyse bir sonraki denemede alınır.
      } finally {
        polling = false;
      }
    };

    setInterval(poll, 8000);
  }

  /* Çerez onayı: seçim yapılana kadar yalnızca zorunlu çerezler kullanılır */
  const CONSENT_COOKIE = 'cookie_consent';
  const CONSENT_DAYS = 180;
  const RECENT_KEY = 'recent_requests';

  function readConsent() {
    const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
    if (!match) return null;
    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
  }

  function writeConsent(choice) {
    const value = encodeURIComponent(JSON.stringify({ ...choice, date: new Date().toISOString() }));
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
    if (!choice.preferences) {
      try { localStorage.removeItem(RECENT_KEY); } catch { /* depolama kapalı olabilir */ }
    }
  }

  function initCookieBanner() {
    const banner = $('#cookieBanner');
    if (!banner) return;
    const options = $('#cookieOptions');
    const settings = $('#cookieSettings');
    const save = $('#cookieSave');

    const open = withOptions => {
      const current = readConsent() || {};
      ['preferences', 'analytics', 'ads'].forEach(name => {
        options.elements[name].checked = Boolean(current[name]);
      });
      options.hidden = !withOptions;
      save.hidden = !withOptions;
      settings.hidden = withOptions;
      banner.hidden = false;
      document.body.classList.add('has-cookie-banner');
    };
    const close = choice => {
      writeConsent(choice);
      banner.hidden = true;
      document.body.classList.remove('has-cookie-banner');
    };

    banner.addEventListener('click', event => {
      const button = event.target.closest('[data-cookie]');
      if (!button) return;
      const all = button.dataset.cookie === 'all';
      close({ preferences: all, analytics: all, ads: all });
    });
    settings.addEventListener('click', () => open(true));
    save.addEventListener('click', () => {
      close({
        preferences: options.elements.preferences.checked,
        analytics: options.elements.analytics.checked,
        ads: options.elements.ads.checked
      });
    });
    $$('[data-cookie-open]').forEach(button => button.addEventListener('click', () => open(true)));

    if (!readConsent()) open(false);
  }

  /* Son gezilen talepler: yalnızca tercih çerezine onay verildiyse tutulur */
  function initRecent() {
    const consent = readConsent();
    if (!consent || !consent.preferences) return;

    const read = () => {
      try {
        const items = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    };

    const data = $('#recentData');
    if (data) {
      const { url, title, image, budget } = data.dataset;
      const items = [{ url, title, image, budget }, ...read().filter(item => item.url !== url)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(items)); } catch { /* depolama kapalı olabilir */ }
    }

    const box = $('#recentBox');
    if (!box) return;
    const items = read().filter(item => /^\/requests\/[a-f0-9]{24}$/.test(item.url)).slice(0, 4);
    if (!items.length) return;

    $('#recentGrid').replaceChildren(
      ...items.map(item => {
        const link = document.createElement('a');
        link.className = 'showcase-item';
        link.href = BASE + item.url;

        const photo = document.createElement('div');
        photo.className = 'showcase-photo';
        if (/^\/(img|uploads)\//.test(item.image)) {
          const image = document.createElement('img');
          image.src = BASE + item.image;
          image.alt = '';
          photo.append(image);
        } else {
          const none = document.createElement('span');
          none.className = 'no-photo';
          none.textContent = 'Fotoğraf yok';
          photo.append(none);
        }

        const title = document.createElement('div');
        title.className = 'showcase-title';
        title.textContent = item.title;
        const price = document.createElement('div');
        price.className = 'showcase-price';
        price.textContent = item.budget;

        link.append(photo, title, price);
        return link;
      })
    );
    box.hidden = false;
  }

  /* Arama önerileri */
  function initSuggest() {
    const input = $('#siteSearch');
    const box = $('#searchSuggest');
    if (!input || !box) return;
    let timer;
    let latest = 0;
    let active = -1;

    const close = () => {
      box.hidden = true;
      active = -1;
    };

    const render = items => {
      box.replaceChildren(
        ...items.map(item => {
          const link = document.createElement('a');
          link.href = item.url;
          link.textContent = item.label; // HTML olarak yorumlanmaz
          const hint = document.createElement('span');
          hint.textContent = item.hint;
          link.append(hint);
          return link;
        })
      );
      box.hidden = items.length === 0;
      active = -1;
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) return close();
      timer = setTimeout(async () => {
        const ticket = ++latest;
        try {
          const response = await fetch(`/requests/suggest?q=${encodeURIComponent(query)}`);
          const { items } = await response.json();
          if (ticket === latest) render(items);
        } catch {
          close();
        }
      }, 200);
    });

    input.addEventListener('keydown', event => {
      const links = $$('a', box);
      if (event.key === 'Escape') return close();
      if (box.hidden || !links.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((link, index) => link.classList.toggle('is-active', index === active));
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        location.href = links[active].href;
      }
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.searchbar')) close();
    });
  }

  /* Hazır mesaj yanıtları ve yazdırma */
  function initSmallActions() {
    $$('[data-quick-reply]').forEach(button => {
      button.addEventListener('click', () => {
        const textarea = $('#messageContent');
        textarea.value = textarea.value ? `${textarea.value} ${button.dataset.quickReply}` : button.dataset.quickReply;
        textarea.focus();
      });
    });
    $$('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
    $$('[data-fill-target]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const field = document.getElementById(button.dataset.fillTarget);
        field.value = button.dataset.fillText;
        field.focus();
      });
    });
  }

  /* Talep formu: seçilen kategoriye göre yardımcı sorular */
  function initCategoryTip() {
    const select = $('#category');
    const box = $('#categoryTip');
    if (!select || !box) return;
    const description = $('#description');

    const currentTip = () => (select.selectedOptions[0] ? select.selectedOptions[0].dataset.tip || '' : '');
    const update = () => { box.hidden = !currentTip() || description.value.includes(currentTip()); };

    select.addEventListener('change', update);
    description.addEventListener('input', update);
    $('#categoryTipAdd').addEventListener('click', () => {
      description.value = description.value ? `${description.value}\n\n${currentTip()}` : currentTip();
      description.dispatchEvent(new Event('input', { bubbles: true }));
      description.focus();
    });
    update();
  }

  /* Talep formu: başlıktan kategori tahmini ve kategorideki fiyat aralığı */
  function initCategoryGuess() {
    const select = $('#category');
    const title = $('#title');
    if (!select || !title) return;
    const note = $('#categoryGuess');
    const price = $('#categoryPrice');
    let auto = select.dataset.guessed || '';

    const exampleTitle = $('#exampleTitle');
    const exampleText = $('#exampleText');
    const showPrice = () => {
      const chosen = select.selectedOptions[0];
      const range = chosen ? chosen.dataset.price : '';
      price.hidden = !range;
      price.textContent = range ? `Bu kategoride verilen teklifler ${range} arasında.` : '';
      // Sağdaki örnek seçilen işe uysun.
      if (exampleTitle && chosen && chosen.dataset.exampleTitle) {
        exampleTitle.textContent = chosen.dataset.exampleTitle;
        exampleText.textContent = chosen.dataset.exampleText;
      }
    };
    select.addEventListener('change', event => {
      showPrice();
      // Kişi kendisi seçtiyse (listeden ya da kategori kutusundan) tahmin bir daha üstüne yazmaz.
      if (event.isTrusted || event.detail === 'picker') {
        auto = '';
        note.hidden = true;
      }
    });
    title.addEventListener('input', () => {
      if (select.value && select.value !== auto) return;
      const text = title.value.toLocaleLowerCase('tr-TR');
      let best = '';
      let bestLength = 0;
      Array.from(select.options).forEach(option => {
        (option.dataset.keywords || '').split(',').forEach(word => {
          if (word && word.length > bestLength && text.includes(word)) {
            best = option.value;
            bestLength = word.length;
          }
        });
      });
      if (best && best !== select.value) {
        select.value = best;
        auto = best;
        note.hidden = false;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    showPrice();
  }

  /* Talep formu: kategori ikonlu kutulardan seçilir; liste yedek olarak arkada kalır */
  function initCategoryPicker() {
    const picker = $('[data-cat-picker]');
    const select = $('#category');
    if (!picker || !select) return;
    const tiles = $$('.cat-pick', picker);
    const sync = () => tiles.forEach(tile => tile.setAttribute('aria-pressed', String(tile.dataset.value === select.value)));
    tiles.forEach(tile => tile.addEventListener('click', () => {
      select.value = tile.dataset.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: 'picker' }));
    }));
    select.addEventListener('change', sync);
    select.tabIndex = -1;
    select.closest('.field').classList.add('has-picker');
    picker.hidden = false;
    sync();
  }

  /* Firma rehberi: en fazla üç firma seçilip karşılaştırılır. Liste yeniden çizilse de çalışsın diye olay belgeye bağlanır. */
  function initCompare() {
    const bar = $('[data-compare-bar]');
    if (!bar) return;
    const go = $('[data-compare-go]', bar);
    const base = go.getAttribute('href');
    const update = () => {
      const picked = $$('[data-compare]:checked').map(box => box.value);
      $('[data-compare-count]', bar).textContent = picked.length;
      $('[data-compare-hint]', bar).textContent = picked.length < 2 ? 'Bir firma daha seçin' : picked.length === 3 ? 'En fazla üç firma' : 'Bir firma daha ekleyebilirsiniz';
      bar.hidden = picked.length === 0;
      go.setAttribute('aria-disabled', String(picked.length < 2));
      go.href = picked.length >= 2 ? `${base}?ids=${picked.join(',')}` : base;
      $$('[data-compare]').forEach(box => { box.disabled = !box.checked && picked.length >= 3; });
    };
    document.addEventListener('change', event => {
      if (event.target.matches('[data-compare]')) update();
    });
    go.addEventListener('click', event => {
      if (go.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    $('[data-compare-clear]', bar).addEventListener('click', () => {
      $$('[data-compare]:checked').forEach(box => { box.checked = false; });
      update();
    });
    update();
  }

  /* Talep taslağı: yalnızca tercih çerezine onay verildiyse tarayıcıda saklanır */
  function initDraft() {
    const form = $('form[data-draft]');
    if (!form) return;
    const consent = readConsent();
    if (!consent || !consent.preferences) return;

    const key = form.dataset.draft;
    const fields = ['category', 'title', 'description', 'city', 'location', 'budgetMin', 'budgetMax', 'deadline']
      .map(name => form.elements[name]);
    const note = $('#draftNote');
    const forget = () => { try { localStorage.removeItem(key); } catch { /* depolama kapalı olabilir */ } };

    const isEmpty = fields.every(field => !field.value);
    if (isEmpty) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* bozuk taslak yok sayılır */ }
      if (saved && typeof saved === 'object' && Object.values(saved).some(Boolean)) {
        fields.forEach(field => {
          if (typeof saved[field.name] === 'string') field.value = saved[field.name];
        });
        note.hidden = false;
        form.elements.category.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    let timer;
    form.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const draft = Object.fromEntries(fields.map(field => [field.name, field.value]));
        try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* depolama kapalı olabilir */ }
      }, 400);
    });
    form.addEventListener('submit', () => {
      clearTimeout(timer);
      forget();
    });
    $('#draftClear').addEventListener('click', () => {
      clearTimeout(timer);
      forget();
      form.reset();
      note.hidden = true;
      form.elements.category.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /* Firma sayfası: seçilen talebe davet */
  function initInviteForm() {
    const form = $('[data-invite]');
    if (!form) return;
    const setAction = () => { form.action = `/requests/${$('select', form).value}/invite/${form.dataset.invite}`; };
    $('select', form).addEventListener('change', setAction);
    setAction();
  }

  /* Giriş yapanlarda okunmamış sayıları sayfa yenilenmeden güncellenir */
  function initUnreadBadges() {
    if (!document.body.dataset.loggedIn) return;
    const baseTitle = document.title;

    const apply = counts => {
      Object.entries(counts).forEach(([name, value]) => {
        $$(`[data-count="${name}"]`).forEach(badge => {
          badge.textContent = value;
          badge.hidden = !value;
        });
      });
      const total = counts.notifications + counts.messages;
      document.title = total ? `(${total}) ${baseTitle}` : baseTitle;
    };

    const poll = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch('/notifications/count', { headers: { Accept: 'application/json' } });
        if (response.ok && (response.headers.get('content-type') || '').includes('json')) apply(await response.json());
      } catch {
        // Bağlantı geçici olarak kesildiyse bir sonraki denemede alınır.
      }
    };
    setInterval(poll, 60000);
  }

  /* Sayfa başına dön */
  function initToTop() {
    const button = $('#toTop');
    if (!button) return;
    const update = () => { button.hidden = window.scrollY < 500; };
    window.addEventListener('scroll', update, { passive: true });
    button.addEventListener('click', () => {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    });
    update();
  }

  /* Giriş sayfasındaki örnek hesap butonları */
  function initDemoLogin() {
    $$('[data-demo-email]').forEach(button => {
      button.addEventListener('click', () => {
        $('#email').value = button.dataset.demoEmail;
        $('#password').value = button.dataset.demoPassword;
        $('#loginForm').requestSubmit();
      });
    });
  }


  /* Mesaja fotoğraf eklenince düğmede dosya adı görünür */
  function initAttach() {
    const input = $('#messageImage');
    if (!input) return;
    const label = $('[data-attach-label]');
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      label.textContent = file ? file.name : 'Fotoğraf ekle';
      input.closest('.attach-button').classList.toggle('has-file', Boolean(file));
    });
  }

  /* Son tarihe kalan süre, sayfa açık kaldıkça güncellenir */
  function remaining(date) {
    const minutes = Math.max(Math.floor((new Date(date).getTime() - Date.now()) / 60000), 0);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    if (days >= 2) return days + ' gün';
    if (days === 1) return hours ? '1 gün ' + hours + ' saat' : '1 gün';
    if (hours >= 1) return hours + ' saat';
    return Math.max(minutes, 1) + ' dakika';
  }

  function initDeadlines() {
    const items = $$('[data-deadline]');
    if (!items.length) return;
    const update = () => items.forEach(item => { item.textContent = remaining(item.dataset.deadline); });
    setInterval(update, 60000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMotion();
    initAlerts();
    initMenu();
    initCollapsedBoxes();
    initPasswordFields();
    initRolePicker();
    initDropzone();
    initForms();
    initTabs();
    initGallery();
    initPortfolio();
    initCategoryGuess();
    initCategoryPicker();
    initCompare();
    initCopyLink();
    initShareMenu();
    initThread();
    initDemoLogin();
    initCookieBanner();
    initRecent();
    initCategoryTip();
    initDraft();
    initInviteForm();
    initUnreadBadges();
    initToTop();
    initSuggest();
    initSmallActions();
    initAttach();
    initTabsets();
    initDeadlines();
  });
})();
