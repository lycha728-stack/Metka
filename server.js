'use strict';
/**
 * Metka: serwer wyszukiwania ubrań.
 * Bez zależności zewnętrznych, wymaga Node.js 20 lub nowszego.
 *
 * Przepływ:
 *  1. Strona wysyła opis ubrania do POST /api/search.
 *  2. Serwer prosi Claude (z narzędziem web search) o znalezienie konkretnych produktów.
 *  3. Serwer odrzuca adresy, których nie zwróciło wyszukiwanie (ochrona przed zmyślonymi linkami).
 *  4. Serwer pobiera każdą stronę produktu, sprawdza, czy to naprawdę produkt, i czyta zdjęcie oraz cenę.
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- konfiguracja ----------
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const MAX_SEARCHES = Math.min(Math.max(parseInt(process.env.MAX_SEARCHES || '5', 10) || 5, 1), 10);
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || '150', 10);
const IP_LIMIT = parseInt(process.env.IP_LIMIT || '6', 10); // zapytań na IP w oknie
const IP_WINDOW_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_HOSTS === '1'; // tylko do testów lokalnych
const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_CANDIDATES = 14;
const MAX_RESULTS = 12;
const UA = 'Mozilla/5.0 (compatible; MetkaBot/1.0; +link-preview)';

const WHO = ['Kobieta', 'Mężczyzna', 'Dziecko', 'Bez znaczenia'];

if (!API_KEY) console.warn('UWAGA: brak zmiennej ANTHROPIC_API_KEY. Wyszukiwanie nie zadziała.');

// ---------- pliki statyczne (płaska struktura) ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src * data:; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
};

// ---------- ochrona przed SSRF ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    if (l.startsWith('::ffff:')) return true;
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true;
}

// Sprawdzenie adresu w momencie łączenia (bez okna na podmianę DNS).
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => ALLOW_PRIVATE || !isPrivateIp(a.address));
    if (!ok.length) return cb(new Error('blocked address'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

function assertAllowed(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked protocol');
  if (u.username || u.password) throw new Error('blocked credentials');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (!ALLOW_PRIVATE && port !== 80 && port !== 443) throw new Error('blocked port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !ALLOW_PRIVATE && isPrivateIp(host)) throw new Error('blocked address');
}

function fetchOnce(u) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    let done = false;
    let timer;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pl,en;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return finish(resolve, { status, location: res.headers.location });
        }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        let size = 0;
        const result = () => ({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        stream.on('data', (c) => {
          size += c.length;
          chunks.push(c);
          if (size > MAX_PAGE_BYTES) {
            req.destroy();
            finish(resolve, result());
          }
        });
        stream.on('end', () => finish(resolve, result()));
        stream.on('error', (e) => finish(reject, e));
      }
    );
    req.on('error', (e) => finish(reject, e));
    timer = setTimeout(() => {
      req.destroy();
      finish(reject, new Error('timeout'));
    }, FETCH_TIMEOUT_MS);
    req.end();
  });
}

async function fetchPage(startUrl) {
  let u = new URL(startUrl);
  for (let hop = 0; hop <= 4; hop++) {
    assertAllowed(u);
    const r = await fetchOnce(u);
    if (r.status >= 300 && r.status < 400 && r.location) {
      u = new URL(r.location, u);
      continue;
    }
    return { ...r, url: u.toString() };
  }
  throw new Error('too many redirects');
}

// ---------- czytanie strony produktu ----------
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

function readMetas(html) {
  const map = {};
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    tag.replace(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (m, k, v1, v2) => {
      attrs[k.toLowerCase()] = v1 != null ? v1 : v2;
      return m;
    });
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content != null && !(key in map)) map[key] = decode(attrs.content);
  }
  return map;
}

function findProduct(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findProduct(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const t = node['@type'];
  const types = (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
  if (types.includes('product') || types.includes('productgroup')) return node;
  if (node['@graph']) return findProduct(node['@graph'], depth + 1);
  return null;
}

function firstImage(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstImage(v[0]);
  if (typeof v === 'object') return v.url || v.contentUrl || '';
  return '';
}

function offerPrice(o) {
  if (!o) return null;
  if (Array.isArray(o)) {
    for (const x of o) {
      const r = offerPrice(x);
      if (r) return r;
    }
    return null;
  }
  if (typeof o === 'object') {
    const spec = o.priceSpecification && !Array.isArray(o.priceSpecification) ? o.priceSpecification : {};
    const p = o.price != null && o.price !== '' ? o.price : o.lowPrice != null ? o.lowPrice : spec.price;
    if (p != null && p !== '') return { price: p, cur: o.priceCurrency || spec.priceCurrency || '' };
    if (o.offers) return offerPrice(o.offers);
  }
  return null;
}

function formatPrice(price, cur) {
  const n = parseFloat(String(price).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const pln = !cur || String(cur).toUpperCase() === 'PLN';
  const text = (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' ' + (pln ? 'zł' : cur);
  return { text, value: pln ? n : null };
}

function analyzePage(html) {
  const head = html.slice(0, MAX_PAGE_BYTES);
  const meta = readMetas(head);
  let product = null;
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while (!product && (m = re.exec(head))) {
    try {
      product = findProduct(JSON.parse(m[1].trim()));
    } catch (e) {
      /* uszkodzony JSON-LD, pomijamy */
    }
  }
  const metaPrice = meta['product:price:amount'] || meta['og:price:amount'];
  const metaCur = meta['product:price:currency'] || meta['og:price:currency'] || '';
  const isProduct = !!product || /product/i.test(meta['og:type'] || '') || !!metaPrice;

  let price = null;
  const op = product && offerPrice(product.offers);
  if (op) price = formatPrice(op.price, op.cur);
  if (!price && metaPrice) price = formatPrice(metaPrice, metaCur);

  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return {
    isProduct,
    title: decode((product && product.name) || meta['og:title'] || titleTag || ''),
    image: decode(firstImage(product && product.image) || meta['og:image'] || meta['twitter:image'] || ''),
    price,
  };
}

