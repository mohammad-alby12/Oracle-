/* ============================================================
   ORACLE v16.0.0 — Frontend Logic
   ============================================================ */

// ============ LOADER ============
(function initLoader() {
  const LOADER_STEPS = ['Menyiapkan sistem...', 'Menghubungkan layanan...', 'Memuat antarmuka...', 'Siap digunakan'];
  let idx = 0;

  function updateStep() {
    const el = document.getElementById('loader-step');
    if (el && idx < LOADER_STEPS.length) el.textContent = LOADER_STEPS[idx];
    idx++;
  }

  // Update step tiap 400ms
  const stepTimer = setInterval(updateStep, 400);
  updateStep();

  // Force hide loader setelah 3 detik
  function hideLoader() {
    const l = document.getElementById('loader');
    if (l) l.classList.add('hide');
    clearInterval(stepTimer);
  }

  // Coba beberapa strategi hide
  if (document.readyState === 'complete') {
    setTimeout(hideLoader, 2400);
  } else {
    window.addEventListener('load', () => setTimeout(hideLoader, 2000));
    // FALLBACK: kalau load event gak fire dalam 4 detik, force hide
    setTimeout(hideLoader, 4000);
  }
})();

// ============ STATE ============
const state = {
  theme: localStorage.getItem('oracle-theme') || 'dark',
  lastTraffic: null,
  lastLocation: null,
  chat: [],
  morseMode: 'text2morse',
  map: null,
  markers: [],
  recording: false
};

// ============ HELPERS ============
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return await r.json();
  } catch (e) {
    return { success: false, error: { message: 'Server lagi ngambek nih, coba lagi bentar' } };
  }
}

function toast(msg, type = 'ok', ms = 2500) {
  const wrap = $('toast-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-16px)';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Udah gue salin!', 'ok', 1500), () => toast('Gagal salin', 'err', 1500));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Udah gue salin!', 'ok', 1500); }
    catch { toast('Gagal salin', 'err', 1500); }
    ta.remove();
  }
}

// ============ THEME ============
function applyTheme() { document.documentElement.setAttribute('data-theme', state.theme); }
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('oracle-theme', state.theme);
  applyTheme();
  toast(state.theme === 'light' ? 'Tema terang aktif' : 'Tema gelap aktif', 'ok', 1500);
}

// ============ TABS ============
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'traffic' && state.map) setTimeout(() => state.map.invalidateSize(), 200);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ============ HEALTH ============
async function checkHealth() {
  const r = await api('/api/health');
  if (!r.success) {
    $('st-server').textContent = 'X';
    $('st-server').className = 'pill err';
    return;
  }
  const d = r.data;
  $('st-server').textContent = 'OK';
  $('st-server').className = 'pill ok';
  $('st-tomtom').textContent = d.tomtom ? 'OK' : 'X';
  $('st-tomtom').className = 'pill ' + (d.tomtom ? 'ok' : 'err');
  $('st-gemini').textContent = d.gemini ? 'OK' : 'X';
  $('st-gemini').className = 'pill ' + (d.gemini ? 'ok' : 'err');
  $('st-model').textContent = d.model || '-';
  $('st-uptime').textContent = Math.round(d.uptime) + 's';
  if ($('ver-label')) $('ver-label').textContent = 'v' + d.version;
}

// ============ DAILY TIP ============
const TIPS = [
  'Jangan pernah klik link dari nomor yang gak dikenal.',
  'Password kuat minimal 12 karakter, campur huruf, angka, simbol.',
  'Aktifin 2FA di semua akun penting — bank, email, sosmed.',
  'Cek dulu link sebelum klik — pakai fitur Anti-Phising di sini.',
  'Jangan transfer ke rekening pribadi tanpa verifikasi.',
  'Screenshot semua percakapan penting, buat bukti kalau ada masalah.',
  'Kalau ada yang menang undian tanpa ikut, itu pasti penipuan.',
  'Update HP & aplikasi rutin, buat nutup celah keamanan.',
  'Jangan kasih kode OTP ke siapapun — termasuk yang ngaku bank.',
  'Waspada link yang mirip brand (g00gle, t0kopedia) — itu phishing.'
];
function loadDailyTip() {
  const day = new Date().getDate();
  const tip = TIPS[day % TIPS.length];
  const el = $('daily-tip');
  if (el) el.textContent = tip;
}

// ============ TRAFFIC ============
async function doGeocode() {
  const q = $('geo-input').value.trim();
  if (!q) return toast('Isi dulu nama tempatnya bro', 'warn');
  $('geo-results').innerHTML = '<div class="geo-item"><div class="geo-item-title">Mencari...</div></div>';
  const r = await api('/api/traffic/geocode?q=' + encodeURIComponent(q));
  if (!r.success) {
    $('geo-results').innerHTML = '<div class="result-box empty">' + esc(r.error.message) + '</div>';
    return;
  }
  if (!r.data.results.length) {
    $('geo-results').innerHTML = '<div class="result-box empty">Tempatnya gak ketemu, coba yang lebih spesifik.</div>';
    return;
  }
  $('geo-results').innerHTML = r.data.results.map((item, i) =>
    '<div class="geo-item" onclick="selectLocation(' + i + ')">' +
    '<div class="geo-item-title">' + esc(item.address || item.city) + '</div>' +
    '<div class="geo-item-sub">' + esc(item.city || '-') + ' · ' + esc(item.country || '-') + '</div>' +
    '</div>'
  ).join('');
  window._geoResults = r.data.results;
}
function quickGeo(q) { $('geo-input').value = q; doGeocode(); }

