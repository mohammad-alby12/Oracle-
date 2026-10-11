// ORACLE v2 — Part 1: Setup + Traffic
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const TOMTOM_KEY = process.env.TOMTOM_KEY || '';
const GEMINI_KEY = process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const MODEL_FALLBACK = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.0-flash-lite'];
const VERSION = '2.0.0';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function cGet(k) { const v = cache.get(k); if (!v) return null; if (Date.now() - v.t > CACHE_TTL) { cache.delete(k); return null; } return v.v; }
function cSet(k, v) { cache.set(k, { v, t: Date.now() }); }
function ok(res, data) { res.json({ success: true, data }); }
function fail(res, code, message, status = 400) { res.status(status).json({ success: false, error: { code, message } }); }
function ensureDataDir() { const d = path.join(__dirname, 'data'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d; }
function readHistory() { const f = path.join(ensureDataDir(), 'history.json'); if (!fs.existsSync(f)) return []; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } }
function writeHistory(arr) { const f = path.join(ensureDataDir(), 'history.json'); fs.writeFileSync(f, JSON.stringify(arr.slice(0, 500), null, 2)); }

const tomtomHttp = axios.create({ baseURL: 'https://api.tomtom.com', timeout: 12000, validateStatus: () => true });
const geminiHttp = axios.create({ baseURL: 'https://generativelanguage.googleapis.com/v1beta', timeout: 60000, validateStatus: () => true });
const publicHttp = axios.create({ timeout: 12000, validateStatus: () => true, headers: { 'User-Agent': 'ORACLE/2' } });

async function tomtom(pathStr, params = {}) {
  if (!TOMTOM_KEY) throw { status: 500, code: 'NO_KEY', message: 'TomTom API key belum diatur.' };
  const r = await tomtomHttp.get(pathStr, { params: { ...params, key: TOMTOM_KEY } });
  if (r.status !== 200) throw { status: r.status, code: 'TOMTOM_ERROR', message: r.data?.errorText || r.data?.message || 'TomTom tidak tersedia.' };
  return r.data;
}

app.get('/api/health', (req, res) => {
  ok(res, { status: 'ok', version: VERSION, uptime: Math.round(process.uptime()), tomtom: !!TOMTOM_KEY, gemini: !!GEMINI_KEY, model: GEMINI_MODEL, time: new Date().toISOString() });
});

app.get('/api/traffic/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return fail(res, 'NO_QUERY', 'Masukkan nama lokasi.');
  const ck = 'geo:' + q.toLowerCase();
  const hit = cGet(ck); if (hit) return ok(res, hit);
  try {
    const data = await tomtom('/search/2/geocode/' + encodeURIComponent(q) + '.json', { limit: 5, language: 'id-ID', typeahead: 'true' });
    const results = (data.results || []).map(r => ({
      address: r.address?.freeformAddress || '', city: r.address?.municipality || '',
      province: r.address?.countrySubdivision || '', country: r.address?.country || '',
      countryCode: r.address?.countryCode || '', lat: r.position?.lat, lon: r.position?.lon
    })).filter(r => r.lat && r.lon);
    const out = { query: q, count: results.length, results };
    cSet(ck, out); ok(res, out);
  } catch (e) {
    console.error('[GEOCODE]', e.message);
    fail(res, e.code || 'GEOCODE_FAILED', e.message, e.status || 500);
  }
});

app.get('/api/traffic/flow', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) return fail(res, 'BAD_COORD', 'Koordinat tidak valid.');
  const ck = 'flow:' + lat.toFixed(4) + ':' + lon.toFixed(4);
  const hit = cGet(ck); if (hit) return ok(res, hit);
  try {
    const data = await tomtom('/traffic/services/4/flowSegmentData/absolute/10/json', { point: lat + ',' + lon, unit: 'KMPH' });
    const d = data.flowSegmentData || {};
    const cur = d.currentSpeed || 0, free = d.freeFlowSpeed || 0;
    const ratio = free > 0 ? cur / free : 1;
    let status = 'LANCAR', level = 0, color = 'ok', pesan = 'Lalu lintas lancar.';
    if (d.roadClosure) { status = 'JALAN DITUTUP'; level = 4; color = 'danger'; pesan = 'Jalan ditutup.'; }
    else if (ratio < 0.3) { status = 'MACET PARAH'; level = 3; color = 'danger'; pesan = 'Macet parah.'; }
    else if (ratio < 0.5) { status = 'MACET'; level = 2; color = 'warn'; pesan = 'Macet.'; }
    else if (ratio < 0.75) { status = 'PADAT'; level = 1; color = 'warn'; pesan = 'Padat.'; }
    const out = { location: { lat, lon }, currentSpeed: cur, freeFlowSpeed: free, ratioPercent: Math.round(ratio * 100), delaySeconds: (d.currentTravelTime || 0) - (d.freeFlowTravelTime || 0), status, level, color, pesan, roadClosure: d.roadClosure || false, timestamp: new Date().toISOString(), source: 'TomTom' };
    cSet(ck, out); ok(res, out);
  } catch (e) {
    console.error('[FLOW]', e.message);
    fail(res, e.code || 'FLOW_FAILED', e.message, e.status || 500);
  }
});