// ---------- Claude ----------
const SYSTEM = [
  'Jesteś wyszukiwarką produktów odzieżowych w sklepach internetowych dostępnych w Polsce.',
  'Na podstawie opisu użytkownika znajdź konkretne produkty, które możliwie najlepiej pasują.',
  '',
  'Zasady:',
  '1. Jeśli w opisie brakuje czegoś kluczowego (rodzaj ubrania albo dla kogo jest), nie szukaj. Zwróć {"status":"ask","questions":[{"q":"pytanie","options":["opcja","opcja"]}]}. Maksymalnie 3 pytania, każde z 2-5 krótkimi opcjami. Jeśli użytkownik już odpowiedział na pytania albo opis wystarcza, szukaj.',
  '2. Szukaj w sieci kilkoma różnymi zapytaniami. Zwracaj uwagę na polskie sklepy odzieżowe, a gdy pasuje, także Allegro, Vinted i OLX.',
  '3. Wybieraj wyłącznie strony pojedynczych produktów. Nie wybieraj kategorii, wyników wyszukiwania, rankingów ani artykułów.',
  '4. Używaj wyłącznie adresów URL zwróconych przez wyszukiwanie. Nigdy ich nie wymyślaj ani nie zmieniaj.',
  '5. Zwróć od 6 do 12 produktów, jeśli tyle pasuje, z kilku sklepów (z jednego sklepu najwyżej 4). Jeśli podano budżet, traktuj go jako twardy limit.',
  '6. Odpowiedź końcowa to wyłącznie jeden obiekt JSON, bez tekstu przed nim i po nim:',
  '{"status":"ok","summary":"jedno zdanie: jak zrozumiałeś opis","products":[{"title":"nazwa produktu","shop":"nazwa sklepu","url":"adres z wyszukiwania","price":"189 zł albo pusty tekst","why":"krótko, czym pasuje"}]}',
  'Jeśli nic nie pasuje, zwróć {"status":"ok","summary":"...","products":[]}.',
].join('\n');

function buildUserPrompt(input) {
  const lines = [
    'Opis ubrania: ' + input.description,
    'Dla kogo: ' + input.who,
    'Budżet maksymalny: ' + (input.budget ? input.budget + ' zł' : 'brak'),
  ];
  if (input.answers.length) {
    lines.push('Odpowiedzi użytkownika na pytania:');
    for (const a of input.answers) lines.push('- ' + a.q + ' -> ' + a.a);
  }
  return lines.join('\n');
}