async function selectLocation(i) {
  const loc = window._geoResults[i];
  if (!loc) return;
  state.lastLocation = loc;
  $('geo-results').innerHTML = '';
  $('geo-input').value = loc.address || loc.city;
  $('traffic-detail').style.display = 'block';

  const f = await api('/api/traffic/flow?lat=' + loc.lat + '&lon=' + loc.lon);
  if (f.success) {
    state.lastTraffic = f.data;
    const d = f.data;
    const color = d.color === 'ok' ? 'var(--ok)' : d.color === 'warn' ? 'var(--warn)' : 'var(--danger)';
    $('traffic-info').innerHTML =
      '<div class="ti-cell"><div class="ti-label">Lokasi</div><div class="ti-value" style="font-size:14px">' + esc(loc.address || loc.city) + '</div></div>' +
      '<div class="ti-cell"><div class="ti-label">Status</div><div class="ti-value" style="color:' + color + ';font-size:16px">' + esc(d.status) + '</div></div>' +
      '<div class="ti-cell"><div class="ti-label">Kecepatan</div><div class="ti-value">' + d.currentSpeed + '<span style="font-size:11px;color:var(--muted)"> km/h</span></div></div>' +
      '<div class="ti-cell"><div class="ti-label">Normal</div><div class="ti-value">' + d.freeFlowSpeed + '<span style="font-size:11px;color:var(--muted)"> km/h</span></div></div>' +
      '<div class="ti-cell"><div class="ti-label">Rasio</div><div class="ti-value">' + d.ratioPercent + '%</div></div>';
    toast(d.pesan || 'Data siap', d.color === 'ok' ? 'ok' : 'warn', 2000);
  } else {
    $('traffic-info').innerHTML = '<div class="ti-cell"><div class="ti-label">Info</div><div class="ti-value" style="font-size:13px;color:var(--danger)">Gak ada data macet di sini</div></div>';
  }

  renderMap(loc.lat, loc.lon);
  loadIncidents(loc.lat, loc.lon);
  api('/api/history', { method: 'POST', body: JSON.stringify({ item: { type: 'macet', title: loc.address || loc.city } }) });
}

function renderMap(lat, lon) {
  if (!window.L) return;
  if (!state.map) {
    state.map = L.map('map').setView([lat, lon], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 19 }).addTo(state.map);
  } else {
    state.map.setView([lat, lon], 15);
  }
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];
  const mk = L.marker([lat, lon]).addTo(state.map).bindPopup('Lokasi ini').openPopup();
  state.markers.push(mk);
  setTimeout(() => state.map.invalidateSize(), 200);
}

async function loadIncidents(lat, lon) {
  const r = await api('/api/traffic/incidents?lat=' + lat + '&lon=' + lon);
  if (!r.success || !r.data.incidents.length) { $('incidents').innerHTML = ''; return; }
  $('incidents').innerHTML = '<div style="font-family:Pixelify Sans,monospace;font-size:12px;margin-bottom:8px">Info Insiden (' + r.data.count + ')</div>' +
    r.data.incidents.slice(0, 5).map(i => '<div class="finding bad">' + esc(i.description || 'Insiden jalan') + ' · delay ' + Math.round(i.delaySeconds / 60) + ' menit</div>').join('');
}

async function doRoute() {
  const from = $('route-from').value.trim();
  const to = $('route-to').value.trim();
  if (!from || !to) return toast('Isi dulu dari mana ke mana', 'warn');
  $('route-result').innerHTML = '<div class="result-box empty">Ngitung rute...</div>';

  const [g1, g2] = await Promise.all([
    api('/api/traffic/geocode?q=' + encodeURIComponent(from)),
    api('/api/traffic/geocode?q=' + encodeURIComponent(to))
  ]);
  if (!g1.success || !g1.data.results.length || !g2.success || !g2.data.results.length) {
    $('route-result').innerHTML = '<div class="result-box empty">Lokasinya gak ketemu bro</div>';
    return;
  }

  const a = g1.data.results[0], b = g2.data.results[0];
  const r = await api('/api/traffic/route', {
    method: 'POST',
    body: JSON.stringify({ from: { lat: a.lat, lon: a.lon }, to: { lat: b.lat, lon: b.lon } })
  });

  if (!r.success) {
    $('route-result').innerHTML = '<div class="result-box empty">' + esc(r.error.message) + '</div>';
    return;
  }

  $('route-result').innerHTML = r.data.routes.map((route, i) => {
    const s = route.summary;
    return '<div class="result-box" style="margin-bottom:10px">' +
      '<div style="font-family:Pixelify Sans,monospace;font-weight:600;margin-bottom:8px">' + (i === 0 ? 'Rute Utama' : 'Alternatif ' + i) + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div>Jarak: <b>' + s.lengthKm + ' km</b></div>' +
      '<div>Waktu: <b>' + s.travelTimeMinutes + ' menit</b></div>' +
      '<div>Delay: <b>' + s.trafficDelayMinutes + ' menit</b></div>' +
      '<div>Normal: <b>' + Math.round(s.noTrafficTravelTimeSeconds / 60) + ' menit</b></div>' +
      '</div></div>';
  }).join('');

  if (state.map && r.data.routes[0].points.length) {
    const pts = r.data.routes[0].points;
    const poly = L.polyline(pts, { color: '#22d3ee', weight: 4 }).addTo(state.map);
    state.map.fitBounds(poly.getBounds(), { padding: [30, 30] });
  }
  toast('Rute udah jadi bro', 'ok', 2000);
}

// ============ AI CHAT ============
function appendChatMsg(text, role) {
  const box = $('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const avatar = role === 'bot' ? '<svg><use href="#i-spark"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  div.innerHTML = '<div class="msg-avatar">' + avatar + '</div><div class="msg-bubble">' + esc(text) + '</div>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const inp = $('chat-input');
  const msg = inp.value.trim();
  if (!msg) return;
  appendChatMsg(msg, 'user');
  inp.value = '';
  inp.style.height = 'auto';
  state.chat.push({ role: 'user', content: msg });

  const box = $('chat-messages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'msg bot';
  loadingDiv.innerHTML = '<div class="msg-avatar"><svg><use href="#i-spark"/></svg></div><div class="msg-bubble">...</div>';
  box.appendChild(loadingDiv);
  box.scrollTop = box.scrollHeight;

  const context = state.lastTraffic ? { trafficSummary: state.lastTraffic } : null;
  const r = await api('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: msg, history: state.chat.slice(-8), context })
  });

  loadingDiv.remove();
  if (!r.success) { appendChatMsg(r.error?.message || 'AI-nya lagi error bro', 'bot'); return; }
  appendChatMsg(r.data.reply, 'bot');
  state.chat.push({ role: 'assistant', content: r.data.reply });
}

// Voice input
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Browser lu gak support suara bro', 'warn');
  const btn = $('voice-btn');
  if (state.recording) { state.recognition?.stop(); state.recording = false; btn.classList.remove('recording'); return; }
  const rec = new SR();
  rec.lang = 'id-ID';
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = e => { $('chat-input').value = e.results[0][0].transcript; toast('Suara kebaca bro', 'ok', 1500); };
  rec.onend = () => { state.recording = false; btn.classList.remove('recording'); };
  rec.onerror = () => { state.recording = false; btn.classList.remove('recording'); toast('Suara gak kebaca', 'err', 1500); };
  rec.start();
  state.recording = true;
  state.recognition = rec;
  btn.classList.add('recording');
  toast('Ngomong deh...', 'ok', 1500);
}