app.post('/api/traffic/route', async (req, res) => {
  const { from, to, mode } = req.body || {};
  if (!from || !to) return fail(res, 'BAD_INPUT', 'Titik awal dan tujuan wajib.');
  if (typeof from.lat !== 'number' || typeof to.lat !== 'number') return fail(res, 'BAD_INPUT', 'Koordinat harus angka.');
  try {
    const loc = from.lat + ',' + from.lon + ':' + to.lat + ',' + to.lon;
    const data = await tomtom('/routing/1/calculateRoute/' + loc + '/json', { traffic: 'true', routeType: 'fastest', maxAlternatives: 2, travelMode: mode || 'car' });
    const routes = (data.routes || []).map((r, i) => ({
      index: i, isPrimary: i === 0,
      summary: { lengthKm: Math.round((r.summary?.lengthInMeters || 0) / 100) / 10, travelTimeMinutes: Math.round((r.summary?.travelTimeInSeconds || 0) / 60), trafficDelayMinutes: Math.round((r.summary?.trafficDelayInSeconds || 0) / 60), noTrafficTravelTimeSeconds: r.summary?.noTrafficTravelTimeInSeconds || 0, arrivalTime: r.summary?.arrivalTime || null },
      points: (r.legs || []).flatMap(l => (l.points || []).map(p => [p.latitude, p.longitude]))
    }));
    ok(res, { routes, from, to, mode: mode || 'car', timestamp: new Date().toISOString(), source: 'TomTom' });
  } catch (e) {
    console.error('[ROUTE]', e.message);
    fail(res, e.code || 'ROUTE_FAILED', e.message, e.status || 500);
  }
});

app.get('/api/traffic/incidents', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) return fail(res, 'BAD_COORD', 'Koordinat tidak valid.');
  try {
    const bbox = (lon - 0.2) + ',' + (lat - 0.2) + ',' + (lon + 0.2) + ',' + (lat + 0.2);
    const data = await tomtom('/traffic/services/5/incidentDetails', { bbox, fields: '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},startTime,from,to,length,delay,roadNumbers}}}', language: 'id-ID', categoryFilter: '0,1,2,3,4,5,6,7,8,9,10,11,14', timeValidityFilter: 'present' });
    const incidents = (data.incidents || []).map(inc => ({ id: inc.properties?.id, category: inc.properties?.iconCategory, delaySeconds: inc.properties?.delay || 0, from: inc.properties?.from || '', to: inc.properties?.to || '', description: inc.properties?.events?.[0]?.description || '', lengthMeters: inc.properties?.length || 0 }));
    ok(res, { count: incidents.length, incidents, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('[INCIDENTS]', e.message);
    fail(res, e.code || 'INCIDENTS_FAILED', e.message, e.status || 500);
  }
});

// ============================================================
// AI — DuckDuckGo Search + Gemini 3 Mode
// ============================================================
// ============================================================
// WEB SEARCH — Wikipedia + DDG fallback
// ============================================================
async function wikipediaSearch(query) {
  const results = [];
  try {
    // Step 1: cari artikel di Wikipedia Indonesia
    const searchR = await publicHttp.get('https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&srlimit=3&origin=*');
    if (searchR.data && searchR.data.query && searchR.data.query.search) {
      for (const item of searchR.data.query.search.slice(0, 3)) {
        const title = item.title;
        const snippet = item.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const url = 'https://id.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
        results.push({ title, snippet, url });
      }
    }
    
    // Step 2: kalau hasil < 2, coba Wikipedia English
    if (results.length < 2) {
      const enR = await publicHttp.get('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&srlimit=2&origin=*');
      if (enR.data && enR.data.query && enR.data.query.search) {
        for (const item of enR.data.query.search.slice(0, 2)) {
          const title = item.title;
          const snippet = item.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
          results.push({ title, snippet, url });
        }
      }
    }
  } catch (e) { console.log('[WIKI]', e.message); }
  return results;
}

