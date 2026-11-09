'use strict';

const API = 'https://generativelanguage.googleapis.com';
const INLINE_LIMIT = 12 * 1024 * 1024; // bigger files go through the Files API
const $ = (id) => document.getElementById(id);

// ---------- storage helpers (wrapped: storage can be unavailable) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const DEFAULT_TEMPLATES = [
  { id: 'meeting', name: 'Meeting notes', prompt: 'Write concise meeting notes in Markdown with these sections: ## Overview (2-3 sentences), ## Key points (bullets), ## Decisions (bullets), ## Action items (bullets with owner and due date if mentioned).' },
  { id: 'call', name: 'Phone call', prompt: 'Summarize this phone call in Markdown: ## Who and why, ## What was discussed (bullets), ## Agreements and commitments, ## Follow-ups.' },
  { id: 'lecture', name: 'Lecture / study notes', prompt: 'Turn this into structured study notes in Markdown: ## Main idea, ## Outline with headings and bullets, ## Key terms and definitions, ## Questions to review.' },
  { id: 'brief', name: 'Quick summary', prompt: 'Give a brief Markdown summary: a one-paragraph overview followed by up to 5 bullet points.' },
];

let settings = store.get('settings', { apiKey: '', model: 'gemini-2.5-flash' });
let templates = store.get('templates', DEFAULT_TEMPLATES);
let library = store.get('library', []);
let currentFile = null;

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  ['new', 'lib', 'set'].forEach((t) => { $('tab-' + t).hidden = t !== name; });
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'lib') { $('libView').hidden = true; renderList(); }
}