// ============ OSINT ============
async function doOsint() {
  const t = $('osint-target').value.trim();
  if (!t) return toast('Isi dulu domain atau IP', 'warn');
  $('osint-result').innerHTML = '<div class="result-box empty">Ngambil data...</div>';

  const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t);
  let html = '';

  if (isIp) {
    const ip = await api('/api/osint/ip/' + encodeURIComponent(t));
    if (ip.success) {
      const d = ip.data;
      html += '<div class="finding"><b>IP:</b> ' + esc(d.query) + '</div>';
      html += '<div class="finding"><b>Negara:</b> ' + esc(d.country || '-') + '</div>';
      html += '<div class="finding"><b>Kota:</b> ' + esc(d.city || '-') + '</div>';
      html += '<div class="finding"><b>ISP:</b> ' + esc(d.isp || '-') + '</div>';
      html += '<div class="finding"><b>Org:</b> ' + esc(d.org || '-') + '</div>';
    }
  } else {
    const [dns, whois] = await Promise.all([
      api('/api/osint/dns/' + encodeURIComponent(t)),
      api('/api/osint/whois/' + encodeURIComponent(t))
    ]);
    if (dns.success) {
      html += '<div style="font-family:Pixelify Sans,monospace;font-weight:600;margin:12px 0 8px">DNS Records</div>';
      for (const [type, list] of Object.entries(dns.data.records)) {
        if (list.length) html += '<div class="finding"><b>' + type + '</b>: ' + list.slice(0, 3).map(esc).join(', ') + '</div>';
      }
    }
    if (whois.success && !whois.data.available) {
      html += '<div style="font-family:Pixelify Sans,monospace;font-weight:600;margin:16px 0 8px">WHOIS</div>';
      if (whois.data.registrar) html += '<div class="finding">Registrar: ' + esc(whois.data.registrar) + '</div>';
      if (whois.data.created) html += '<div class="finding">Dibuat: ' + esc(whois.data.created) + '</div>';
      if (whois.data.expires) html += '<div class="finding">Expired: ' + esc(whois.data.expires) + '</div>';
      if (whois.data.nameservers?.length) html += '<div class="finding">Nameservers: ' + whois.data.nameservers.slice(0, 3).map(esc).join(', ') + '</div>';
    }
  }
  $('osint-result').innerHTML = html ? '<div class="result-box">' + html + '</div>' : '<div class="result-box empty">Gak ada data bro.</div>';
}

// ============ PHISHING ============
async function doPhishing() {
  const url = $('phish-url').value.trim();
  if (!url) return toast('Paste dulu linknya bro', 'warn');
  $('phish-result').innerHTML = '<div class="result-box empty">Analisa...</div>';

  const r = await api('/api/security/phishing', { method: 'POST', body: JSON.stringify({ url }) });
  if (!r.success) {
    $('phish-result').innerHTML = '<div class="result-box empty">' + esc(r.error.message) + '</div>';
    return;
  }
  const d = r.data;
  $('phish-result').innerHTML =
    '<div class="result-box">' +
    '<div class="score-big ' + d.color + '">' + d.score + '</div>' +
    '<div class="score-label">Skor Bahaya</div>' +
    '<div class="verdict ' + d.color + '"><b>' + esc(d.level) + '</b><br>' + esc(d.verdict) + '</div>' +
    (d.findings.length ? '<div style="font-family:Pixelify Sans,monospace;font-size:12px;margin:12px 0 6px">TEMUAN</div>' + d.findings.map(f => '<div class="finding bad">' + esc(f) + '</div>').join('') : '') +
    (d.positives.length ? '<div style="font-family:Pixelify Sans,monospace;font-size:12px;margin:12px 0 6px">AMAN</div>' + d.positives.map(f => '<div class="finding good">' + esc(f) + '</div>').join('') : '') +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="copyText(\'Skor: ' + d.score + ' - ' + esc(d.level).replace(/'/g, "\\'") + '\')">Salin Hasil</button>' +
    '</div>';

  api('/api/history', { method: 'POST', body: JSON.stringify({ item: { type: 'phishing', title: d.hostname, score: d.score } }) });
}

// ============ BREACH ============
async function doBreach() {
  const email = $('breach-email').value.trim();
  if (!email) return toast('Isi dulu emailnya', 'warn');
  $('breach-result').innerHTML = '<div class="result-box empty">Mengecek...</div>';
  const r = await api('/api/security/email-breach/' + encodeURIComponent(email));
  if (!r.success) {
    $('breach-result').innerHTML = '<div class="result-box empty">' + esc(r.error.message) + '</div>';
    return;
  }
  const d = r.data;
  $('breach-result').innerHTML =
    '<div class="result-box">' +
    '<div style="font-size:14px;margin-bottom:12px">' + esc(d.message) + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
    '<div>Domain: <b>' + esc(d.domain) + '</b></div>' +
    '<div>MX Valid: <b>' + (d.mxValid ? 'Ya' : 'Gak') + '</b></div>' +
    '</div>' +
    '<a href="' + d.hibpUrl + '" target="_blank" class="btn primary" style="text-decoration:none;width:100%;display:block;text-align:center">Buka HIBP</a>' +
    '<div style="margin-top:14px;font-family:Pixelify Sans,monospace;font-size:12px;margin-bottom:6px">SARAN GUE</div>' +
    d.recommendations.map(r => '<div class="finding good">' + esc(r) + '</div>').join('') +
    '</div>';
}

// ============ TOOLS — MORSE ============
function setMorseMode(mode, el) {
  state.morseMode = mode;
  document.querySelectorAll('.chip').forEach(c => { if (c.parentElement?.previousElementSibling?.id === 'morse-input' || c.onclick?.toString().includes('setMorseMode')) c.classList.remove('active'); });
  el.classList.add('active');
  $('morse-result').className = 'result-box empty';
  $('morse-result').textContent = 'Hasil muncul di sini...';
  $('morse-play-btn').style.display = 'none';
}