async function duckDuckGoSearch(query) {
  // Try Wikipedia first
  const wikiResults = await wikipediaSearch(query);
  if (wikiResults.length > 0) {
    console.log('[WIKI] Hasil: ' + wikiResults.length);
    return wikiResults;
  }
  
  // Fallback ke DDG
  const results = [];
  try {
    const r1 = await publicHttp.get('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
    if (r1.data && r1.data.AbstractText) {
      results.push({ title: r1.data.Heading || query, snippet: r1.data.AbstractText, url: r1.data.AbstractURL || ('https://duckduckgo.com/?q=' + encodeURIComponent(query)) });
    }
  } catch (e) {}
  console.log('[DDG] Hasil: ' + results.length);
  return results;
}

const SYSTEM_PROMPTS = {
  fast: 'Anda adalah ORACLE AI, asisten digital cerdas, sopan, dan serbaguna.\n- Bahasa Indonesia sopan sebagai default. Ikuti bahasa pengguna.\n- Ringkas, padat, maksimal 3-4 paragraf.\n- Tidak membantu aktivitas ilegal.',
  web: 'Anda adalah ORACLE AI dalam MODE CARI WEB.\n- Anda sudah diberi hasil pencarian web di konteks pesan.\n- Gunakan informasi dari hasil pencarian untuk menjawab.\n- Sebutkan sumber dengan angka [1], [2], dst.\n- Jangan mengarang sumber.\n- Bahasa Indonesia sopan. Maksimal 4-5 paragraf.',
  think: 'Anda adalah ORACLE AI dalam MODE BERPIKIR MENDALAM.\n- Analisis pertanyaan dari berbagai sudut sebelum menjawab.\n- Gunakan langkah bernomor jika membantu.\n- Bahasa Indonesia sopan. Maksimal 6-8 paragraf.'
};

// ============================================================
// GEMINI — dengan fallback model otomatis
// ============================================================
async function tryGemini(model, body) {
  const r = await geminiHttp.post('/models/' + model + ':generateContent?key=' + GEMINI_KEY, body);
  return r;
}

async function geminiChatAdvanced(messages, systemPrompt, mode) {
  if (!GEMINI_KEY) throw { status: 500, code: 'NO_KEY', message: 'Gemini API key belum diatur.' };

  let thinkingBudget = 0;
  let sources = [];
  let searchCount = 0;

  // MODE WEB — cari di web dulu
  if (mode === 'web') {
    const userQuery = messages[messages.length - 1].content;
    console.log('[WEB] Query: ' + userQuery.slice(0, 60));
    const searchResults = await duckDuckGoSearch(userQuery);
    searchCount = searchResults.length;
    console.log('[WEB] Hasil: ' + searchCount);
    if (searchResults.length > 0) {
      const searchContext = 'Hasil pencarian web:\n\n' + searchResults.map((r, i) => '[' + (i + 1) + '] ' + r.title + '\nURL: ' + r.url + '\nRingkasan: ' + r.snippet).join('\n\n') + '\n\nGunakan informasi ini untuk menjawab. Sebutkan sumber dengan [1], [2], dst.';
      messages = [{ role: 'user', content: searchContext }, { role: 'assistant', content: 'Baik, saya sudah baca.' }, ...messages];
      sources = searchResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
    }
  }

  // MODE THINK — thinking config
  if (mode === 'think') { thinkingBudget = 10000; }

  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const baseBody = { contents, generationConfig: { temperature: mode === 'think' ? 0.6 : 0.8, maxOutputTokens: mode === 'think' ? 3000 : 2000, topP: 0.95 } };
  if (systemPrompt) baseBody.systemInstruction = { parts: [{ text: systemPrompt }] };

  // Pilih model sesuai mode
  let modelsToTry = [];
  if (mode === 'think') {
    modelsToTry = ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-2.0-flash-lite'];
  } else {
    modelsToTry = MODEL_FALLBACK.slice();
  }

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const body = JSON.parse(JSON.stringify(baseBody));
      if (thinkingBudget > 0 && model.includes('2.5')) body.generationConfig.thinkingConfig = { thinkingBudget };
      
      console.log('[AI] Trying model: ' + model + ' mode: ' + mode);
      const r = await tryGemini(model, body);
      
      if (r.status === 200) {
        const candidate = r.data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (text) {
          console.log('[AI] Success: ' + model);
          return { text, sources, model, mode, searchCount };
        }
      }
      
      // 404 (model gak ada), 503 (high demand), 429 (rate limit) — coba model berikutnya
      const errMsg = r.data?.error?.message || 'unknown';
      console.log('[AI] ' + model + ' gagal: ' + r.status + ' - ' + errMsg.slice(0, 80));
      lastError = { status: r.status, message: errMsg };
      
      // Kalau 401/403 (auth), gak usah retry
      if (r.status === 401 || r.status === 403) break;
      
      // Kalau 404 (model gak ada), lanjut ke model berikutnya
      // Kalau 503 (high demand), lanjut ke model berikutnya
      // Kalau 429 (rate limit), lanjut ke model berikutnya
    } catch (e) {
      console.log('[AI] ' + model + ' exception: ' + e.message);
      lastError = { status: 500, message: e.message };
    }
  }

  // Semua model gagal
  const finalMsg = lastError?.status === 429 
    ? 'Kuota AI habis. Coba lagi dalam 1-2 menit atau pilih mode Cepat.'
    : lastError?.status === 503
    ? 'Server AI sedang sibuk. Coba lagi dalam 30 detik.'
    : lastError?.message || 'Layanan AI tidak tersedia.';
  throw { status: lastError?.status || 500, code: 'ALL_MODELS_FAILED', message: finalMsg };
}

