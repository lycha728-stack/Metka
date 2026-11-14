(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  var EXAMPLES = [
    'granatowa lniana koszula męska z krótkim rękawem',
    'zielona sukienka midi na wesele, rozkloszowana',
    'czarna bluza oversize z kapturem bez nadruków'
  ];
  var WHO = ['Kobieta', 'Mężczyzna', 'Dziecko', 'Bez znaczenia'];
  var MESSAGES = [
    'Szukam w sklepach…',
    'Wybieram pasujące produkty…',
    'Sprawdzam strony produktów…',
    'Pobieram zdjęcia i ceny…'
  ];

  var who = 'Bez znaczenia';
  var ctl = null;
  var progressTimer = null;
  var sortBy = 'match';
  var lastData = null;

  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    for (var k in props) {
      if (k === 'text') el.textContent = props[k];
      else if (k === 'class') el.className = props[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (n === 1) return one;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
    return many;
  }

  function safeUrl(u) {
    try {
      var p = new URL(u);
      return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : '';
    } catch (e) { return ''; }
  }

  // przykłady i wybór "dla kogo"
  EXAMPLES.forEach(function (t) {
    $('#examples').appendChild(h('button', { class: 'chip ghost', type: 'button', text: t, onclick: function () { $('#desc').value = t; $('#desc').focus(); } }));
  });
  function renderWho() {
    var box = $('#who');
    box.textContent = '';
    WHO.forEach(function (w) {
      box.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(w === who), text: w, onclick: function () { who = w; renderWho(); } }));
    });
  }
  renderWho();

  // kod dostępu (jeśli serwer go wymaga)
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    if (c && c.accessCode) {
      $('#codeWrap').hidden = false;
      try { $('#code').value = localStorage.getItem('metka-code') || ''; } catch (e) {}
    }
  }).catch(function () {});

  var out = $('#out');
  function busy(on) { $('#go').disabled = on; $('#stop').hidden = !on; }

  function startProgress() {
    var i = 0;
    var label = h('span', { text: MESSAGES[0] });
    out.textContent = '';
    out.appendChild(h('div', { class: 'status' }, h('div', { class: 'spin' }), label));
    clearInterval(progressTimer);
    progressTimer = setInterval(function () {
      i = Math.min(i + 1, MESSAGES.length - 1);
      label.textContent = MESSAGES[i];
    }, 8000);
  }
  function stopProgress() { clearInterval(progressTimer); progressTimer = null; }

  function showError(msg) {
    out.textContent = '';
    out.appendChild(h('p', { class: 'error', role: 'alert', text: msg }));
  }

  async function search(answers) {
    var desc = $('#desc').value.trim();
    if (desc.length < 3) { $('#desc').focus(); return; }
    var headers = { 'content-type': 'application/json' };
    var code = $('#code').value.trim();
    if (code) headers['x-access-code'] = code;
    var body = { description: desc, who: who, budget: parseInt($('#budget').value, 10) || 0, answers: answers || [] };

    busy(true);
    startProgress();
    ctl = new AbortController();
    try {
      var res = await fetch('/api/search', { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctl.signal });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'Błąd serwera (' + res.status + ').');
      if (code) { try { localStorage.setItem('metka-code', code); } catch (e) {} }
      if (data.status === 'ask') renderQuestions(data.questions || []);
      else { lastData = data; sortBy = 'match'; renderResults(); }
    } catch (e) {
      if (e && e.name === 'AbortError') out.textContent = '';
      else showError(e && e.message ? e.message : 'Nie udało się wyszukać.');
    } finally {
      busy(false);
      stopProgress();
      ctl = null;
    }
  }

  function renderQuestions(qs) {
    var picks = {};
    out.textContent = '';
    var card = h('div', { class: 'card' }, h('h2', { text: 'Jeszcze kilka szczegółów', style: 'font-size:22px' }));
    qs.forEach(function (q, i) {
      var box = h('div', { class: 'chips', role: 'group' });
      q.options.forEach(function (o) {
        var b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: o });
        b.addEventListener('click', function () {
          picks[i] = o;
          Array.prototype.forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        });
        box.appendChild(b);
      });
      card.appendChild(h('div', { class: 'q' }, h('p', { text: q.q }), box));
    });
    var next = h('button', { class: 'btn', type: 'button', text: 'Szukaj', onclick: function () {
      var answers = qs.map(function (q, i) { return picks[i] ? { q: q.q, a: picks[i] } : null; }).filter(Boolean);
      if (!answers.length) answers = [{ q: 'Doprecyzowanie', a: 'brak preferencji, przyjmij rozsądne założenia' }];
      search(answers);
    } });
    card.appendChild(h('div', { class: 'actions' }, next));
    out.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function productCard(p) {
    var href = safeUrl(p.url);
    var photo = h('a', { class: 'photo', href: href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': p.title });
    var img = safeUrl(p.image);
    function placeholder() {
      photo.textContent = '';
      photo.appendChild(h('div', { class: 'noimg', text: 'Zdjęcie dostępne na stronie sklepu' }));
    }
    if (img) {
      var el = h('img', { src: img, alt: p.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
      el.addEventListener('error', placeholder);
      photo.appendChild(el);
    } else placeholder();

    var meta = p.verified ? p.host : p.host + ' · strona nie została sprawdzona';
    return h('article', { class: 'prod' }, photo,
      h('div', { class: 'pbody' },
        h('div', { class: 'pname', text: p.title }),
        h('div', { class: 'pmeta', text: meta }),
        p.why ? h('div', { class: 'why', text: p.why }) : null,
        p.price ? h('div', { class: 'price', text: p.price }) : null,
        h('a', { class: 'open', href: href, target: '_blank', rel: 'noopener noreferrer', text: 'Zobacz produkt ›' })));
  }

  function renderResults() {
    var data = lastData;
    out.textContent = '';
    var products = (data.products || []).filter(function (p) { return safeUrl(p.url); });

    if (!products.length) {
      out.appendChild(h('div', { class: 'empty' },
        h('p', { text: 'Nie znalazłem produktów, które pasują i mają sprawdzoną stronę.' }),
        h('p', { class: 'summary', text: 'Spróbuj opisać ubranie inaczej, usunąć część wymagań albo zwiększyć budżet.' })));
      return;
    }

    var sortBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Sortowanie' });
    [['match', 'Najlepsze dopasowanie'], ['price', 'Cena rosnąco']].forEach(function (o) {
      sortBox.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(sortBy === o[0]), text: o[1], onclick: function () { sortBy = o[0]; renderResults(); } }));
    });

    var groups = {};
    var order = [];
    products.forEach(function (p) {
      if (!groups[p.host]) { groups[p.host] = { shop: p.shop || p.host, host: p.host, items: [] }; order.push(p.host); }
      groups[p.host].items.push(p);
    });

    out.appendChild(h('div', { class: 'bar' },
      h('div', {}, h('h2', { text: 'Znalezione produkty' }), h('span', { class: 'count', text: products.length + ' ' + plural(products.length, 'produkt', 'produkty', 'produktów') + ', ' + order.length + ' ' + plural(order.length, 'sklep', 'sklepy', 'sklepów') })),
      sortBox));
    if (data.summary) out.appendChild(h('p', { class: 'summary', text: data.summary }));

    order.forEach(function (host) {
      var g = groups[host];
      var items = g.items.slice();
      if (sortBy === 'price') {
        items.sort(function (a, b) {
          var av = a.priceValue == null ? Infinity : a.priceValue;
          var bv = b.priceValue == null ? Infinity : b.priceValue;
          return av - bv;
        });
      }
      var grid = h('div', { class: 'grid' });
      items.forEach(function (p) { grid.appendChild(productCard(p)); });
      out.appendChild(h('div', { class: 'group' },
        h('div', { class: 'group-head' }, h('h3', { text: g.shop }), h('span', { text: g.host + ' · ' + items.length + ' ' + plural(items.length, 'produkt', 'produkty', 'produktów') })),
        grid));
    });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#go').addEventListener('click', function () { search([]); });
  $('#stop').addEventListener('click', function () { if (ctl) ctl.abort(); });
})();