// ---------- rendering helpers ----------
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function md(src) { // small, safe Markdown subset (escape first, then format)
  const lines = esc(src || '').split('\n');
  let html = '', inList = false;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    const li = l.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(li[1]) + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) html += '<h3>' + inline(h[2]) + '</h3>';
    else if (l) html += '<p>' + inline(l) + '</p>';
  }
  if (inList) html += '</ul>';
  return html;
}
function fmtDate(ts) { return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function setStatus(msg, cls) { const s = $('status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }

function resultCard(rec) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = '<b></b><div class="hint"></div><div class="md"></div>' +
    '<h3 style="font-size:17px;margin:16px 0 6px">Transcript</h3><pre class="tx"></pre>' +
    '<div class="row"><button data-a="copy">Copy all</button><button data-a="dl">Download .md</button><button data-a="share">Share</button><button data-a="del" class="danger">Delete</button></div>';
  wrap.querySelector('b').textContent = rec.title;
  wrap.querySelector('.hint').textContent = fmtDate(rec.createdAt) + ' · ' + rec.template;
  wrap.querySelector('.md').innerHTML = md(rec.summary);
  wrap.querySelector('.tx').textContent = rec.transcript;
  const text = toMarkdown(rec);
  wrap.addEventListener('click', async (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === 'copy') { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; } }
    if (a === 'dl') {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = document.createElement('a'); link.href = url; link.download = rec.title.replace(/[^\w\- ]+/g, '').trim() + '.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    if (a === 'share') { if (navigator.share) { try { await navigator.share({ title: rec.title, text }); } catch {} } else { e.target.textContent = 'Share unsupported'; } }
    if (a === 'del') {
      if (!confirm('Delete this recording from the library?')) return;
      library = library.filter((r) => r.id !== rec.id); store.set('library', library);
      wrap.remove(); $('libView').hidden = true; renderList();
    }
  });
  return wrap;
}
function toMarkdown(r) {
  return `# ${r.title}\n\n*${fmtDate(r.createdAt)} · ${r.template}*\n\n${r.summary}\n\n## Transcript\n\n${r.transcript}\n`;
}

// ---------- library ----------
function renderList() {
  const q = $('q').value.trim().toLowerCase();
  const items = library.filter((r) => !q || (r.title + r.summary + r.transcript).toLowerCase().includes(q));
  const box = $('list'); box.innerHTML = '';
  if (!items.length) { box.innerHTML = '<p class="hint">' + (library.length ? 'No matches.' : 'Nothing saved yet.') + '</p>'; return; }
  for (const r of items) {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = '<b></b><small></small>';
    d.querySelector('b').textContent = r.title;
    d.querySelector('small').textContent = fmtDate(r.createdAt) + ' · ' + r.template;
    d.addEventListener('click', () => { const v = $('libView'); v.innerHTML = ''; v.appendChild(resultCard(r)); v.hidden = false; v.scrollIntoView(); });
    box.appendChild(d);
  }
}
$('q').addEventListener('input', renderList);

// ---------- templates ----------
function fillTemplates() {
  for (const id of ['tpl', 'tsel']) {
    const sel = $(id); const prev = sel.value; sel.innerHTML = '';
    templates.forEach((t) => sel.add(new Option(t.name, t.id)));
    if (templates.some((t) => t.id === prev)) sel.value = prev;
  }
  loadTemplateEditor();
}
function loadTemplateEditor() {
  const t = templates.find((x) => x.id === $('tsel').value) || templates[0];
  if (t) { $('tname').value = t.name; $('tprompt').value = t.prompt; }
}
$('tsel').addEventListener('change', loadTemplateEditor);
$('tsave').addEventListener('click', () => {
  const t = templates.find((x) => x.id === $('tsel').value); if (!t) return;
  t.name = $('tname').value.trim() || t.name; t.prompt = $('tprompt').value; store.set('templates', templates); fillTemplates();
});
$('tnew').addEventListener('click', () => {
  const id = 't' + Date.now();
  templates.push({ id, name: $('tname').value.trim() || 'New template', prompt: $('tprompt').value });
  store.set('templates', templates); fillTemplates(); $('tsel').value = id; $('tpl').value = id; loadTemplateEditor();
});
$('tdel').addEventListener('click', () => {
  if (templates.length < 2) return alert('Keep at least one template.');
  templates = templates.filter((x) => x.id !== $('tsel').value); store.set('templates', templates); fillTemplates();
});

// ---------- settings ----------
function fillModels(list) {
  const sel = $('model'); sel.innerHTML = '';
  const names = list.includes(settings.model) ? list : [settings.model, ...list];
  names.forEach((n) => sel.add(new Option(n, n))); sel.value = settings.model;
}
$('key').value = settings.apiKey;
fillModels([settings.model]);
$('saveSet').addEventListener('click', () => {
  settings = { apiKey: $('key').value.trim(), model: $('model').value };
  store.set('settings', settings); $('setStatus').textContent = 'Saved.'; $('setStatus').className = 'status ok'; updateGo();
});
$('loadModels').addEventListener('click', async () => {
  const key = $('key').value.trim(); const s = $('setStatus');
  if (!key) { s.textContent = 'Enter your API key first.'; s.className = 'status err'; return; }
  s.textContent = 'Loading…'; s.className = 'status';
  try {
    const r = await fetch(`${API}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, '')).filter((n) => !/embed|image|tts|live|robotics|aqa/i.test(n)).sort();
    fillModels(names); s.textContent = names.length + ' models loaded. Flash models are cheapest and fine for this.'; s.className = 'status ok';
  } catch (e) { s.textContent = e.message; s.className = 'status err'; }
});

// Connection test: key + model + network, no audio involved
$('testConn').addEventListener('click', async () => {
  const s = $('setStatus'); const key = $('key').value.trim(); const model = $('model').value;
  if (!key) { s.textContent = 'Enter your API key first.'; s.className = 'status err'; return; }
  s.textContent = 'Testing ' + model + '… (gives up after 20 s)'; s.className = 'status';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }] }),
    });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    const t = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map((p) => p.text || '').join('').trim();
    s.textContent = 'Works. Key and ' + model + ' are fine. Reply: ' + (t || '(empty)'); s.className = 'status ok';
  } catch (e) {
    s.textContent = e.name === 'AbortError'
      ? 'No answer from Google after 20 s. This model may be stalled or overloaded, or something on the phone is blocking the connection. Try a different model, or another network.'
      : (e instanceof TypeError ? 'Network error (Failed to fetch): the phone could not reach Google. ' : 'Failed: ') + e.message;
    s.className = 'status err';
  } finally { clearTimeout(timer); }
});

// ---------- file selection / recording ----------
function pickFile(file) {
  currentFile = file;
  $('picked').textContent = file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : '';
  updateGo();
}
function updateGo() { $('go').disabled = !currentFile || !settings.apiKey; if (currentFile && !settings.apiKey) setStatus('Add your API key in Settings first.', 'err'); }
$('file').addEventListener('change', (e) => pickFile(e.target.files[0] || null));

let recorder = null, recChunks = [], recTimer = null, recStart = 0, wakeLock = null;
$('recBtn').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); clearInterval(recTimer); if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
      const type = recorder.mimeType || mime || 'audio/webm'; recorder = null;
      $('recBtn').textContent = '● Record'; $('recInfo').hidden = true;
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      pickFile(new File(recChunks, `recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, { type }));
    };
    recorder.start(5000);
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    recStart = Date.now(); $('recBtn').textContent = '■ Stop'; $('recInfo').hidden = false;
    recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
  } catch (e) { setStatus('Microphone unavailable: ' + e.message, 'err'); }
});