app.post('/api/ai/chat', async (req, res) => {
  const { message, history, context, mode } = req.body || {};
  if (!message || typeof message !== 'string') return fail(res, 'NO_MSG', 'Ketik pesan Anda.');
  if (message.length > 2000) return fail(res, 'TOO_LONG', 'Pesan terlalu panjang.');
  const chatMode = ['fast', 'web', 'think'].includes(mode) ? mode : 'fast';
  const systemPrompt = SYSTEM_PROMPTS[chatMode];
  let messages = [];
  if (context && context.trafficSummary) {
    messages.push({ role: 'user', content: 'Data lalu lintas terbaru: ' + JSON.stringify(context.trafficSummary).slice(0, 1500) });
    messages.push({ role: 'assistant', content: 'Baik.' });
  }
  (history || []).slice(-8).forEach(h => messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.content || '').slice(0, 1500) }));
  messages.push({ role: 'user', content: message });
  const startTime = Date.now();
  console.log('[AI] mode=' + chatMode + ' msg="' + message.slice(0, 50) + '"');
  try {
    const result = await geminiChatAdvanced(messages, systemPrompt, chatMode);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    ok(res, { reply: result.text, sources: result.sources || [], mode: chatMode, model: result.model, thinkingTime: elapsed, searchCount: result.searchCount || 0, source: 'gemini', timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('[AI]', e.message);
    fail(res, e.code || 'AI_FAILED', e.message || 'Layanan AI tidak tersedia.', e.status || 500);
  }
});

