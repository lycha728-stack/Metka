(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    }
    for (const c of kids) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  // ---------- pamięć w przeglądarce ----------
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* pamięć niedostępna */ } };

  const GENDERS = ['Kobieta', 'Mężczyzna', 'Dziecko'];
  const EXAMPLES = [
    'granatowa lniana koszula męska z krótkim rękawem',
    'zielona sukienka midi na wesele, rozkloszowana',
    'czarna bluza oversize z kapturem bez nadruków'
  ];

  let profile = Object.assign({ name: '', gender: '', size: '' }, load('metka-profile', {}));
  let personalize = load('metka-personalize', true) !== false;
  let favs = load('metka-favs', []);
  if (!Array.isArray(favs)) favs = [];
  let searches = load('metka-searches', []);
  if (!Array.isArray(searches)) searches = [];
  let who = GENDERS.includes(profile.gender) ? profile.gender : '';
  let sortBy = 'match';
  let lastData = null;
  let ctl = null;
  let progressLabel = null;

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (n === 1) return one;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
    return many;
  }

  function safeUrl(u) {
    try {
      const p = new URL(u);
      return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : '';
    } catch (e) { return ''; }
  }

  // ---------- zakładki ----------
  const TABS = ['szukaj', 'ulubione', 'opcje'];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = 'szukaj';
    TABS.forEach((t) => {
      $('#view-' + t).hidden = t !== name;
      $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'ulubione') renderFavs();
    if (location.hash !== '#' + name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignoruj */ } }
  }
  TABS.forEach((t) => $('#tab-' + t).addEventListener('click', () => { showTab(t); window.scrollTo({ top: 0 }); }));
  window.addEventListener('hashchange', () => showTab(location.hash.replace('#', '')));

  // ---------- przyciski wyboru ----------
  function chipGroup(box, options, getVal, onChange) {
    function draw() {
      box.textContent = '';
      options.forEach((o) => {
        const on = getVal() === o;
        box.appendChild(h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(on), text: o,
          onclick: () => { onChange(on ? '' : o); draw(); }
        }));
      });
    }
    draw();
    return draw;
  }

  const redrawWho = chipGroup($('#who'), GENDERS, () => who, (v) => { who = v; });

  EXAMPLES.forEach((t) => {
    $('#examples').appendChild(h('button', { class: 'chip ghost', type: 'button', text: t, onclick: () => { $('#desc').value = t; $('#desc').focus(); } }));
  });

  // ---------- profil i opcje ----------
  function updateGreeting() {
    $('#greeting').textContent = profile.name
      ? 'Cześć, ' + profile.name + '. Opisz ubranie, a pokażemy konkretne produkty.'
      : 'Opisz ubranie, a pokażemy konkretne produkty.';
  }
  let savedTimer;
  function profileChanged() {
    save('metka-profile', profile);
    updateGreeting();
    const el = $('#profileSaved');
    el.textContent = 'Zapisano.';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.textContent = 'Te dane podpowiadają się w wyszukiwaniu. Możesz je zmienić przy każdym szukaniu.'; }, 2500);
  }

  $('#opt-name').value = profile.name;
  $('#opt-name').addEventListener('input', (e) => { profile.name = e.target.value.trim().slice(0, 30); profileChanged(); });
  $('#opt-size').value = profile.size;
  $('#opt-size').addEventListener('input', (e) => {
    profile.size = e.target.value.trim().slice(0, 12);
    $('#size').value = profile.size;
    profileChanged();
  });
  chipGroup($('#opt-who'), GENDERS, () => profile.gender, (v) => { profile.gender = v; who = v; redrawWho(); profileChanged(); });
  // motyw: zawsze wybrany jest jeden z dwóch
  function drawTheme() {
    const box = $('#opt-theme');
    box.textContent = '';
    [['Jasny', 'light'], ['Ciemny', 'dark']].forEach((o) => {
      box.appendChild(h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(window.metkaTheme.get() === o[1]), text: o[0],
        onclick: () => { window.metkaTheme.set(o[1]); drawTheme(); }
      }));
    });
  }
  drawTheme();

  $('#opt-personalize').checked = personalize;
  $('#opt-personalize').addEventListener('change', (e) => { personalize = e.target.checked; save('metka-personalize', personalize); });

  function historyInfo() {
    $('#historyInfo').textContent = searches.length + ' ' + plural(searches.length, 'zapisane wyszukiwanie', 'zapisane wyszukiwania', 'zapisanych wyszukiwań');
  }
  let confirmClear = false;
  $('#clearHistory').addEventListener('click', () => {
    if (!confirmClear) {
      confirmClear = true;
      $('#clearHistory').textContent = 'Na pewno wyczyścić?';
      setTimeout(() => { confirmClear = false; $('#clearHistory').textContent = 'Wyczyść historię wyszukiwań'; }, 4000);
      return;
    }
    searches = [];
    save('metka-searches', searches);
    confirmClear = false;
    $('#clearHistory').textContent = 'Wyczyść historię wyszukiwań';
    historyInfo();
  });

  if (profile.size) $('#size').value = profile.size;
  updateGreeting();
  historyInfo();

  // kod dostępu (jeśli serwer go wymaga)
  fetch('/api/config').then((r) => r.json()).then((c) => {
    if (c && c.accessCode) {
      $('#codeWrap').hidden = false;
      try { $('#code').value = localStorage.getItem('metka-code') || ''; } catch (e) { /* pamięć niedostępna */ }
    }
  }).catch(() => {});

  // ---------- ulubione ----------
  const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
  const isFav = (url) => favs.some((f) => f.url === url);

  function updateFavUi() {
    $$('.heart').forEach((b) => {
      const on = isFav(b.dataset.url);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Usuń z ulubionych' : 'Dodaj do ulubionych');
    });
    const badge = $('#favCount');
    badge.hidden = favs.length === 0;
    badge.textContent = String(favs.length);
  }

  function toggleFav(p) {
    const i = favs.findIndex((f) => f.url === p.url);
    if (i >= 0) favs.splice(i, 1);
    else {
      favs.unshift({
        url: p.url, title: p.title, desc: p.desc || '', shop: p.shop, host: p.host, image: p.image || '',
        price: p.price || '', priceValue: p.priceValue == null ? null : p.priceValue, condition: p.condition || 'new'
      });
      favs = favs.slice(0, 200);
    }
    save('metka-favs', favs);
    updateFavUi();
    if (!$('#view-ulubione').hidden) renderFavs();
  }

  function renderFavs() {
    const box = $('#favOut');
    box.textContent = '';
    if (!favs.length) {
      box.appendChild(h('div', { class: 'empty' },
        h('p', { text: 'Nie masz jeszcze ulubionych produktów.' }),
        h('p', { class: 'summary', text: 'Dotknij serca przy produkcie w wynikach, a znajdziesz go tutaj.' })));
      return;
    }
    box.appendChild(h('div', { class: 'bar' }, h('div', {},
      h('h2', { text: 'Ulubione' }),
      h('span', { class: 'count', text: favs.length + ' ' + plural(favs.length, 'produkt', 'produkty', 'produktów') }))));
    box.appendChild(h('p', { class: 'summary', text: 'Cena i dostępność mogą się zmienić. Sprawdź je na stronie sklepu.' }));
    const grid = h('div', { class: 'grid' });
    favs.forEach((p) => grid.appendChild(productCard(p)));
    box.appendChild(grid);
  }

  // ---------- karta produktu ----------
  function productCard(p) {
    const href = safeUrl(p.url);
    const photo = h('a', { class: 'photo', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': p.title });
    const img = safeUrl(p.image);
    function placeholder() {
      photo.textContent = '';
      photo.appendChild(h('div', { class: 'noimg', text: 'Zdjęcie dostępne na stronie sklepu' }));
    }
    if (img) {
      const el = h('img', { src: img, alt: p.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
      el.addEventListener('error', placeholder);
      photo.appendChild(el);
    } else placeholder();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', HEART);
    svg.appendChild(path);
    const on = isFav(p.url);
    const heart = h('button', { class: 'heart', type: 'button', 'data-url': p.url, 'aria-pressed': String(on), 'aria-label': on ? 'Usuń z ulubionych' : 'Dodaj do ulubionych' }, svg);
    heart.addEventListener('click', () => toggleFav(p));

    const body = h('div', { class: 'pbody' },
      h('div', { class: 'shop' }, p.shop || p.host, p.condition === 'used' ? h('span', { class: 'used', text: 'Używane' }) : null),
      h('div', { class: 'pname', text: p.title }),
      p.desc ? h('div', { class: 'pdesc', text: p.desc }) : null,
      p.match === 'preference'
        ? h('div', { class: 'pref', text: 'Wynika z Twoich preferencji' }, p.reason ? h('small', { text: p.reason }) : null)
        : null,
      p.sizeNote ? h('div', { class: 'sz ' + (p.sizeStatus || 'unknown'), text: p.sizeNote }) : null,
      p.price ? h('div', { class: 'price', text: p.price }) : null,
      h('a', { class: 'open', href, target: '_blank', rel: 'noopener noreferrer', text: 'Zobacz produkt ›' }));

    return h('article', { class: 'prod' }, h('div', { class: 'photo-wrap' }, photo, heart), body);
  }

  // ---------- wyszukiwanie ----------
  const out = $('#out');
  // Czy opis zawiera już informację o rozmiarze, cenie albo płci? Jeśli nie, aplikacja dopyta.
  const HINT = new RegExp([
    '\\b(xxs|xs|s|m|l|xl|xxl|xxxl)\\b', '\\brozmiar', '\\bsize\\b', '\\d\\s?cm\\b',
    '\\d\\s?(zł|zl|pln|złotych|zlotych)', '\\bbud[żz]et', '\\bcen[aęy]\\b', '\\btani(o|e|a|ej)?\\b', '\\b(do|od) \\d+',
    'kobiet', '\\bdamsk', '\\bm[ęe]sk', '\\bfacet', '\\bch[łl]op', '\\bdziewcz', '\\bdziec', '\\bdla (niej|niego|mamy|taty|c[óo]rki|syna|[żz]ony|m[ęe][żz]a|ch[łl]opaka|dziewczyny)\\b', '\\bunisex'
  ].join('|'), 'i');

  function readForm() {
    return {
      who,
      size: $('#size').value.trim(),
      priceMin: parseInt($('#pmin').value, 10) || 0,
      priceMax: parseInt($('#pmax').value, 10) || 0
    };
  }
  const hasPrefs = (desc, f) => !!(f.who || f.size || f.priceMin || f.priceMax || HINT.test(desc));

  function busy(on) { $('#go').disabled = on; $('#stop').hidden = !on; }
  function showStatus(text) {
    out.textContent = '';
    progressLabel = h('span', { text });
    out.appendChild(h('div', { class: 'status' }, h('div', { class: 'spin' }), progressLabel));
  }
  function showError(msg) {
    out.textContent = '';
    out.appendChild(h('p', { class: 'error', role: 'alert', text: msg }));
  }

  // Pytanie o płeć, rozmiar i cenę, gdy użytkownik nie podał żadnej z tych rzeczy.
  function renderAsk() {
    let aWho = '';
    out.textContent = '';
    const whoBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Dla kogo' });
    chipGroup(whoBox, GENDERS, () => aWho, (v) => { aWho = v; });
    const aSize = h('input', { id: 'ask-size', type: 'text', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'np. M, 42, 128' });
    const aMin = h('input', { id: 'ask-min', type: 'number', inputmode: 'numeric', min: '0', step: '10', placeholder: '0' });
    const aMax = h('input', { id: 'ask-max', type: 'number', inputmode: 'numeric', min: '0', step: '10', placeholder: 'bez limitu' });

    const go = (skip) => {
      if (!skip) {
        who = aWho; redrawWho();
        if (aSize.value.trim()) $('#size').value = aSize.value.trim();
        if (aMin.value) $('#pmin').value = aMin.value;
        if (aMax.value) $('#pmax').value = aMax.value;
      }
      search(true);
    };

    out.appendChild(h('div', { class: 'card' },
      h('h2', { text: 'Dla kogo i w jakim rozmiarze?' }),
      h('p', { class: 'hint', text: 'Nie podałeś płci, rozmiaru ani ceny. Powiedz, co wiesz, a wyniki będą trafniejsze. Wszystkie pola są opcjonalne.' }),
      h('div', { class: 'q' }, h('p', { text: 'Dla kogo to ubranie?' }), whoBox),
      h('div', { class: 'row' },
        h('div', { class: 'field size' }, h('label', { for: 'ask-size', text: 'Rozmiar' }), aSize),
        h('div', { class: 'field money' }, h('label', { for: 'ask-min', text: 'Cena od (zł)' }), aMin),
        h('div', { class: 'field money' }, h('label', { for: 'ask-max', text: 'Cena do (zł)' }), aMax)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', text: 'Szukaj', onclick: () => go(false) }),
        h('button', { class: 'btn secondary', type: 'button', text: 'Szukaj bez tych informacji', onclick: () => go(true) }))));
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleLine(line, state) {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch (e) { return; }
    if (m.type === 'progress' && progressLabel) {
      progressLabel.textContent = m.stage === 'checking' && m.total
        ? 'Sprawdzam strony produktów (' + m.done + ' z ' + m.total + ')…'
        : 'Szukam w sklepach i serwisach z używanymi ubraniami…';
    } else if (m.type === 'result') state.result = m;
    else if (m.type === 'error') state.error = m.error || 'Nie udało się wyszukać.';
  }

  async function search(skipAsk) {
    const desc = $('#desc').value.trim();
    if (desc.length < 3) { $('#desc').focus(); return; }
    const f = readForm();
    if (!skipAsk && !hasPrefs(desc, f)) { renderAsk(); return; }

    const headers = { 'content-type': 'application/json' };
    const code = $('#code').value.trim();
    if (code) headers['x-access-code'] = code;
    const body = {
      description: desc, who: f.who, size: f.size, priceMin: f.priceMin, priceMax: f.priceMax,
      history: personalize ? searches.slice(0, 8).map((s) => ({ d: s.d, who: s.who })) : [],
      liked: personalize ? favs.slice(0, 10).map((x) => ({ t: x.title, s: x.shop })) : []
    };

    busy(true);
    showStatus('Szukam w sklepach i serwisach z używanymi ubraniami…');
    ctl = new AbortController();
    const state = { result: null, error: '' };
    try {
      const res = await fetch('/api/search', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      const type = res.headers.get('content-type') || '';
      if (!/ndjson/.test(type)) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Błąd serwera (' + res.status + ').');
      }
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach((l) => handleLine(l, state));
        }
        handleLine(buf, state);
      } else {
        (await res.text()).split('\n').forEach((l) => handleLine(l, state));
      }
      if (state.error) throw new Error(state.error);
      if (!state.result) throw new Error('Połączenie zostało przerwane. Spróbuj jeszcze raz.');
      if (code) { try { localStorage.setItem('metka-code', code); } catch (e) { /* pamięć niedostępna */ } }

      const data = state.result;
      if (data.status === 'unclear') {
        out.textContent = '';
        out.appendChild(h('div', { class: 'empty' }, h('p', { text: data.message }), h('p', { class: 'summary', text: 'Uzupełnij opis powyżej i dotknij „Znajdź”.' })));
        return;
      }
      lastData = data;
      sortBy = 'match';
      remember(desc, f);
      renderResults();
    } catch (e) {
      if (e && e.name === 'AbortError') out.textContent = '';
      else showError(e && e.message ? e.message : 'Nie udało się wyszukać.');
    } finally {
      busy(false);
      progressLabel = null;
      ctl = null;
    }
  }

  function remember(desc, f) {
    searches = searches.filter((s) => s.d !== desc);
    searches.unshift({ d: desc, who: f.who, t: Date.now() });
    searches = searches.slice(0, 30);
    save('metka-searches', searches);
    historyInfo();
  }

  function renderResults() {
    const data = lastData;
    out.textContent = '';
    const products = (data.products || []).filter((p) => safeUrl(p.url));

    if (!products.length) {
      out.appendChild(h('div', { class: 'empty' },
        h('p', { text: 'Nie znalazłem produktów, które pasują do opisu.' }),
        h('p', { class: 'summary', text: 'Spróbuj opisać ubranie inaczej, usunąć część wymagań albo zmienić przedział cenowy.' })));
      return;
    }

    const items = products.slice();
    if (sortBy === 'price') {
      items.sort((a, b) => (a.priceValue == null ? Infinity : a.priceValue) - (b.priceValue == null ? Infinity : b.priceValue));
    }

    const sortBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Sortowanie' });
    [['match', 'Najlepsze dopasowanie'], ['price', 'Cena rosnąco']].forEach((o) => {
      sortBox.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(sortBy === o[0]), text: o[1], onclick: () => { sortBy = o[0]; renderResults(); } }));
    });

    out.appendChild(h('div', { class: 'bar' },
      h('div', {}, h('h2', { text: 'Znalezione produkty' }),
        h('span', { class: 'count', text: products.length + ' ' + plural(products.length, 'produkt', 'produkty', 'produktów') })),
      sortBox));
    if (data.summary) out.appendChild(h('p', { class: 'summary', text: data.summary }));
    const grid = h('div', { class: 'grid' });
    items.forEach((p) => grid.appendChild(productCard(p)));
    out.appendChild(grid);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#go').addEventListener('click', () => search(false));
  $('#stop').addEventListener('click', () => { if (ctl) ctl.abort(); });

  updateFavUi();
  showTab(location.hash.replace('#', '') || 'szukaj');
})();