async function callClaude(messages) {
  const res = await fetch(API_BASE + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
          user_location: { type: 'approximate', country: 'PL', timezone: 'Europe/Warsaw' },
        },
      ],
      messages,
    }),
    signal: AbortSignal.timeout(110000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error('anthropic ' + res.status + ' ' + t.slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    let s = u.toString();
    if (u.pathname !== '/' && s.endsWith('/') && !u.search) s = s.slice(0, -1);
    return s;
  } catch (e) {
    return '';
  }
}

function extractJson(text) {
  let start = text.lastIndexOf('{"status"');
  if (start < 0) start = text.lastIndexOf('{ "status"');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function parseModelPrice(s) {
  const t = str(s, 40);
  if (!t) return null;
  const m = t.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)/);
  if (!m) return { text: t, value: null };
  const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  const pln = /zł|zl|pln/i.test(t);
  return { text: t, value: pln && Number.isFinite(n) ? n : null };
}

async function enrich(candidate, budget) {
  let info = null;
  try {
    info = await fetchPage(candidate.url);
  } catch (e) {
    const msg = String(e && (e.code || e.message));
    if (/ENOTFOUND|blocked|EAI_AGAIN|protocol|port|credentials/i.test(msg)) return { drop: 'unreachable' };
    // timeout, reset itp.: zostawiamy bez weryfikacji
  }
  const fallbackPrice = parseModelPrice(candidate.price);
  let result = {
    title: candidate.title,
    shop: candidate.shop || hostOf(candidate.url),
    host: hostOf(candidate.url),
    url: candidate.url,
    image: '',
    price: fallbackPrice ? fallbackPrice.text : '',
    priceValue: fallbackPrice ? fallbackPrice.value : null,
    why: candidate.why,
    verified: false,
  };
  if (info) {
    if (info.status === 404 || info.status === 410) return { drop: 'dead' };
    const type = String((info.headers && info.headers['content-type']) || '');
    if (info.status === 200 && /html/i.test(type)) {
      const a = analyzePage(info.body);
      if (!a.isProduct) return { drop: 'not-product' };
      let image = '';
      try {
        const iu = new URL(a.image, info.url);
        if (iu.protocol === 'http:' || iu.protocol === 'https:') image = iu.toString();
      } catch (e) {
        /* brak poprawnego zdjęcia */
      }
      result = {
        ...result,
        finalUrl: normUrl(info.url),
        title: str(a.title, 160) || result.title,
        image,
        price: a.price ? a.price.text : result.price,
        priceValue: a.price ? a.price.value : result.priceValue,
        verified: true,
      };
    }
  }
  if (budget && result.priceValue != null && result.priceValue > budget) return { drop: 'over-budget' };
  return { product: result };
}

async function runSearch(input) {
  const messages = [{ role: 'user', content: buildUserPrompt(input) }];
  const seen = new Set();
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const data = await callClaude(messages);
    for (const b of data.content || []) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r && r.url) seen.add(normUrl(r.url));
      } else if (b.type === 'text') text += b.text || '';
    }
    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    break;
  }

  const json = extractJson(text);
  if (!json) {
    const err = new Error('bad model response');
    err.code = 'BAD_RESPONSE';
    throw err;
  }

  if (json.status === 'ask') {
    const questions = (Array.isArray(json.questions) ? json.questions : [])
      .slice(0, 3)
      .map((q) => ({
        q: str(q && q.q, 140),
        options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 5).map((o) => str(o, 40)).filter(Boolean),
      }))
      .filter((q) => q.q && q.options.length >= 2);
    if (questions.length && !input.answers.length) return { status: 'ask', questions };
  }

  const raw = Array.isArray(json.products) ? json.products : [];
  const stats = { returned: raw.length, invented: 0, dead: 0, notProduct: 0, overBudget: 0 };
  const cands = [];
  const urls = new Set();
  for (const p of raw) {
    const url = normUrl(p && p.url);
    if (!url || !/^https?:/i.test(url)) continue;
    if (!seen.has(url)) {
      stats.invented++;
      continue;
    }
    if (urls.has(url)) continue;
    urls.add(url);
    cands.push({ url, title: str(p.title, 160), shop: str(p.shop, 40), price: p.price, why: str(p.why, 160) });
    if (cands.length >= MAX_CANDIDATES) break;
  }

  const checked = await pool(cands, 5, (c) => enrich(c, input.budget));
  let products = [];
  const finals = new Set();
  for (const r of checked) {
    if (r.product) {
      const key = r.product.finalUrl || r.product.url;
      if (finals.has(key)) continue; // dwa adresy, ta sama strona po przekierowaniu
      finals.add(key);
      delete r.product.finalUrl;
      products.push(r.product);
    }
    else if (r.drop === 'dead' || r.drop === 'unreachable') stats.dead++;
    else if (r.drop === 'not-product') stats.notProduct++;
    else if (r.drop === 'over-budget') stats.overBudget++;
  }
  products.sort((a, b) => Number(b.verified) - Number(a.verified));
  products = products.slice(0, MAX_RESULTS);
  console.log('search', JSON.stringify({ q: input.description.slice(0, 60), ...stats, shown: products.length }));
  return { status: 'ok', summary: str(json.summary, 240), products };
}