async function doMorse() {
  const text = $('morse-input').value.trim();
  if (!text) return toast('Isi dulu teks atau morse-nya', 'warn');
  const r = await api('/api/tools/morse', { method: 'POST', body: JSON.stringify({ text, mode: state.morseMode }) });
  if (!r.success) { $('morse-result').className = 'result-box empty'; $('morse-result').textContent = r.error.message; return; }
  $('morse-result').className = 'result-box';
  $('morse-result').innerHTML = '<div style="font-family:VT323,monospace;font-size:22px;word-break:break-all;line-height:1.6">' + esc(r.data.output) + '</div><button class="btn" style="width:100%;margin-top:10px" onclick="copyText(\'' + esc(r.data.output).replace(/'/g, "\\'") + '\')">Salin Hasil</button>';
  if (r.data.mode === 'text2morse') {
    window._morseOutput = r.data.output;
    $('morse-play-btn').style.display = 'inline-flex';
  } else {
    $('morse-play-btn').style.display = 'none';
  }
}

function playMorse() {
  const morse = window._morseOutput;
  if (!morse) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return toast('HP lu gak support suara bro', 'warn');
  const ctx = new AC();
  const dotLen = 0.1;
  const dashLen = 0.3;
  const gapChar = 0.1;
  const gapLetter = 0.3;
  const gapWord = 0.7;
  let t = 0;
  let totalTime = 0;

  const playBeep = (start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 700;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + 0.01);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur);
  };

  for (let i = 0; i < morse.length; i++) {
    const c = morse[i];
    if (c === '.') { playBeep(t, dotLen); t += dotLen + gapChar; }
    else if (c === '-') { playBeep(t, dashLen); t += dashLen + gapChar; }
    else if (c === ' ') {
      if (morse[i + 1] === '/') { t += gapWord; i++; }
      else { t += gapLetter; }
    }
  }
  totalTime = t;
  toast('Nih suara morse-nya...', 'ok', 1500);
  setTimeout(() => ctx.close(), (totalTime + 1) * 1000);
}

// ============ TOOLS — PASSWORD ============
async function doPassword() {
  const len = parseInt($('pwd-len').value);
  const body = { length: len, upper: $('pwd-upper').checked, lower: $('pwd-lower').checked, number: $('pwd-number').checked, symbol: $('pwd-symbol').checked };
  const r = await api('/api/tools/password', { method: 'POST', body: JSON.stringify(body) });
  if (!r.success) { $('pwd-result').className = 'result-box empty'; $('pwd-result').textContent = r.error.message; return; }
  const d = r.data;
  const color = d.strength === 'strong' ? 'var(--ok)' : d.strength === 'medium' ? 'var(--warn)' : 'var(--danger)';
  $('pwd-result').className = 'result-box';
  $('pwd-result').innerHTML = '<div style="font-family:VT323,monospace;font-size:20px;word-break:break-all;line-height:1.6;padding:12px;background:rgba(0,0,0,.2);border-radius:8px">' + esc(d.password) + '</div>' +
    '<div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center"><span>Kekuatan: <b style="color:' + color + '">' + d.strength.toUpperCase() + '</b></span><span style="font-family:VT323,monospace">' + d.score + '/10</span></div>' +
    '<button class="btn" style="width:100%;margin-top:10px" onclick="copyText(\'' + esc(d.password) + '\')">Salin Password</button>';
}

// ============ TOOLS — QR ============
async function doQR() {
  const text = $('qr-input').value.trim();
  if (!text) return toast('Isi dulu teksnya', 'warn');
  const r = await api('/api/tools/qr?text=' + encodeURIComponent(text));
  if (!r.success) { $('qr-result').className = 'result-box empty'; $('qr-result').textContent = r.error.message; return; }
  $('qr-result').className = 'result-box';
  $('qr-result').innerHTML = '<img src="' + r.data.qrUrl + '" alt="QR" style="width:100%;max-width:300px;display:block;margin:0 auto;border-radius:10px;background:#fff;padding:10px"><a href="' + r.data.qrUrl + '" target="_blank" class="btn" style="width:100%;margin-top:10px;text-decoration:none;display:block;text-align:center">Buka Gambar</a>';
}

// ============ TOOLS — URL SHORT ============
async function doShort() {
  const url = $('short-input').value.trim();
  if (!url) return toast('Paste dulu linknya', 'warn');
  const r = await api('/api/tools/urlshort', { method: 'POST', body: JSON.stringify({ url }) });
  if (!r.success) { $('short-result').className = 'result-box empty'; $('short-result').textContent = r.error.message; return; }
  $('short-result').className = 'result-box';
  $('short-result').innerHTML = '<div style="font-size:13px;margin-bottom:6px;color:var(--muted)">Link pendek:</div>' +
    '<div style="font-family:VT323,monospace;font-size:20px;word-break:break-all;color:var(--cyan)">' + esc(r.data.short) + '</div>' +
    '<button class="btn" style="width:100%;margin-top:10px" onclick="copyText(\'' + esc(r.data.short) + '\')">Salin</button>';
}

// ============ TOOLS — TRANSLATE ============
async function doTranslate() {
  const text = $('trans-text').value.trim();
  const to = $('trans-to').value;
  if (!text) return toast('Isi dulu teksnya', 'warn');
  $('trans-result').className = 'result-box empty';
  $('trans-result').textContent = 'Nerjemahin...';
  const r = await api('/api/ai/translate', { method: 'POST', body: JSON.stringify({ text, to }) });
  if (!r.success) { $('trans-result').className = 'result-box empty'; $('trans-result').textContent = r.error.message; return; }
  $('trans-result').className = 'result-box';
  $('trans-result').innerHTML = '<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Asli</div><div style="font-size:13px;color:var(--muted)">' + esc(text) + '</div></div>' +
    '<div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">' + esc(to) + '</div><div style="font-size:14px">' + esc(r.data.translated) + '</div></div>' +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="copyText(\'' + esc(r.data.translated).replace(/'/g, "\\'") + '\')">Salin</button>';
}

// ============ TOOLS — SUMMARIZE ============
async function doSummarize() {
  const text = $('sum-text').value.trim();
  if (!text) return toast('Paste dulu teksnya', 'warn');
  if (text.length < 100) return toast('Teksnya kekecilan, minimal 100 huruf', 'warn');
  $('sum-result').className = 'result-box empty';
  $('sum-result').textContent = 'Ngeringkas...';
  const r = await api('/api/ai/summarize', { method: 'POST', body: JSON.stringify({ text }) });
  if (!r.success) { $('sum-result').className = 'result-box empty'; $('sum-result').textContent = r.error.message; return; }
  $('sum-result').className = 'result-box';
  $('sum-result').innerHTML = '<div style="white-space:pre-wrap;line-height:1.6">' + esc(r.data.summary) + '</div>' +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="copyText(\'' + esc(r.data.summary).replace(/'/g, "\\'").replace(/\n/g, '\\n') + '\')">Salin</button>';
}

