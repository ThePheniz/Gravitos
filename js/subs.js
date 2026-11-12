// Subtitles: parses SRT / WebVTT / ASS files into timed cues, draws them over the video,
// and searches and downloads from OpenSubtitles directly when js/config.js has an API key.
const Subs = (() => {
  const LANGS = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
    ['pt', 'Portuguese'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'],
    ['fi', 'Finnish'], ['pl', 'Polish'], ['ru', 'Russian'], ['tr', 'Turkish'], ['el', 'Greek'],
    ['he', 'Hebrew'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'],
    ['zh', 'Chinese'], ['mi', 'Māori'],
  ];

  function lang() {
    try { return localStorage.getItem('mq.subLang') || 'en'; } catch (e) { return 'en'; }
  }
  function setLang(code) {
    try { localStorage.setItem('mq.subLang', code); } catch (e) {}
  }
  const langName = code => (LANGS.find(l => l[0] === code) || [code, code])[1];

  // ---- parsing

  // "00:01:02,345", "01:02.345" and ASS "0:01:02.34" all become milliseconds.
  function toMs(t) {
    let s = 0;
    for (const p of t.trim().replace(',', '.').split(':')) s = s * 60 + parseFloat(p);
    return Math.round(s * 1000);
  }

  // Keep <i> and <b> (common in SRT); drop every other tag and escape the rest.
  function toHtml(text) {
    const kept = text.replace(/<(?!\/?[ib]>)[^>]*>/gi, '');
    return kept.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/&lt;(\/?[ib])&gt;/gi, '<$1>').replace(/\n/g, '<br>');
  }

  function parseSrtVtt(text) {
    const cues = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex(l => l.indexOf('-->') >= 0);
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      const body = lines.slice(i + 1).join('\n').trim();
      if (body) cues.push({ start: toMs(a), end: toMs(b.trim().split(/\s+/)[0]), html: toHtml(body) });
    }
    return cues;
  }

  function parseAss(text) {
    const cues = [];
    let section = '', fields = null;
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (/^\[.*\]$/.test(line.trim())) { section = line.trim().toLowerCase(); continue; }
      if (section !== '[events]') continue;
      if (/^Format:/i.test(line)) { fields = line.slice(7).split(',').map(f => f.trim().toLowerCase()); continue; }
      if (!/^Dialogue:/i.test(line) || !fields) continue;
      const parts = line.slice(9).split(',');
      const textAt = fields.indexOf('text');
      const value = name => (parts[fields.indexOf(name)] || '').trim();
      const body = parts.slice(textAt).join(',')
        .replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
      if (body) cues.push({ start: toMs(value('start')), end: toMs(value('end')), html: toHtml(body) });
    }
    return cues;
  }

  function parse(text, format) {
    const cues = /ass|ssa/i.test(format || '') || /^\s*\[Script Info\]/i.test(text) ? parseAss(text) : parseSrtVtt(text);
    return cues.sort((a, b) => a.start - b.start);
  }

  // ---- drawing

  let cues = [], shown = null, flashTimer;
  const el = () => document.getElementById('subs');

  function show(html) {
    if (html === shown) return;
    shown = html;
    el().innerHTML = html ? `<span>${html}</span>` : '';
  }

  function load(list) { cues = list || []; show(''); }
  function clear() { cues = []; clearTimeout(flashTimer); show(''); }
  const active = () => cues.length > 0;

  // Show whatever cues cover `ms` (overlapping cues stack, as in the file).
  function tick(ms) {
    if (!cues.length) return;
    let lo = 0, hi = cues.length - 1, last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= ms) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const on = [];
    for (let i = last; i >= 0 && i > last - 4; i--) if (cues[i].end > ms) on.unshift(cues[i].html);
    show(on.join('<br>'));
  }

  // Text pushed by the TV's own player for an embedded track.
  function flash(text, durationMs) {
    clearTimeout(flashTimer);
    show(text ? toHtml(String(text)) : '');
    if (text) flashTimer = setTimeout(() => show(''), Math.max(500, durationMs || 3000));
  }

  // ---- OpenSubtitles (direct)

  const API = 'https://api.opensubtitles.com/api/v1';
  const cfg = () => (typeof GravitosConfig !== 'undefined' ? GravitosConfig : {});
  const enabled = () => !!cfg().openSubtitlesApiKey;
  let token = null;

  async function os(path, opts) {
    const headers = {
      'Api-Key': cfg().openSubtitlesApiKey, Accept: 'application/json', 'Content-Type': 'application/json',
      'X-User-Agent': 'Gravitos v1.3',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API + path, Object.assign({ headers }, opts));
    if (!res.ok) {
      const err = new Error('OpenSubtitles said ' + res.status + (res.status === 406 ? ' (daily download limit reached)' : ''));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function login() {
    const c = cfg();
    if (token || !c.openSubtitlesUser) return;
    const r = await os('/login', { method: 'POST', body: JSON.stringify({ username: c.openSubtitlesUser, password: c.openSubtitlesPassword }) });
    token = r.token;
  }

  const imdbOf = m => {
    const g = (m.Guid || []).find(x => /^imdb:\/\/tt\d+/.test(x.id));
    return g ? parseInt(g.id.slice(9), 10) : null;
  };

  // Best first: releases whose name shares the most words with the video file (same source,
  // resolution and group usually means the timing matches), then the most downloaded.
  // Cinema recordings (CAM, TS) rarely line up with a proper copy, so they go last.
  function rank(results, fileName) {
    const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1));
    const file = words(fileName);
    const camRip = /(^|[^a-z])(cam|hdcam|ts|hdts|telesync|tc)([^a-z]|$)/i;
    const score = r => {
      let s = 0;
      for (const w of words(r.title)) if (file.has(w)) s++;
      if (camRip.test(r.title)) s -= 10;
      return s;
    };
    return results.map(r => [r, score(r)]).sort((a, b) => b[1] - a[1] || b[0].downloads - a[0].downloads).map(x => x[0]);
  }

  // `meta` is full Plex metadata; `show` is the show's, for episodes; `fileName` is the video file's.
  async function search(meta, show, language, fileName) {
    const p = new URLSearchParams({ languages: language });
    if (meta.type === 'episode') {
      const ep = imdbOf(meta), parent = show && imdbOf(show);
      if (ep) p.set('imdb_id', ep);
      else if (parent) { p.set('parent_imdb_id', parent); p.set('season_number', meta.parentIndex); p.set('episode_number', meta.index); }
      else { p.set('query', meta.grandparentTitle); p.set('season_number', meta.parentIndex); p.set('episode_number', meta.index); }
    } else {
      const id = imdbOf(meta);
      if (id) p.set('imdb_id', id); else { p.set('query', meta.title); if (meta.year) p.set('year', meta.year); }
    }
    // OpenSubtitles redirects queries whose parameters aren't in alphabetical order, and
    // browsers refuse to follow that redirect for this kind of request.
    p.sort();
    const r = await os('/subtitles?' + p);
    return rank((r.data || []).map(d => {
      const a = d.attributes || {}, f = (a.files || [])[0] || {};
      return { fileId: f.file_id, title: a.release || f.file_name || 'Subtitle', downloads: a.download_count || 0, hi: !!a.hearing_impaired };
    }).filter(x => x.fileId), fileName);
  }

  async function download(fileId) {
    await login().catch(() => {});
    const r = await os('/download', { method: 'POST', body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }) });
    const res = await fetch(r.link);
    if (!res.ok) throw new Error('Subtitle download failed (' + res.status + ')');
    return res.text();
  }

  return { LANGS, lang, setLang, langName, parse, load, clear, tick, flash, active, enabled, search, download };
})();