app.post('/api/ai/translate', async (req, res) => {
  const { text, to } = req.body || {};
  if (!text) return fail(res, 'NO_TEXT', 'Teks wajib.');
  if (text.length > 3000) return fail(res, 'TOO_LONG', 'Maks 3000 karakter.');
  try {
    const body = { contents: [{ role: 'user', parts: [{ text: 'Terjemahkan ke ' + (to || 'English') + '. Hanya hasil:\n\n' + text }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 1500 } };
    const r = await geminiHttp.post('/models/gemini-flash-latest:generateContent?key=' + GEMINI_KEY, body);
    if (r.status !== 200) throw new Error(r.data?.error?.message || 'Gagal');
    const t = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    ok(res, { original: text, translated: (t || '').trim(), target: to || 'English', source: 'gemini' });
  } catch (e) { fail(res, 'TRANSLATE_FAILED', e.message, 500); }
});

app.post('/api/ai/summarize', async (req, res) => {
  const { text, lang } = req.body || {};
  if (!text) return fail(res, 'NO_TEXT', 'Teks wajib.');
  if (text.length > 8000) return fail(res, 'TOO_LONG', 'Maks 8000 karakter.');
  try {
    const body = { contents: [{ role: 'user', parts: [{ text: 'Ringkas jadi poin penting dalam Bahasa ' + (lang === 'en' ? 'Inggris' : 'Indonesia') + ':\n\n' + text }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 1200 } };
    const r = await geminiHttp.post('/models/gemini-flash-latest:generateContent?key=' + GEMINI_KEY, body);
    if (r.status !== 200) throw new Error(r.data?.error?.message || 'Gagal');
    const t = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    ok(res, { original_length: text.length, summary: (t || '').trim(), source: 'gemini' });
  } catch (e) { fail(res, 'SUMMARIZE_FAILED', e.message, 500); }
});

// ============================================================
// OSINT
// ============================================================
app.get('/api/osint/dns/:domain', async (req, res) => {
  const d = req.params.domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return fail(res, 'BAD_DOMAIN', 'Domain tidak valid.');
  const ck = 'dns:' + d;
  const hit = cGet(ck); if (hit) return ok(res, hit);
  try {
    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'];
    const out = {};
    await Promise.all(types.map(async t => {
      const r = await publicHttp.get('https://dns.google/resolve?name=' + encodeURIComponent(d) + '&type=' + t);
      out[t] = (r.data?.Answer || []).map(a => a.data);
    }));
    const payload = { domain: d, records: out };
    cSet(ck, payload); ok(res, payload);
  } catch (e) { fail(res, 'DNS_FAILED', 'Gagal ambil DNS.', 500); }
});

app.get('/api/osint/whois/:domain', async (req, res) => {
  const d = req.params.domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return fail(res, 'BAD_DOMAIN', 'Domain tidak valid.');
  try {
    const r = await publicHttp.get('https://rdap.org/domain/' + encodeURIComponent(d));
    if (r.status !== 200) return ok(res, { domain: d, available: true, note: 'Domain belum terdaftar.' });
    const ev = r.data.events || [];
    const find = a => ev.find(e => e.eventAction === a)?.eventDate || null;
    ok(res, { domain: d, registrar: r.data.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || null, created: find('registration'), expires: find('expiration'), updated: find('last changed'), status: r.data.status || [], nameservers: (r.data.nameservers || []).map(n => n.ldhName) });
  } catch (e) { fail(res, 'WHOIS_FAILED', 'Gagal ambil WHOIS.', 500); }
});

app.get('/api/osint/ip/:ip', async (req, res) => {
  try {
    const r = await publicHttp.get('http://ip-api.com/json/' + encodeURIComponent(req.params.ip.trim()) + '?fields=status,country,countryCode,regionName,city,isp,org,as,query,timezone,lat,lon');
    if (r.data?.status !== 'success') return fail(res, 'IP_FAILED', 'IP tidak ditemukan.', 404);
    ok(res, r.data);
  } catch (e) { fail(res, 'IP_FAILED', 'Gagal cek IP.', 500); }
});

async function checkUrl(url, timeout = 6000) {
  try { const r = await axios.head(url, { timeout, validateStatus: () => true, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' } }); return r.status >= 200 && r.status < 400; } catch (e) { return false; }
}

app.post('/api/osint/social', async (req, res) => {
  const username = ((req.body && req.body.username) || '').trim().toLowerCase().replace(/^@/, '');
  if (!username) return fail(res, 'NO_USERNAME', 'Masukkan username.');
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) return fail(res, 'BAD_USERNAME', 'Username tidak valid.');
  const ck = 'social:' + username;
  const hit = cGet(ck); if (hit) return ok(res, hit);
  const platforms = [
    { name: 'GitHub', url: 'https://github.com/' + username, api: 'https://api.github.com/users/' + username },
    { name: 'Instagram', url: 'https://instagram.com/' + username },
    { name: 'Twitter/X', url: 'https://x.com/' + username },
    { name: 'TikTok', url: 'https://tiktok.com/@' + username },
    { name: 'Facebook', url: 'https://facebook.com/' + username },
    { name: 'LinkedIn', url: 'https://linkedin.com/in/' + username },
    { name: 'Reddit', url: 'https://reddit.com/user/' + username, api: 'https://www.reddit.com/user/' + username + '/about.json' },
    { name: 'Pinterest', url: 'https://pinterest.com/' + username },
    { name: 'Telegram', url: 'https://t.me/' + username },
    { name: 'YouTube', url: 'https://youtube.com/@' + username },
    { name: 'Twitch', url: 'https://twitch.tv/' + username },
    { name: 'Medium', url: 'https://medium.com/@' + username },
    { name: 'Steam', url: 'https://steamcommunity.com/id/' + username },
    { name: 'Snapchat', url: 'https://snapchat.com/add/' + username },
    { name: 'Patreon', url: 'https://patreon.com/' + username },
    { name: 'SoundCloud', url: 'https://soundcloud.com/' + username }
  ];
  const results = await Promise.all(platforms.map(async (plt) => {
    let exists = false, extra = null;
    if (plt.api && plt.name === 'GitHub') {
      try { const r = await publicHttp.get(plt.api, { headers: { 'User-Agent': 'ORACLE/2' } }); if (r.status === 200 && r.data && r.data.login) { exists = true; extra = { nama: r.data.name || '', bio: r.data.bio || '', lokasi: r.data.location || '', repo: r.data.public_repos || 0, followers: r.data.followers || 0 }; } } catch (e) {}
    } else if (plt.api && plt.name === 'Reddit') {
      try { const r = await publicHttp.get(plt.api, { headers: { 'User-Agent': 'ORACLE/2' } }); if (r.status === 200 && r.data && r.data.data && !r.data.data.is_suspended) { exists = true; extra = { karma: (r.data.data.link_karma || 0) + (r.data.data.comment_karma || 0) }; } } catch (e) {}
    } else { exists = await checkUrl(plt.url); }
    return { name: plt.name, url: plt.url, exists, extra };
  }));
  const found = results.filter(r => r.exists);
  const out = { username, total_checked: results.length, total_found: found.length, results, found, timestamp: new Date().toISOString(), note: 'Hasil bisa false positive/negative.' };
  cSet(ck, out); ok(res, out);
});

// ============================================================
// PHISHING
// ============================================================
const SUS_TLDS = ['.xyz','.top','.tk','.ml','.ga','.cf','.gq','.click','.work','.link','.review'];
const BRANDS = ['google','facebook','whatsapp','instagram','tokopedia','shopee','bca','bri','bni','mandiri','gopay','ovo','dana','paypal','netflix','tiktok','youtube'];
const PHISH_KW = ['login','signin','verify','verifikasi','account','akun','update','secure','confirm','reset','password','konfirmasi','hadiah','menang','bonus','promo','gratis','claim','wallet'];

function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1;
  return dp[m][n];
}

app.post('/api/security/phishing', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) return fail(res, 'NO_URL', 'URL wajib.');
  let p;
  try { p = new URL(url.startsWith('http') ? url : 'http://' + url); } catch { return fail(res, 'BAD_URL', 'URL tidak valid.'); }
  const host = p.hostname.toLowerCase(), full = p.href;
  const findings = [], positives = [], recommendations = [];
  let score = 0;
  if (p.protocol !== 'https:') { findings.push('Tidak pakai HTTPS.'); score += 15; } else positives.push('Pakai HTTPS');
  const tld = '.' + host.split('.').slice(-1)[0];
  if (SUS_TLDS.includes(tld)) { findings.push('TLD ' + tld + ' sering dipakai penipu.'); score += 25; }
  if (full.length > 100) { findings.push('URL terlalu panjang.'); score += 10; }
  const parts = host.split('.');
  if (parts.length > 4) { findings.push('Subdomain berlebihan.'); score += 15; }
  if ((host.match(/-/g) || []).length >= 2) { findings.push('Banyak tanda strip.'); score += 15; }
  const base = parts.slice(0, -1).join('.');
  for (const b of BRANDS) {
    if (base === b) continue;
    const d = lev(base.replace(/-/g, ''), b);
    if (d > 0 && d <= 2 && base.length >= 4) { findings.push('Mirip brand "' + b + '".'); score += 35; break; }
    if (base.includes(b) && base !== b) { findings.push('Nyamar jadi "' + b + '".'); score += 30; break; }
  }
  const hay = (host + p.pathname + p.search).toLowerCase();
  const kw = PHISH_KW.filter(k => hay.includes(k));
  if (kw.length >= 2) { findings.push('Kata pancingan: ' + kw.slice(0, 4).join(', ')); score += 15; }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) { findings.push('Pakai IP langsung.'); score += 25; }
  if (full.includes('@') && p.username) { findings.push('Karakter @ di URL.'); score += 30; }
  score = Math.min(100, score);
  let level, verdict, color;
  if (score >= 70) { level = 'BAHAYA TINGGI'; verdict = 'Jangan dibuka. Kemungkinan phishing.'; color = 'danger'; }
  else if (score >= 45) { level = 'MENCURIGAKAN'; verdict = 'Hati-hati, ada ciri phishing.'; color = 'warn'; }
  else if (score >= 20) { level = 'HATI-HATI'; verdict = 'Ada hal mencurigakan.'; color = 'warn'; }
  else { level = 'KEMUNGKINAN AMAN'; verdict = 'Tidak ada ciri phishing.'; color = 'ok'; }
  recommendations.push('Periksa URL huruf per huruf.');
  recommendations.push('Bank tidak minta password lewat link.');
  recommendations.push('Aktifkan 2FA.');
  ok(res, { url: full, hostname: host, score, trustScore: 100 - score, level, verdict, color, findings, positives, recommendations, timestamp: new Date().toISOString() });
});

app.get('/api/security/email-breach/:email', async (req, res) => {
  const email = req.params.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'BAD_EMAIL', 'Format email tidak valid.');
  const domain = email.split('@')[1];
  let mxOk = false;
  try { const r = await publicHttp.get('https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=MX'); mxOk = (r.data?.Answer || []).length > 0; } catch (e) {}
  ok(res, { email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), domain, formatValid: true, mxValid: mxOk, message: 'Cek kebocoran lengkap di HIBP.', hibpUrl: 'https://haveibeenpwned.com/account/' + encodeURIComponent(email), recommendations: ['Jangan pakai password sama.', 'Aktifkan 2FA.', 'Pakai password manager.', 'Ganti password rutin 6 bulan.'] });
});