// ============ LOOKUP — WEATHER ============
async function doWeather() {
  const q = $('weather-input').value.trim();
  if (!q) return toast('Ketik dulu nama kotanya', 'warn');
  $('weather-result').className = 'result-box empty';
  $('weather-result').textContent = 'Cek cuaca...';
  const r = await api('/api/lookup/weather?q=' + encodeURIComponent(q));
  if (!r.success) { $('weather-result').className = 'result-box empty'; $('weather-result').textContent = r.error.message; return; }
  const d = r.data;
  $('weather-result').className = 'result-box';
  $('weather-result').innerHTML =
    '<div style="margin-bottom:12px"><div style="font-size:14px;font-weight:600">' + esc(d.lokasi.nama) + ', ' + esc(d.lokasi.negara) + '</div>' +
    '<div style="font-size:11px;color:var(--muted);font-family:VT323,monospace">' + esc(d.lokasi.provinsi || '') + '</div></div>' +
    '<div class="score-big" style="color:var(--cyan)">' + d.sekarang.suhu + '°C</div>' +
    '<div class="score-label">' + esc(d.sekarang.kondisi) + '</div>' +
    '<div class="traffic-info">' +
    '<div class="ti-cell"><div class="ti-label">Terasa</div><div class="ti-value">' + d.sekarang.terasa + '°</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Lembap</div><div class="ti-value">' + d.sekarang.kelembapan + '%</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Angin</div><div class="ti-value">' + d.sekarang.angin + '</div></div>' +
    '</div>' +
    '<div style="font-family:Pixelify Sans,monospace;font-size:12px;margin:14px 0 8px">3 HARI KE DEPAN</div>' +
    d.forecast.map(f => '<div class="finding"><b>' + f.tanggal + '</b> · ' + f.kondisi + ' · ' + f.min + '° - ' + f.max + '°C</div>').join('');
}
function quickWeather(q) { $('weather-input').value = q; doWeather(); }

// ============ LOOKUP — CURRENCY ============
async function doCurrency() {
  const amount = parseFloat($('cur-amount').value) || 1;
  const from = $('cur-from').value;
  const to = $('cur-to').value;
  $('cur-result').className = 'result-box empty';
  $('cur-result').textContent = 'Ngitung...';
  const r = await api('/api/lookup/currency?from=' + from + '&to=' + to + '&amount=' + amount);
  if (!r.success) { $('cur-result').className = 'result-box empty'; $('cur-result').textContent = r.error.message; return; }
  const d = r.data;
  $('cur-result').className = 'result-box';
  $('cur-result').innerHTML =
    '<div class="score-big" style="color:var(--cyan);font-size:32px">' + amount.toLocaleString('id-ID') + ' ' + d.from + '</div>' +
    '<div class="score-label">=</div>' +
    '<div class="score-big" style="color:var(--ok);font-size:36px">' + d.converted.toLocaleString('id-ID') + ' ' + d.to + '</div>' +
    '<div style="text-align:center;font-size:11px;color:var(--muted);font-family:VT323,monospace;margin-top:8px">Kurs per ' + d.date + '</div>';
}

// ============ LOOKUP — PRAYER ============
async function doPrayer() {
  const q = $('prayer-input').value.trim();
  if (!q) return toast('Ketik dulu nama kotanya', 'warn');
  $('prayer-result').className = 'result-box empty';
  $('prayer-result').textContent = 'Ambil jadwal...';
  const r = await api('/api/lookup/prayer?q=' + encodeURIComponent(q));
  if (!r.success) { $('prayer-result').className = 'result-box empty'; $('prayer-result').textContent = r.error.message; return; }
  const d = r.data;
  const j = d.jadwal;
  $('prayer-result').className = 'result-box';
  $('prayer-result').innerHTML =
    '<div style="margin-bottom:12px"><div style="font-size:14px;font-weight:600">' + esc(d.lokasi.nama) + ', ' + esc(d.lokasi.negara) + '</div>' +
    '<div style="font-size:11px;color:var(--muted);font-family:VT323,monospace">' + esc(d.tanggal) + '</div></div>' +
    '<div class="traffic-info">' +
    '<div class="ti-cell"><div class="ti-label">Subuh</div><div class="ti-value">' + j.subuh + '</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Dzuhur</div><div class="ti-value">' + j.dzuhur + '</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Ashar</div><div class="ti-value">' + j.ashar + '</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Maghrib</div><div class="ti-value">' + j.maghrib + '</div></div>' +
    '<div class="ti-cell"><div class="ti-label">Isya</div><div class="ti-value">' + j.isya + '</div></div>' +
    '</div>';
}

// ============ HISTORY ============
async function openHistory() {
  const r = await api('/api/history');
  const modal = $('history-modal');
  const list = $('history-list');
  if (!r.success || !r.data.items.length) {
    list.innerHTML = '<div class="result-box empty">Belum ada riwayat bro.</div>';
  } else {
    list.innerHTML = r.data.items.slice(0, 30).map(i =>
      '<div class="history-item">' +
      '<div><div class="history-item-title">' + esc(i.title || '-') + '</div>' +
      '<div class="history-item-sub">' + esc(i.type || '-') + ' · ' + new Date(i.date).toLocaleString('id-ID') + '</div></div>' +
      '<button class="btn" style="padding:6px 10px;font-size:11px" onclick="delHistory(' + i.id + ')">Hapus</button>' +
      '</div>'
    ).join('');
  }
  modal.classList.add('show');
}
function closeHistory() { $('history-modal').classList.remove('show'); }
async function delHistory(id) { await api('/api/history/' + id, { method: 'DELETE' }); openHistory(); toast('Udah dihapus', 'ok', 1200); }

async function loadDashHistory() {
  const r = await api('/api/history');
  const el = $('dash-history');
  if (!el) return;
  if (!r.success || !r.data.items.length) { el.textContent = 'Belum ada riwayat. Coba cek sesuatu dulu.'; return; }
  el.innerHTML = r.data.items.slice(0, 3).map(i =>
    '<div style="padding:6px 0;border-bottom:1px dashed var(--border)">' +
    esc(i.type) + ' · ' + esc(i.title) + ' · ' + new Date(i.date).toLocaleDateString('id-ID') +
    '</div>'
  ).join('');
}