// ---------- limity i pamięć podręczna ----------
const ipHits = new Map();
let dayKey = '';
let dayCount = 0;
const cache = new Map();

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || 'unknown';
}

function rateCheck(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_LIMIT) return 'Za dużo zapytań. Spróbuj za kilka minut.';
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= DAILY_LIMIT) return 'Dzienny limit wyszukiwań został wyczerpany. Wróć jutro.';
  hits.push(now);
  ipHits.set(ip, hits);
  dayCount++;
  return null;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
  for (const [k, v] of ipHits) if (!v.some((t) => now - t < IP_WINDOW_MS)) ipHits.delete(k);
}, 5 * 60 * 1000).unref();

// ---------- HTTP ----------
function send(res, status, body, headers) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function codeOk(req) {
  if (!ACCESS_CODE) return true;
  const a = Buffer.from(String(req.headers['x-access-code'] || ''));
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanInput(body) {
  const description = str(body.description, 400);
  if (description.length < 3) return { error: 'Opisz ubranie w kilku słowach.' };
  const who = WHO.includes(body.who) ? body.who : 'Bez znaczenia';
  const budget = Math.min(Math.max(parseInt(body.budget, 10) || 0, 0), 100000);
  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .slice(0, 3)
    .map((a) => ({ q: str(a && a.q, 140), a: str(a && a.a, 60) }))
    .filter((a) => a.q && a.a);
  return { input: { description, who, budget, answers } };
}

async function handleSearch(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: 'Serwer nie ma skonfigurowanego klucza API.' });
  if (!codeOk(req)) return sendJson(res, 401, { error: 'Nieprawidłowy kod dostępu.' });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: 'Nieprawidłowe zapytanie.' });
  }
  const { input, error } = cleanInput(body || {});
  if (error) return sendJson(res, 400, { error });

  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return sendJson(res, 200, hit.value);

  const limited = rateCheck(clientIp(req));
  if (limited) return sendJson(res, 429, { error: limited });

  try {
    const value = await runSearch(input);
    if (value.status === 'ok' && value.products.length) cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS });
    sendJson(res, 200, value);
  } catch (e) {
    console.error('search failed:', e && e.message);
    if (e && e.status === 429) return sendJson(res, 503, { error: 'Usługa AI jest chwilowo przeciążona. Spróbuj za moment.' });
    if (e && (e.status === 401 || e.status === 403)) return sendJson(res, 500, { error: 'Błąd konfiguracji serwera (klucz API).' });
    if (e && e.code === 'BAD_RESPONSE') return sendJson(res, 502, { error: 'AI zwróciło niepoprawną odpowiedź. Spróbuj jeszcze raz.' });
    sendJson(res, 502, { error: 'Nie udało się wyszukać. Spróbuj jeszcze raz.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, { accessCode: !!ACCESS_CODE });
    if (req.method === 'POST' && url.pathname === '/api/search') return await handleSearch(req, res);
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return fs.readFile(path.join(__dirname, file), (err, data) => {
        if (err) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
        send(res, 200, data, { 'content-type': type, 'cache-control': 'no-cache' });
      });
    }
    send(res, 404, 'Not found', { 'content-type': 'text/plain' });
  } catch (e) {
    console.error('request error:', e && e.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Błąd serwera.' });
  }
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.message));

server.listen(PORT, '0.0.0.0', () => console.log('Metka działa na porcie ' + PORT + ' (model: ' + MODEL + ')'));