// ============================================================
// TOOLS
// ============================================================
const MORSE_MAP = { 'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---','K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.','Q':'--.-','R':'.-.','S':'...','T':'-','U':'..-','V':'...-','W':'.--','X':'-..-','Y':'-.--','Z':'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.','.':'.-.-.-',',':'--..--','?':'..--..',"'":'.----.','!':'-.-.--','/':'-..-.','(':'-.--.',')':'-.--.-',':':'---...',';':'-.-.-.','=':'-...-','+':'.-.-.','-':'-....-','_':'..--.-','"':'.-..-.','$':'...-..-','@':'.--.-.' };
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));
function textToMorse(t) { return t.toUpperCase().split('').map(c => c === ' ' ? '/' : (MORSE_MAP[c] || '?')).join(' '); }
function morseToText(m) { return m.trim().split(/\s*\/\s*|\s{3,}/).map(w => w.split(/\s+/).map(c => MORSE_REVERSE[c] || '?').join('')).join(' '); }

app.post('/api/tools/morse', async (req, res) => {
  const { text, mode } = req.body || {};
  if (!text) return fail(res, 'NO_TEXT', 'Teks wajib.');
  if (text.length > 2000) return fail(res, 'TOO_LONG', 'Maks 2000 karakter.');
  if (mode === 'morse2text') ok(res, { input: text, output: morseToText(text), mode: 'morse2text' });
  else ok(res, { input: text, output: textToMorse(text), mode: 'text2morse' });
});