// ============ COMMAND PALETTE ============
const CMDS = [
  { name: 'Cek Macet', tab: 'traffic', icon: 'i-car' },
  { name: 'Chat AI', tab: 'ai', icon: 'i-spark' },
  { name: 'Tools (Morse, Password, QR)', tab: 'tools', icon: 'i-tool' },
  { name: 'Cuaca & Kurs', tab: 'lookup', icon: 'i-globe' },
  { name: 'OSINT Domain/IP', tab: 'osint', icon: 'i-search' },
  { name: 'Anti-Phising', tab: 'phishing', icon: 'i-shield' },
  { name: 'Email Bocor', tab: 'breach', icon: 'i-mail' },
  { name: 'Minigame', tab: 'games', icon: 'i-game' },
  { name: 'Beranda', tab: 'dashboard', icon: 'i-home' }
];
function openCmd() {
  $('cmd-modal').classList.add('show');
  $('cmd-input').value = '';
  renderCmdList(CMDS);
  setTimeout(() => $('cmd-input').focus(), 100);
}
function closeCmd() { $('cmd-modal').classList.remove('show'); }
function renderCmdList(list) {
  $('cmd-list').innerHTML = list.map(c =>
    '<div class="cmd-item" onclick="showTab(\'' + c.tab + '\');closeCmd()"><svg><use href="#' + c.icon + '"/></svg>' + esc(c.name) + '</div>'
  ).join('');
}
document.addEventListener('input', e => {
  if (e.target.id === 'cmd-input') {
    const q = e.target.value.toLowerCase();
    renderCmdList(CMDS.filter(c => c.name.toLowerCase().includes(q)));
  }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
  if (e.key === 'Escape') closeCmd();
  if (e.key === 'Enter' && !e.shiftKey) {
    const id = document.activeElement?.id;
    if (id === 'geo-input') { e.preventDefault(); doGeocode(); }
    if (id === 'chat-input') { e.preventDefault(); sendChat(); }
    if (id === 'phish-url') { e.preventDefault(); doPhishing(); }
    if (id === 'breach-email') { e.preventDefault(); doBreach(); }
    if (id === 'osint-target') { e.preventDefault(); doOsint(); }
    if (id === 'weather-input') { e.preventDefault(); doWeather(); }
    if (id === 'prayer-input') { e.preventDefault(); doPrayer(); }
    if (id === 'morse-input') { e.preventDefault(); doMorse(); }
    if (id === 'qr-input') { e.preventDefault(); doQR(); }
    if (id === 'short-input') { e.preventDefault(); doShort(); }
  }
});

// ============ GAMES ============
function gameWrap(html) { $('game-area').innerHTML = '<div class="game-panel">' + html + '</div>'; }
function gameEnd(score, total, name) {
  const pct = Math.round(score / total * 100);
  const msg = pct >= 80 ? 'Keren bro! Lu jago.' : pct >= 50 ? 'Lumayan, bisa lebih bagus.' : 'Belajar lagi bro.';
  gameWrap('<div class="game-score">' + score + ' / ' + total + '</div><div style="text-align:center;margin-bottom:16px;color:var(--muted)">' + msg + '</div><button class="btn primary" style="width:100%" onclick="document.getElementById(\'game-area\').innerHTML=\'\'">Tutup</button>');
}

// Game 1: Phishing Quiz
const QUIZ_QUESTIONS = [
  { q: 'Link ini phishing atau legit: <b>tokopedia-login.xyz</b>', a: 'Phising', b: 'Legit' },
  { q: 'Link ini phishing atau legit: <b>https://google.com</b>', a: 'Legit', b: 'Phising' },
  { q: 'Email minta password via link, biasanya?', a: 'Phising', b: 'Legit' },
  { q: 'URL pakai HTTPS itu artinya?', a: 'Legit', b: 'Phising' },
  { q: 'Bank minta OTP lewat WhatsApp, itu?', a: 'Phising', b: 'Legit' },
  { q: 'URL mirip brand tapi beda 1 huruf, itu?', a: 'Phising', b: 'Legit' },
  { q: 'Website toko online baru dibuat 3 hari lalu, itu?', a: 'Phising', b: 'Legit' },
  { q: 'Domain resmi biasanya berakhir .com atau .co.id, itu?', a: 'Legit', b: 'Phising' },
  { q: 'Ada tanda "login" dan "verify" di URL aneh, itu?', a: 'Phising', b: 'Legit' },
  { q: 'Link dari nomor tak dikenal, minta klik, itu?', a: 'Phising', b: 'Legit' }
];
function playQuiz() {
  let i = 0, score = 0;
  function nextQ() {
    if (i >= QUIZ_QUESTIONS.length) return gameEnd(score, QUIZ_QUESTIONS.length, 'Kuis');
    const q = QUIZ_QUESTIONS[i];
    gameWrap('<div class="game-progress">Soal ' + (i + 1) + ' / ' + QUIZ_QUESTIONS.length + '</div><div class="game-q">' + q.q + '</div><div class="game-choices"><div class="game-choice" onclick="window._quizAnswer(true)">' + q.a + '</div><div class="game-choice" onclick="window._quizAnswer(false)">' + q.b + '</div></div>');
  }
  window._quizAnswer = (yes) => {
    if (yes) score++;
    i++;
    setTimeout(nextQ, 300);
  };
  nextQ();
}

// Game 2: Morse Challenge
function playMorseGame() {
  let i = 0, score = 0;
  const total = 10;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const current = [];
  const MORSE_MAP_GAME = { A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..' };

  function nextQ() {
    if (i >= total) return gameEnd(score, total, 'Morse');
    const letter = letters[Math.floor(Math.random() * 26)];
    const morse = MORSE_MAP_GAME[letter];
    // Play sound
    setTimeout(() => playMorseString(morse), 100);
    // Choices
    const choices = new Set([letter]);
    while (choices.size < 4) choices.add(letters[Math.floor(Math.random() * 26)]);
    const arr = Array.from(choices).sort(() => Math.random() - 0.5);
    gameWrap('<div class="game-progress">Soal ' + (i + 1) + ' / ' + total + ' · Skor ' + score + '</div><div class="game-q">Dengerin bunyinya, terus tebak hurufnya</div><div style="text-align:center;margin:16px 0"><button class="btn primary" onclick="playMorseString(\'' + morse + '\')">Puter Suara Lagi</button></div><div class="game-choices">' + arr.map(c => '<div class="game-choice" onclick="window._morseAnswer(\'' + c + '\',\'' + letter + '\')">' + c + '</div>').join('') + '</div>');
  }
  window._morseAnswer = (chosen, correct) => {
    if (chosen === correct) score++;
    i++;
    setTimeout(nextQ, 300);
  };
  nextQ();
}
function playMorseString(morse) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const dotLen = 0.1, dashLen = 0.3, gapChar = 0.1;
  let t = 0;
  for (const c of morse) {
    const dur = c === '.' ? dotLen : dashLen;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 700;
    osc.type = 'sine';
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime + t);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + t + 0.01);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + t + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t + dur);
    osc.start(ctx.currentTime + t);
    osc.stop(ctx.currentTime + t + dur);
    t += dur + gapChar;
  }
  setTimeout(() => ctx.close(), (t + 1) * 1000);
}