// ---------- Gemini ----------
function normMime(file) {
  let t = (file.type || '').split(';')[0].toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!t || t === 'application/octet-stream') t = { m4a: 'audio/mp4', mp3: 'audio/mp3', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg' }[ext] || 'audio/mp4';
  return { 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/mpeg': 'audio/mp3', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav' }[t] || t;
}
async function errText(r) {
  try { const j = await r.json(); return `${r.status}: ${j.error && j.error.message || JSON.stringify(j)}`; } catch { return `${r.status} ${r.statusText}`; }
}
function toBase64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
}
async function uploadFile(file, mime) {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': settings.apiKey, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.name } }),
  });
  if (!start.ok) throw new Error(await errText(start));
  const url = start.headers.get('X-Goog-Upload-URL');
  if (!url) throw new Error('Upload URL missing from response (browser blocked the header).');
  const up = await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: file });
  if (!up.ok) throw new Error(await errText(up));
  let f = (await up.json()).file;
  for (let i = 0; i < 90 && f.state === 'PROCESSING'; i++) { // wait until the file is ready
    await new Promise((r) => setTimeout(r, 2000));
    const g = await fetch(`${API}/v1beta/${f.name}`, { headers: { 'x-goog-api-key': settings.apiKey } });
    if (!g.ok) throw new Error(await errText(g));
    f = await g.json();
  }
  if (f.state !== 'ACTIVE') throw new Error('Gemini could not process the file (state: ' + f.state + ').');
  return f.uri;
}
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    transcript: { type: 'STRING' },
  },
  required: ['title', 'summary', 'transcript'],
};
function buildPrompt(tpl) {
  return 'You are a meticulous note-taker. Listen to the attached recording and return JSON with three fields.\n' +
    '- title: a short descriptive title (max 8 words).\n' +
    '- transcript: a faithful, complete transcript in the original spoken language. One utterance per line, formatted "[mm:ss] Speaker 1: text". ' +
    'Use consistent labels (Speaker 1, Speaker 2, ...) and use real names only if they are clearly stated in the audio. Do not invent speech.\n' +
    '- summary: Markdown, written in the language of the recording unless told otherwise. Instructions: ' + tpl.prompt;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NET_MSG = 'Could not reach Google ("Failed to fetch"). Stay in this app with the screen on while it works, check your connection, and try again.';
// Retries on "busy" statuses and dropped connections, telling the user what is happening.
async function withRetry(fn, label) {
  const delays = [4000, 12000, 30000];
  for (let i = 0; ; i++) {
    try {
      const r = await fn();
      if (![429, 500, 502, 503, 504].includes(r.status) || i >= delays.length) return r;
      setStatus(`${label}: Gemini is busy (${r.status}). Retrying in ${delays[i] / 1000}s… (${i + 1}/${delays.length})`);
    } catch (e) {
      if (i >= delays.length) throw new Error(NET_MSG);
      setStatus(`${label}: connection dropped. Retrying in ${delays[i] / 1000}s… (${i + 1}/${delays.length})`);
    }
    await sleep(delays[i]);
  }
}
async function generate(parts, withMax) {
  const body = { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 } };
  if (withMax) body.generationConfig.maxOutputTokens = 65536;
  return fetch(`${API}/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': settings.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

$('go').addEventListener('click', async () => {
  if (!currentFile) return;
  const tpl = templates.find((t) => t.id === $('tpl').value) || templates[0];
  const btn = $('go'); btn.disabled = true; $('result').hidden = true;
  try {
    const mime = normMime(currentFile);
    let media;
    if (currentFile.size <= INLINE_LIMIT) { setStatus('Preparing audio…'); media = { inlineData: { mimeType: mime, data: await toBase64(currentFile) } }; }
    else { setStatus('Uploading ' + (currentFile.size / 1048576).toFixed(0) + ' MB…'); media = { fileData: { mimeType: mime, fileUri: await uploadFile(currentFile, mime) } }; }
    setStatus('Transcribing and summarizing — long recordings can take a few minutes…');
    const parts = [{ text: buildPrompt(tpl) }, media];
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    let r = await withRetry(() => generate(parts, true), 'Gemini');
    if (r.status === 400) r = await withRetry(() => generate(parts, false), 'Gemini'); // some models reject a large output cap
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    const cand = j.candidates && j.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
    if (!text) throw new Error('No output returned' + (j.promptFeedback ? ': ' + JSON.stringify(j.promptFeedback) : '') + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
    let out;
    try { out = JSON.parse(text); } catch { throw new Error('The response was cut off or malformed' + (cand.finishReason === 'MAX_TOKENS' ? ' (recording too long for one pass — try splitting it).' : '.')); }
    const rec = { id: String(Date.now()), createdAt: Date.now(), template: tpl.name, title: out.title || currentFile.name, summary: out.summary || '', transcript: out.transcript || '' };
    library.unshift(rec);
    if (!store.set('library', library)) setStatus('Done, but browser storage is full — download this one now.', 'err');
    else setStatus('Done. Saved to Library.', 'ok');
    const box = $('result'); box.innerHTML = ''; box.appendChild(resultCard(rec)); box.hidden = false;
  } catch (e) { setStatus(e.message, 'err'); }
  finally {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    btn.disabled = !currentFile || !settings.apiKey;
  }
});

// ---------- share-target intake + service worker ----------
async function takeShared() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return;
  try {
    const cache = await caches.open('shared-file'); const hit = await cache.match('pending');
    if (hit) {
      const blob = await hit.blob(); const name = decodeURIComponent(hit.headers.get('X-Filename') || 'shared-audio');
      pickFile(new File([blob], name, { type: hit.headers.get('Content-Type') || blob.type })); await cache.delete('pending');
      setStatus('Shared file received. Pick a template and tap Transcribe.');
    } else {
      const dbg = await cache.match('debug'); const why = dbg ? await dbg.text() : 'No share data was stored (is the app up to date? Reopen it and try again).';
      if (dbg) await cache.delete('debug');
      setStatus('No audio file came through. ' + why, 'err');
    }
  } catch (e) { setStatus('Could not read the shared file: ' + e.message, 'err'); }
  history.replaceState(null, '', location.pathname);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

fillTemplates(); renderList(); updateGo(); takeShared();
if (!settings.apiKey) showTab('set');