app.post('/api/tools/password', async (req, res) => {
  const len = Math.min(Math.max(parseInt(req.body?.length) || 16, 8), 128);
  let charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
  let pwd = '';
  for (let i = 0; i < len; i++) pwd += charset[crypto.randomInt(0, charset.length)];
  const score = Math.min(10, (len >= 16 ? 4 : len >= 12 ? 3 : 1) + 3);
  ok(res, { password: pwd, length: len, strength: score >= 7 ? 'strong' : score >= 4 ? 'medium' : 'weak', score });
});

app.get('/api/tools/qr', async (req, res) => {
  const text = (req.query.text || '').trim();
  const size = Math.min(Math.max(parseInt(req.query.size) || 300, 100), 1000);
  if (!text) return fail(res, 'NO_TEXT', 'Teks wajib.');
  if (text.length > 1000) return fail(res, 'TOO_LONG', 'Maks 1000 karakter.');
  ok(res, { text, size, qrUrl: 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(text) + '&size=' + size + 'x' + size + '&margin=10&format=png' });
});

app.post('/api/tools/urlshort', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) return fail(res, 'NO_URL', 'URL wajib.');
  if (!/^https?:\/\//i.test(url)) return fail(res, 'BAD_URL', 'URL harus http:// atau https://');
  try {
    const r = await publicHttp.get('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url));
    if (r.status !== 200 || typeof r.data !== 'string') throw new Error('Gagal');
    const short = r.data.trim();
    if (!short.startsWith('http')) throw new Error('Format tidak valid');
    ok(res, { original: url, short });
  } catch (e) { fail(res, 'SHORT_FAILED', 'Gagal pendekin URL.', 500); }
});

// ============================================================
// LOOKUP — Cuaca, Kurs, Sholat
// ============================================================
const WEATHER_CODES = { 0:'Cerah', 1:'Cerah Berawan', 2:'Berawan', 3:'Mendung', 45:'Berkabut', 48:'Kabut Beku', 51:'Gerimis Ringan', 53:'Gerimis', 55:'Gerimis Lebat', 61:'Hujan Ringan', 63:'Hujan', 65:'Hujan Lebat', 71:'Salju Ringan', 73:'Salju', 75:'Salju Lebat', 80:'Hujan Lokal', 81:'Hujan Sedang', 82:'Hujan Deras', 95:'Badai Petir', 96:'Badai + Hujan Es', 99:'Badai Ekstrem' };

app.get('/api/lookup/weather', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return fail(res, 'NO_QUERY', 'Masukkan nama kota.');
  try {
    let lokasi = null, lat, lon;
    const geoR = await publicHttp.get('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=1&language=id&format=json');
    if (geoR.data && geoR.data.results && geoR.data.results.length) {
      const loc = geoR.data.results[0];
      lat = loc.latitude; lon = loc.longitude;
      lokasi = { nama: loc.name, negara: loc.country || '', provinsi: loc.admin1 || '', lat, lon };
    }
    if (!lokasi && TOMTOM_KEY) {
      try {
        const ttR = await tomtom('/search/2/geocode/' + encodeURIComponent(q) + '.json', { limit: 1, language: 'id-ID' });
        if (ttR.results && ttR.results.length) {
          const top = ttR.results[0];
          lat = top.position.lat; lon = top.position.lon;
          lokasi = { nama: top.address?.freeformAddress || q, negara: top.address?.country || '', provinsi: top.address?.countrySubdivision || '', lat, lon };
        }
      } catch (e) {}
    }
    if (!lokasi) return fail(res, 'NOT_FOUND', 'Lokasi "' + q + '" tidak ditemukan.', 404);
    const wR = await publicHttp.get('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3');
    if (!wR.data || !wR.data.current) return fail(res, 'WEATHER_FAILED', 'Cuaca tidak tersedia.', 503);
    const c = wR.data.current, d = wR.data.daily;
    ok(res, { query: q, lokasi, sekarang: { suhu: c.temperature_2m, terasa: c.apparent_temperature, kelembapan: c.relative_humidity_2m, hujan: c.precipitation, angin: c.wind_speed_10m, kondisi: WEATHER_CODES[c.weather_code] || '-' }, forecast: (d.time || []).map((t, i) => ({ tanggal: t, max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i], kondisi: WEATHER_CODES[d.weather_code?.[i]] || '-' })), timestamp: new Date().toISOString(), source: 'Open-Meteo' });
  } catch (e) { fail(res, 'WEATHER_FAILED', 'Layanan cuaca error.', 500); }
});

app.get('/api/lookup/currency', async (req, res) => {
  const from = (req.query.from || 'USD').toUpperCase(), to = (req.query.to || 'IDR').toUpperCase();
  const amount = parseFloat(req.query.amount) || 1;
  try {
    const r = await publicHttp.get('https://api.frankfurter.app/latest?from=' + from + '&to=' + to);
    if (r.status !== 200 || !r.data?.rates?.[to]) return fail(res, 'CURRENCY_FAILED', 'Mata uang tidak didukung.', 404);
    const rate = r.data.rates[to];
    ok(res, { from, to, rate, date: r.data.date, amount, converted: Math.round(rate * amount * 100) / 100, source: 'Frankfurter' });
  } catch (e) { fail(res, 'CURRENCY_FAILED', 'Gagal ambil kurs.', 500); }
});