// Game 3: Password Challenge
function playPwdGame() {
  let startTime = Date.now();
  let best = 0;
  function update() {
    const input = $('game-pwd-input');
    if (!input) return;
    const pwd = input.value;
    let score = 0;
    if (pwd.length >= 8) score += 2;
    if (pwd.length >= 12) score += 2;
    if (pwd.length >= 16) score += 2;
    if (/[A-Z]/.test(pwd)) score += 1;
    if (/[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
    if (score > best) best = score;
    const el = $('game-pwd-score');
    if (el) el.textContent = score + ' / 10';
  }
  window._pwdUpdate = update;
  gameWrap('<div class="game-q">Bikin password yang paling kuat dalam 30 detik!</div><div style="text-align:center;margin:16px 0"><input type="text" id="game-pwd-input" oninput="_pwdUpdate()" placeholder="Ketik password di sini" style="font-family:monospace;font-size:16px;text-align:center"></div><div class="game-score" id="game-pwd-score">0 / 10</div><div style="text-align:center;color:var(--muted);font-size:12px" id="game-pwd-timer">30 detik</div>');
  setTimeout(() => { const el = $('game-pwd-input'); if (el) el.focus(); }, 100);
  let timeLeft = 30;
  const timer = setInterval(() => {
    timeLeft--;
    const el = $('game-pwd-timer');
    if (el) el.textContent = timeLeft + ' detik';
    if (timeLeft <= 0) {
      clearInterval(timer);
      gameEnd(best, 10, 'Password');
    }
  }, 1000);
}

// Game 4: Memory Match
function playMemoryGame() {
  const icons = ['i-shield','i-lock','i-mail','i-globe','i-car','i-spark','i-search','i-tool'];
  const cards = [...icons, ...icons].sort(() => Math.random() - 0.5);
  let flipped = [], matched = 0, moves = 0;
  function render() {
    gameWrap('<div class="game-progress">Pasangan: ' + matched + ' / 8 · Langkah: ' + moves + '</div><div class="memory-grid">' + cards.map((c, i) => '<div class="mem-card" data-i="' + i + '" onclick="window._memFlip(' + i + ')"><svg style="visibility:hidden"><use href="#' + c + '"/></svg></div>').join('') + '</div>');
  }
  window._memFlip = (i) => {
    if (flipped.includes(i) || flipped.length >= 2) return;
    const el = document.querySelector('[data-i="' + i + '"]');
    if (!el || el.classList.contains('matched')) return;
    el.classList.add('flipped');
    el.querySelector('svg').style.visibility = 'visible';
    flipped.push(i);
    if (flipped.length === 2) {
      moves++;
      const [a, b] = flipped;
      if (cards[a] === cards[b]) {
        document.querySelector('[data-i="' + a + '"]').classList.add('matched');
        document.querySelector('[data-i="' + b + '"]').classList.add('matched');
        matched++;
        flipped = [];
        if (matched === 8) setTimeout(() => gameEnd(8, 8, 'Memory'), 400);
      } else {
        setTimeout(() => {
          [a, b].forEach(x => {
            const e = document.querySelector('[data-i="' + x + '"]');
            if (e) { e.classList.remove('flipped'); e.querySelector('svg').style.visibility = 'hidden'; }
          });
          flipped = [];
        }, 800);
      }
    }
  };
  render();
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  checkHealth();
  loadDailyTip();
  loadDashHistory();
  setInterval(checkHealth, 30000);
  const chatInput = $('chat-input');
  if (chatInput) chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'; });
  console.log('[ORACLE v16] Frontend loaded');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'social-input') {
    e.preventDefault();
    doSocial();
  }
});

/* ============================================================
   OSINT — Social Media Lookup (v2 bersih)
   ============================================================ */
async function doSocial() {
  const input = document.getElementById("social-input");
  if (!input) return;
  const username = input.value.trim().toLowerCase().replace(/^@/, "");
  if (!username) return toast("Masukkan username terlebih dahulu.", "warn");
  const resultBox = document.getElementById("social-result");
  if (!resultBox) return;
  resultBox.className = "result-box empty";
  resultBox.textContent = "Mencari akun di 16 platform...";
  try {
    const r = await api("/api/osint/social", { method: "POST", body: JSON.stringify({ username }) });
    if (!r.success) { resultBox.textContent = r.error.message; return; }
    const d = r.data;
    const found = d.found || [];
    const notFound = (d.results || []).filter(x => !x.exists);
    let html = "";
    html += "<div style=\"text-align:center;margin-bottom:16px\">";
    html += "<div style=\"font-family:VT323,monospace;font-size:42px;color:var(--cyan);line-height:1\">" + d.total_found + " / " + d.total_checked + "</div>";
    html += "<div style=\"font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;font-family:VT323,monospace\">Akun Ditemukan</div>";
    html += "<div style=\"font-size:12px;color:var(--muted);margin-top:6px\">Username: <b style=\"color:var(--text)\">@" + esc(d.username) + "</b></div>";
    html += "</div>";
    if (found.length) {
      html += "<div style=\"font-family:Pixelify Sans,monospace;font-size:12px;margin:16px 0 8px;color:var(--ok)\">AKUN DITEMUKAN (" + found.length + ")</div>";
      found.forEach(p => {
        html += "<a href=\"" + p.url + "\" target=\"_blank\" rel=\"noopener\" style=\"text-decoration:none;color:inherit\">";
        html += "<div class=\"geo-item\" style=\"cursor:pointer\">";
        html += "<div class=\"geo-item-title\">" + esc(p.name) + "</div>";
        const extra = p.extra && p.extra.followers ? " \u00b7 " + p.extra.followers.toLocaleString("id-ID") + " followers" : "";
        html += "<div class=\"geo-item-sub\">" + esc(p.url) + extra + "</div>";
        html += "</div></a>";
      });
    }
    if (notFound.length) {
      html += "<div style=\"font-family:Pixelify Sans,monospace;font-size:12px;margin:16px 0 8px;color:var(--muted)\">TIDAK DITEMUKAN (" + notFound.length + ")</div>";
      notFound.forEach(p => {
        html += "<div class=\"finding\" style=\"opacity:.5\">" + esc(p.name) + "</div>";
      });
    }
    html += "<div style=\"margin-top:16px;padding:10px 12px;background:rgba(245,158,11,.08);border-left:3px solid var(--warn);border-radius:8px;font-size:11.5px;color:var(--muted);line-height:1.5\">" + esc(d.note) + "</div>";
    resultBox.className = "result-box";
    resultBox.innerHTML = html;
    api("/api/history", { method: "POST", body: JSON.stringify({ item: { type: "osint-social", title: "@" + d.username, found: d.total_found } }) });
  } catch (e) {
    resultBox.className = "result-box empty";
    resultBox.textContent = "Terjadi kesalahan: " + e.message;
  }
}

// Enter handler untuk social input
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && document.activeElement && document.activeElement.id === "social-input") {
    e.preventDefault();
    doSocial();
  }
});


// ===== AI MODE TOGGLE =====
let chatMode = 'fast';

function setChatMode(mode) {
  chatMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  if (window.haptic) haptic(15);
}

// ===== RENDER NEURON THINKING =====
function renderNeuronThinking(container) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'neuron-svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.innerHTML = `
    <line x1="10" y1="10" x2="22" y2="22" stroke="#a855f7" stroke-width="1.2"/>
    <line x1="34" y1="10" x2="22" y2="22" stroke="#22d3ee" stroke-width="1.2"/>
    <line x1="10" y1="34" x2="22" y2="22" stroke="#22d3ee" stroke-width="1.2"/>
    <line x1="34" y1="34" x2="22" y2="22" stroke="#a855f7" stroke-width="1.2"/>
    <circle cx="10" cy="10" r="3" fill="#a855f7"/>
    <circle cx="34" cy="10" r="3" fill="#22d3ee"/>
    <circle cx="10" cy="34" r="3" fill="#22d3ee"/>
    <circle cx="34" cy="34" r="3" fill="#a855f7"/>
    <circle cx="22" cy="22" r="4" fill="#d946ef"/>
  `;
  container.appendChild(svg);
}

// ===== SEND CHAT (upgraded) =====
async function sendChatV2() {
  const inp = document.getElementById('chat-input');
  const msg = inp.value.trim();
  if (!msg) return;
  const box = document.getElementById('chat-messages');
  
  // user message
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="msg-bubble">' + esc(msg) + '</div>';
  box.appendChild(userMsg);
  inp.value = '';
  box.scrollTop = box.scrollHeight;
  
  const mode = chatMode;
  
  // thinking indicator
  const loading = document.createElement('div');
  loading.className = 'thinking-overlay';
  const thinkText = mode === 'think' 
    ? ['Menganalisis pertanyaan...', 'Mempertimbangkan konteks...', 'Menyusun jawaban...']
    : mode === 'web'
    ? ['Mencari di web...', 'Membaca sumber...', 'Menyusun jawaban...']
    : ['Memproses...'];
  let stepIdx = 0;
  
  if (mode === 'think') {
    renderNeuronThinking(loading);
  } else {
    const dot = document.createElement('div');
    dot.innerHTML = '<svg class="neuron-svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="6 4"><animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="2s" repeatCount="indefinite"/></circle></svg>';
    loading.appendChild(dot.firstChild);
  }
  
  const thinkTxt = document.createElement('div');
  thinkTxt.className = 'think-text';
  thinkTxt.innerHTML = '<span class="think-step">' + thinkText[0] + '</span>';
  loading.appendChild(thinkTxt);
  box.appendChild(loading);
  box.scrollTop = box.scrollHeight;
  
  const stepTimer = setInterval(() => {
    stepIdx++;
    if (stepIdx < thinkText.length) {
      const span = document.createElement('span');
      span.className = 'think-step';
      span.textContent = thinkText[stepIdx];
      thinkTxt.appendChild(span);
    }
  }, 1200);
  
  const history = (window._chatHistory || []).slice(-6);
  window._chatHistory = window._chatHistory || [];
  window._chatHistory.push({ role: 'user', content: msg });
  
  try {
    const r = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history, mode })
    });
    const data = await r.json();
    clearInterval(stepTimer);
    loading.remove();
    
    if (!data.success) {
      const errMsg = document.createElement('div');
      errMsg.className = 'msg bot';
      errMsg.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg></div><div class="msg-bubble">Error: ' + esc(data.error?.message || 'Gagal') + '</div>';
      box.appendChild(errMsg);
      box.scrollTop = box.scrollHeight;
      return;
    }
    
    const d = data.data;
    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    
    let bubbleHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg></div>';
    bubbleHTML += '<div style="max-width:100%">';
    bubbleHTML += '<div class="msg-bubble md-content">' + renderMarkdown(d.reply) + '</div>';
    
    // Render sources kalau ada
    if (d.sources && d.sources.length > 0) {
      bubbleHTML += '<div class="sources-box">';
      bubbleHTML += '<div class="sources-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007 0l4-4a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-4 4a5 5 0 007 7l1-1"/></svg> Sumber (' + d.sources.length + ')</div>';
      d.sources.forEach((src, i) => {
        const snippet = (src.snippet || '').slice(0, 120);
        bubbleHTML += '<a class="source-item" href="' + esc(src.url) + '" target="_blank" rel="noopener">';
        bubbleHTML += '<div class="source-num">' + (i + 1) + '</div>';
        bubbleHTML += '<div class="source-info">';
        bubbleHTML += '<div class="source-title-text">' + esc(src.title || 'Sumber') + '</div>';
        bubbleHTML += '<div class="source-url-text">' + esc(src.url) + '</div>';
        if (snippet) bubbleHTML += '<div class="source-hint">Kutipan: "' + esc(snippet) + '..."</div>';
        bubbleHTML += '</div>';
        bubbleHTML += '</a>';
      });
      bubbleHTML += '</div>';
    }
    
    // Info model + thinking time
    if (d.mode === 'think' && d.thinkingTime) {
      bubbleHTML += '<div style="font-size:10.5px;color:#6b7182;font-family:JetBrains Mono,monospace;margin-top:6px;padding-left:4px">Berpikir selama ' + d.thinkingTime + 's · Model: ' + esc(d.model) + '</div>';
    }
    
    bubbleHTML += '</div>';
    botMsg.innerHTML = bubbleHTML;
    box.appendChild(botMsg);
    box.scrollTop = box.scrollHeight;
    
    window._chatHistory.push({ role: 'assistant', content: d.reply });
    if (window._chatHistory.length > 20) window._chatHistory = window._chatHistory.slice(-20);
  } catch (e) {
    clearInterval(stepTimer);
    loading.remove();
    const errMsg = document.createElement('div');
    errMsg.className = 'msg bot';
    errMsg.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg></div><div class="msg-bubble">Koneksi error: ' + esc(e.message) + '</div>';
    box.appendChild(errMsg);
  }
}

// Override sendChat lama
window.sendChat = sendChatV2;

// ===== MARKDOWN RENDERER =====
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return esc(text);
  try {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang }).value; } catch (e) {}
        }
        return code;
      }
    });
    return marked.parse(text);
  } catch (e) { return esc(text); }
}