app.get('/api/lookup/prayer', async (req, res) => {
  const q = (req.query.q || '').trim();
  const method = (req.query.method || 'auto').toString();
  if (!q) return fail(res, 'NO_QUERY', 'Masukkan nama kota.');
  try {
    let lokasi = null, lat, lon, isIndonesia = false;
    const geoR = await publicHttp.get('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=1&language=id&format=json');
    if (geoR.data && geoR.data.results && geoR.data.results.length) {
      const loc = geoR.data.results[0];
      lat = loc.latitude; lon = loc.longitude;
      isIndonesia = (loc.country_code || '').toUpperCase() === 'ID';
      lokasi = { nama: loc.name, negara: loc.country || '', lat, lon };
    }
    if (!lokasi && TOMTOM_KEY) {
      try {
        const ttR = await tomtom('/search/2/geocode/' + encodeURIComponent(q) + '.json', { limit: 1, language: 'id-ID' });
        if (ttR.results && ttR.results.length) {
          const top = ttR.results[0];
          lat = top.position.lat; lon = top.position.lon;
          isIndonesia = (top.address?.countryCode || '').toUpperCase() === 'ID';
          lokasi = { nama: top.address?.freeformAddress || q, negara: top.address?.country || '', lat, lon };
        }
      } catch (e) {}
    }
    if (!lokasi) return fail(res, 'NOT_FOUND', 'Lokasi tidak ditemukan.', 404);
    let methodId = 3, methodName = 'Muslim World League';
    if (method === 'auto' && isIndonesia) { methodId = 11; methodName = 'Kemenag Indonesia'; }
    else if (method === 'kemenag') { methodId = 11; methodName = 'Kemenag Indonesia'; }
    else if (method === 'makkah') { methodId = 4; methodName = 'Umm al-Qura'; }
    else if (method === 'singapore') { methodId = 18; methodName = 'MUIS Singapore'; }
    else if (method === 'malaysia') { methodId = 17; methodName = 'JAKIM Malaysia'; }
    const today = new Date();
    const dateStr = today.getDate().toString().padStart(2, '0') + '-' + (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getFullYear();
    const pR = await publicHttp.get('https://api.aladhan.com/v1/timings/' + dateStr + '?latitude=' + lat + '&longitude=' + lon + '&method=' + methodId);
    if (pR.status !== 200 || !pR.data?.data?.timings) return fail(res, 'PRAYER_FAILED', 'Layanan sholat tidak tersedia.', 503);
    const t = pR.data.data.timings;
    ok(res, { query: q, lokasi, jadwal: { imsak: t.Imsak, subuh: t.Fajr, syuruq: t.Sunrise, dzuhur: t.Dhuhr, ashar: t.Asr, maghrib: t.Maghrib, isya: t.Isha }, metode: { id: methodId, nama: methodName }, tanggal: pR.data.data.date?.readable || dateStr, source: 'Aladhan' });
  } catch (e) { fail(res, 'PRAYER_FAILED', 'Layanan sholat error.', 500); }
});

// ============================================================
// HISTORY
// ============================================================
app.get('/api/history', (req, res) => { const h = readHistory(); ok(res, { count: h.length, items: h }); });
app.post('/api/history', (req, res) => {
  const item = req.body?.item;
  if (!item) return fail(res, 'NO_ITEM', 'Data kosong.');
  const h = readHistory();
  h.unshift({ ...item, id: Date.now(), date: new Date().toISOString() });
  writeHistory(h);
  ok(res, { saved: true });
});
app.delete('/api/history/:id', (req, res) => {
  const id = parseInt(req.params.id);
  writeHistory(readHistory().filter(h => h.id !== id));
  ok(res, { deleted: true });
});

// ============================================================
// 404 + ERROR + START
// ============================================================
app.use('/api', (req, res) => fail(res, 'NOT_FOUND', 'Endpoint tidak ditemukan.', 404));
app.use((err, req, res, next) => {
  console.error('[UNCAUGHT]', err.message);
  if (res.headersSent) return next(err);
  fail(res, 'INTERNAL', 'Terjadi kesalahan server.', 500);
});

ensureDataDir();

app.listen(PORT, () => {
  console.log('===========================================');
  console.log('ORACLE v' + VERSION + ' — Server aktif');
  console.log('URL: http://localhost:' + PORT);
  console.log('TomTom: ' + (TOMTOM_KEY ? 'OK' : 'BELUM DIISI'));
  console.log('Gemini: ' + (GEMINI_KEY ? 'OK' : 'BELUM DIISI'));
  console.log('===========================================');
});
