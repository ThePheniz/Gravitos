// Video playback. On the TV this uses Samsung's AVPlay, which direct-plays most files
// (MKV, HEVC, AC3/EAC3) straight from the server; if a file won't play it falls back to
// Plex's HLS transcode. In a desktop browser it uses a plain <video> for UI testing.
//
// Subtitles come three ways: text files (external, or downloaded from OpenSubtitles) are
// drawn by the app (Subs); embedded text tracks are decoded by AVPlay, which hands the
// app each line; picture-based tracks are burned into the picture by Plex's transcoder.
const Player = (() => {
  const av = (window.webapis && window.webapis.avplay) || null;
  const $ = id => document.getElementById(id);
  const TEXT_CODECS = ['srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'tx3g', 'smi', 'text'];
  let st = null; // the current session, null when nothing is playing
  let osdTimer, tlTimer, seekTimer, upTimer, subTimer, infoTimer;
  // Episodes started by the "Up next" countdown with no key pressed since; at 3 the player
  // asks "Are you still watching?" instead of playing on.
  let autoRun = 0;
  let nearBar = false, idleTimer; // PC mouse: pointer over the progress bar / buttons; pointer moved lately
  const STILL_WATCHING_AFTER = 3;

  if (av) {
    // AVPlay renders into this element's video plane, behind the transparent page.
    const obj = document.createElement('object');
    obj.type = 'application/avplayer';
    obj.id = 'av';
    $('player').insertBefore(obj, $('player').firstChild);
  }

  const active = () => !!st;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const subStreams = m => (m.Media[0].Part[0].Stream || []).filter(s => s.streamType === 3);
  const audioStreams = m => (m.Media[0].Part[0].Stream || []).filter(s => s.streamType === 2);

  // Whether this device can decode the file as it is. Files it can't go straight to Plex's
  // conversion; trying them first can leave a browser loading forever without an error.
  function canDirectPlay(media) {
    const v = (media.videoCodec || '').toLowerCase(), a = (media.audioCodec || '').toLowerCase();
    const c = (media.container || '').toLowerCase();
    // Samsung's 2023 and later TVs play nearly everything, but dropped DTS and TrueHD audio.
    if (av) return ['dca', 'dts', 'truehd'].indexOf(a) < 0;
    const vt = { h264: 'avc1.640028', hevc: 'hvc1.1.6.L120.90', av1: 'av01.0.08M.08', vp9: 'vp09.00.40.08' }[v];
    const at = { aac: 'mp4a.40.2', mp3: 'mp4a.69', opus: 'opus', flac: 'flac', ac3: 'ac-3', eac3: 'ec-3' }[a];
    if (!vt || !at || ['mp4', 'm4v', 'mov', 'mkv', 'webm'].indexOf(c) < 0) return false;
    return !!document.createElement('video').canPlayType(`video/mp4; codecs="${vt}, ${at}"`);
  }

  // If the picture hasn't moved a while after starting, don't spin forever: switch a direct
  // stream to Plex's conversion, or say that the conversion is slow.
  function watchStart() {
    clearTimeout(st.watchdog);
    const session = st, mode = st.mode;
    st.watchFrom = st.pos;
    st.progressed = false;
    st.watchdog = setTimeout(() => {
      if (st !== session || st.mode !== mode || st.paused || st.progressed || st.upNext) return;
      if (mode === 'direct') {
        st.directFailed = true;
        toast('This file is slow to start. Asking the server to convert it…', 3000);
        restartHls(st.subs.burn);
      } else {
        toast('Still loading. The server may be busy converting this video.', 5000);
      }
    }, mode === 'direct' ? 12000 : 40000);
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }

  // `auto` marks an episode started by the Up-next countdown rather than by a person.
  async function play(meta, offsetMs, onClose, auto) {
    if (st) close(true);
    if (!auto) autoRun = 0;
    // Listings leave out stream details (subtitles need them), intro/credits markers and chapters.
    const part0 = meta.Media && meta.Media[0] && meta.Media[0].Part && meta.Media[0].Part[0];
    if (!part0 || !part0.Stream || !meta._full) {
      meta = await Plex.lib.meta(meta.ratingKey, { includeMarkers: 1, includeChapters: 1 });
      meta._full = true;
    }
    const media = meta.Media && meta.Media[0];
    const part = media && media.Part && media.Part[0];
    if (!part) throw new Error('This title has no playable file.');

    st = {
      meta, part, onClose,
      duration: meta.duration || media.duration || 0,
      pos: offsetMs || 0, posAt: Date.now(), base: 0, target: null,
      mode: 'direct', directFailed: false, prepared: false, paused: false, upNext: null, ended: false,
      session: 'mq' + Date.now().toString(36),
      subs: { streams: subStreams(meta), extra: [], current: null, native: null, burn: null },
      markers: (meta.Marker || []).filter(m => (m.type === 'intro' || m.type === 'credits') && m.endTimeOffset > m.startTimeOffset),
      skip: null, skipped: new Set(),
      audio: { streams: audioStreams(meta), current: null, native: null },
      bif: undefined, // preview thumbnails: undefined = not loaded yet, null = none
      chapters: (meta.Chapter || []).slice().sort((x, y) => x.startTimeOffset - y.startTimeOffset),
      ui: 'scrub', // 'scrub' (arrows skip), 'controls' (arrows move along the buttons), 'chapters'
      ctl: 0,
    };
    // The track Plex has selected for this title (it remembers a choice) vs. the file's own default.
    const a = st.audio;
    const fileDefault = a.streams.find(s => s.default) || a.streams[0];
    a.current = a.streams.find(s => s.selected) || fileDefault || null;
    const nonDefaultAudio = a.current && a.current !== fileDefault;
    if (nonDefaultAudio && av) a.native = a.current;
    document.documentElement.classList.add('playing');
    const ep = meta.type === 'episode';
    const title = ep ? meta.grandparentTitle : meta.title;
    const brand = $('osd-brand');
    const logo = Plex.logo(meta, 460, 130);
    brand.textContent = '';
    const text = () => { brand.innerHTML = ''; brand.appendChild(document.createElement('h1')).textContent = title; };
    if (logo) {
      const img = brand.appendChild(document.createElement('img'));
      img.onerror = text;
      img.src = logo;
    } else {
      text();
    }
    $('osd-sub').textContent = ep ? `S${meta.parentIndex} E${meta.index} · ${meta.title}` : (meta.year || '');
    $('osd-paused').hidden = true;
    $('pause-veil').hidden = true;
    Subs.clear();
    buildControls();
    // Small marks on the progress bar where chapters begin.
    $('osd-ticks').innerHTML = st.duration ? st.chapters.slice(1)
      .map(c => `<i style="left:${(c.startTimeOffset / st.duration) * 100}%"></i>`).join('') : '';
    showOsd();
    // A browser can't switch audio tracks inside a file, so a non-default track means
    // letting Plex serve the stream with that track.
    if (canDirectPlay(media) && !(nonDefaultAudio && !av)) {
      startStream(Plex.url(part.key), st.pos);
    } else {
      st.directFailed = true;
      restartHls(null);
    }
    report('playing');
    tlTimer = setInterval(() => report(st.paused ? 'paused' : 'playing'), 10000);
    // Between the player's position updates, keep subtitle timing smooth.
    subTimer = setInterval(() => {
      if (st && !st.paused && Subs.active()) Subs.tick(st.pos + Math.min(1000, Date.now() - st.posAt));
    }, 100);
    // Turn on whatever subtitle Plex has selected for this title.
    const chosen = st.subs.streams.find(s => s.selected);
    if (chosen) applySub(chosen, false);
  }

  // A converted stream started part-way in either keeps the file's own timestamps (a stream
  // started at 20:00 reports 20:00) or counts from zero; hls.js does the former. Decide on
  // the first update past a second, then map every update to a position in the file.
  function fromStream(raw) {
    if (st.mode !== 'hls' || !st.base) return raw;
    if (st.absolute == null && raw > 1000) st.absolute = raw >= st.base - 5000;
    return st.absolute ? raw : st.base + raw;
  }

  function setPos(ms) {
    if (Math.abs(ms - st.watchFrom) > 500) st.progressed = true;
    st.pos = ms;
    st.posAt = Date.now();
    Subs.tick(ms);
    updateSkip();
    render();
  }

  // ---------------------------------------------------------------- skip intro / credits

  // Plex's intro and credits markers (detected by the server) show a Skip button while
  // playback is inside them; OK presses it. Each marker is offered once per play.
  function updateSkip() {
    const m = st.markers.find(x => st.pos >= x.startTimeOffset && st.pos < x.endTimeOffset - 1500 && !st.skipped.has(x));
    // An episode's credits bring up the next episode's card over them, as the big apps do.
    if (m && m.type === 'credits' && st.meta.type === 'episode') return creditsReached(m);
    if (m === st.skip) return;
    st.skip = m || null;
    const btn = $('skip');
    if (!m) { btn.hidden = true; return; }
    btn.textContent = m.type === 'intro' ? 'Skip Intro' : (st.meta.type === 'episode' ? 'Next Episode' : 'Skip Credits');
    btn.hidden = false;
  }

  function doSkip() {
    const m = st.skip;
    st.skipped.add(m);
    st.skip = null;
    $('skip').hidden = true;
    // Credits on an episode: go straight to the "Up next" card.
    if (m.type === 'credits' && st.meta.type === 'episode') return ended();
    st.target = Math.min(m.endTimeOffset, st.duration - 5000);
    clearTimeout(seekTimer);
    applySeek();
  }

  function startStream(url, offsetMs) {
    buffering(true);
    st.prepared = false;
    watchStart();
    if (av) return avOpen(url, offsetMs);
    const v = $('video');
    v.hidden = false;
    v.onloadedmetadata = () => {
      if (offsetMs && st.mode === 'direct') v.currentTime = offsetMs / 1000;
      v.play().catch(() => {});
      st.prepared = true;
    };
    v.ontimeupdate = () => { if (st) setPos(fromStream(v.currentTime * 1000)); };
    applyVolume();
    v.onwaiting = () => buffering(true);
    v.onplaying = () => buffering(false);
    v.onended = ended;
    v.onerror = () => failed('MEDIA_ERR_' + (v.error && v.error.code));
    attach(v, url);
  }

  // Desktop browsers: Plex's converted streams are HLS, which Edge and Chrome only play
  // natively on some versions. hls.js (loaded on first use, never on the TV) plays them everywhere.
  let hlsLib = null;
  function loadHls() {
    if (!hlsLib) {
      hlsLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/hls.light.min.js';
        s.onload = () => resolve(window.Hls);
        s.onerror = () => { hlsLib = null; reject(new Error('could not load hls.js')); };
        document.head.appendChild(s);
      });
    }
    return hlsLib;
  }

  function attach(v, url) {
    if (url.indexOf('.m3u8') < 0) { v.src = url; return; }
    const session = st;
    loadHls().then(Hls => {
      if (st !== session) return;
      if (!Hls || !Hls.isSupported()) { v.src = url; return; }
      const hls = new Hls({ maxBufferLength: 30 });
      st.hls = hls;
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (data.fatal && st === session && st.hls === hls) failed('HLS ' + data.details);
      });
      hls.loadSource(url);
      hls.attachMedia(v);
    }, () => { if (st === session) v.src = url; });
  }

  function avOpen(url, offsetMs) {
    try {
      av.open(url);
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setListener({
        onbufferingstart: () => buffering(true),
        onbufferingcomplete: () => buffering(false),
        oncurrentplaytime: ms => { if (st) setPos(fromStream(ms)); },
        onstreamcompleted: ended,
        onerror: failed,
        onsubtitlechange: (duration, text) => { if (st && st.subs.native) Subs.flash(text, Number(duration)); },
        onevent: () => {}, ondrmevent: () => {},
      });
      av.prepareAsync(() => {
        st.prepared = true;
        const go = () => {
          try { av.play(); } catch (e) { return failed(e); }
          buffering(false);
          if (st.subs.native) selectNative();
          if (st.audio.native) selectNativeAudio();
        };
        if (offsetMs && st.mode === 'direct') av.seekTo(offsetMs, go, go); else go();
      }, failed);
    } catch (e) {
      failed(e);
    }
  }

  function teardown() {
    if (!st) return;
    if (av) {
      try { av.stop(); } catch (e) {}
      try { av.close(); } catch (e) {}
    } else {
      const v = $('video');
      if (st.hls) { st.hls.destroy(); st.hls = null; }
      v.onloadedmetadata = v.ontimeupdate = v.onwaiting = v.onplaying = v.onended = v.onerror = null;
      v.removeAttribute('src');
      v.load();
      v.hidden = true;
    }
    if (st.mode === 'hls') Plex.lib.stopTranscode(st.session);
  }

  // Restart the stream at the current position, transcoded by Plex, optionally burning in a subtitle.
  function restartHls(burnStream) {
    teardown();
    st.mode = 'hls';
    st.base = st.pos;
    st.absolute = null;
    st.session = 'mq' + Date.now().toString(36);
    const extra = burnStream ? { subtitles: 'burn', subtitleStreamID: burnStream.id } : { subtitles: 'none' };
    // After a failed attempt, have Plex convert video and audio rather than pass either through.
    if (st.fullTranscode) Object.assign(extra, { directStream: 0, directStreamAudio: 0 });
    if (st.audio.current) extra.audioStreamID = st.audio.current.id;
    buffering(true);
    const session = st, id = st.session;
    Plex.startHls(st.meta, st.pos, id, extra).then(url => {
      // Skipped again, closed, or moved on while Plex was deciding: that start is stale.
      if (st === session && st.session === id) startStream(url, st.pos);
    }, e => { if (st === session && st.session === id) failed(e); });
  }

  function failed(e) {
    if (!st) return;
    if (st.mode === 'direct') {
      // The TV can't decode this file as-is: ask Plex to transcode from the current position.
      st.directFailed = true;
      toast('Converting this video on the server…', 3000);
      restartHls(st.subs.burn);
      return;
    }
    if (!st.fullTranscode) {
      st.fullTranscode = true;
      toast('Retrying with a full conversion…', 2500);
      restartHls(st.subs.burn);
      return;
    }
    toast('Playback failed: ' + ((e && (e.name || e.message)) || e));
    close();
  }

  function buffering(on) { $('spinner').hidden = !on; }

  function showOsd() {
    $('osd').classList.remove('hidden');
    $('player').classList.add('osd-open');
    clearTimeout(osdTimer);
    render();
    // The controls stay up while you're choosing among the buttons; otherwise they time out,
    // paused or not (the pause symbol stays on screen).
    // ...and while the mouse rests on them (PC).
    if (st && st.ui === 'scrub' && !nearBar) osdTimer = setTimeout(hideOsd, PC ? 3000 : 5000);
  }

  function hideOsd() {
    $('osd').classList.add('hidden');
    $('player').classList.remove('osd-open');
  }

  function render() {
    if (!st || $('osd').classList.contains('hidden')) return;
    const pos = st.target != null ? st.target : st.pos;
    const pct = st.duration ? Math.min(100, (pos / st.duration) * 100) : 0;
    $('osd-fill').style.width = pct + '%';
    $('osd-knob').style.left = pct + '%';
    $('osd-cur').textContent = fmt(pos);
    $('osd-end').textContent = '-' + fmt(st.duration - pos);
    const ends = new Date(Date.now() + Math.max(0, st.duration - pos));
    $('osd-ends').textContent = 'Ends at ' + ends.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // While skipping (or, on PC, pointing at the bar), show that moment's frame above the bar.
    const at = st.target != null ? st.target : st.hover;
    const atPct = at != null && st.duration ? Math.min(100, (at / st.duration) * 100) : pct;
    const thumb = $('osd-thumb'), src = at != null ? bifImage(at) : null;
    thumb.hidden = !src;
    if (src) {
      thumb.style.left = Math.min(92, Math.max(8, atPct)) + '%';
      const img = thumb.firstElementChild;
      if (img.getAttribute('src') !== src) img.src = src;
    }
    const tip = $('osd-tip');
    tip.hidden = st.hover == null;
    if (!tip.hidden) {
      tip.textContent = fmt(st.hover);
      tip.style.left = (src ? Math.min(92, Math.max(8, atPct)) : atPct) + '%';
    }
  }

  // ---------------------------------------------------------------- preview thumbnails

  // Plex's video preview thumbnails come as one BIF file per video: a header, an index of
  // (frame number, byte offset) pairs, then JPEGs back to back. Loaded on the first skip.
  async function loadBif() {
    if (st.bif !== undefined) return;
    st.bif = null;
    if (!st.part.indexes) return;
    const session = st;
    try {
      const res = await fetch(Plex.url(`/library/parts/${st.part.id}/indexes/sd`));
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const v = new DataView(buf);
      const count = v.getUint32(12, true);
      const stamps = [], offsets = [];
      for (let i = 0; i <= count; i++) { stamps.push(v.getUint32(64 + i * 8, true)); offsets.push(v.getUint32(68 + i * 8, true)); }
      if (count < 2) return;
      // Each frame's time is its stamp × the header's spacing. That spacing is often missing (0)
      // or not in milliseconds, which put the pictures far out of step deeper into a film. Trust
      // it only if the frames then span the film's length; otherwise spread them evenly over it.
      const last = stamps[count - 1], dur = session.duration;
      let per = v.getUint32(16, true) || 1000;
      if (dur && last && Math.abs(last * per - dur) > dur * 0.15) per = dur / (last + 1);
      if (st === session) { st.bif = { buf, offsets, stamps: stamps.slice(0, count), per, urls: {} }; render(); }
    } catch (e) {}
  }

  function bifImage(ms) {
    const b = st.bif;
    if (!b) return null;
    // The last frame that starts at or before `ms` (stamps ascend), found by binary search.
    let lo = 0, hi = b.stamps.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.stamps[mid] * b.per <= ms) lo = mid; else hi = mid - 1; }
    const i = lo;
    if (!b.urls[i]) {
      const bytes = new Uint8Array(b.buf, b.offsets[i], b.offsets[i + 1] - b.offsets[i]);
      b.urls[i] = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    }
    return b.urls[i];
  }

  function togglePause() {
    const target = av || $('video');
    try { st.paused ? target.play() : target.pause(); } catch (e) {}
    st.paused = !st.paused;
    st.posAt = Date.now();
    $('osd-paused').hidden = !st.paused;
    $('pause-veil').hidden = !st.paused;
    const pp = $('osd-controls').querySelector('[data-id="playpause"]');
    if (pp) pp.innerHTML = (st.paused ? ICON.resume : ICON.playpause) + `<span>${st.paused ? 'Play' : 'Pause'}</span>`;
    report(st.paused ? 'paused' : 'playing');
    showOsd();
  }

  // Presses add up (three Rights = +90s) and the seek happens once they stop.
  function seekBy(delta) {
    loadBif();
    if (st.target == null) st.target = st.pos;
    st.target = Math.max(0, Math.min(st.duration - 5000, st.target + delta));
    showOsd();
    clearTimeout(seekTimer);
    // With preview thumbnails there's something to look at: give it a moment longer.
    seekTimer = setTimeout(applySeek, st.bif ? 1200 : 700);
  }

  function applySeek() {
    if (!st || st.target == null) return;
    const t = st.target;
    st.target = null;
    setPos(t);
    if (st.mode === 'hls') return restartHls(st.subs.burn);
    buffering(true);
    watchStart();
    if (av) av.seekTo(t, () => buffering(false), () => buffering(false));
    else $('video').currentTime = t / 1000;
  }

  // ---------------------------------------------------------------- subtitles

  const streamLabel = s => s.extendedDisplayTitle || s.displayTitle || s.language || 'Subtitle';

  const subName = () => { const c = st.subs.current; return c ? (c.label || streamLabel(c)) : 'Off'; };

  // The Subtitles button shows what's on.
  function subLabel() {
    const b = st && $('osd-controls').querySelector('[data-id="subs"] small');
    if (b) b.textContent = subName() === 'Off' ? 'Off' : 'On';
  }

  // Asks the app to show its picker panel (the player has no UI of its own for lists).
  function pick(title, options, current, onPick) {
    document.dispatchEvent(new CustomEvent('app:pick', { detail: { title, options, current, onPick } }));
  }

  function stopNative() {
    if (!st.subs.native) return;
    st.subs.native = null;
    if (av) { try { av.setSilentSubtitle(true); } catch (e) {} }
  }

  // `choice` is a Plex stream, a downloaded subtitle ({ label, text }), or null for off.
  async function applySub(choice, remember) {
    const session = st;
    Subs.clear();
    stopNative();
    const wasBurning = st.subs.burn;
    st.subs.burn = null;
    st.subs.current = choice;
    subLabel();
    if (remember && (!choice || choice.id)) Plex.lib.selectSub(st.part.id, choice && choice.id).catch(() => {});

    if (!choice) {
      // Burned-in subtitles live in the picture: switch back to the clean stream.
      if (wasBurning) st.directFailed ? restartHls(null) : restartDirect();
      return;
    }
    try {
      if (choice.text != null) {
        Subs.load(Subs.parse(choice.text, choice.format));
      } else if (choice.key) {
        const text = await Plex.lib.subText(choice);
        if (st !== session || st.subs.current !== choice) return;
        Subs.load(Subs.parse(text, choice.codec));
      } else if (av && TEXT_CODECS.indexOf(choice.codec) >= 0) {
        st.subs.native = choice;
        if (st.prepared) selectNative();
      } else {
        // Picture-based (PGS, VobSub), or an embedded track a desktop browser can't read.
        st.subs.burn = choice;
        if (remember) await Plex.lib.selectSub(st.part.id, choice.id).catch(() => {});
        restartHls(choice);
      }
      if (wasBurning && !st.subs.burn) st.directFailed ? restartHls(null) : restartDirect();
    } catch (e) {
      toast("Couldn't load that subtitle: " + e.message);
    }
  }

  function restartDirect() {
    teardown();
    st.mode = 'direct';
    st.base = 0;
    startStream(Plex.url(st.part.key), st.pos);
  }

  // Embedded text track decoded by AVPlay: find it by its order among the file's embedded tracks.
  function selectNative() {
    const choice = st.subs.native;
    if (!choice) return;
    try {
      const tracks = av.getTotalTrackInfo().filter(t => t.type === 'TEXT');
      const embedded = st.subs.streams.filter(s => !s.key);
      const track = tracks[embedded.indexOf(choice)];
      if (!track) throw new Error('track not found');
      av.setSelectTrack('TEXT', track.index);
      av.setSilentSubtitle(false);
    } catch (e) {
      st.subs.native = null;
      st.subs.burn = choice;
      restartHls(choice);
    }
  }

  function openSubMenu() {
    const s = st.subs;
    const options = [{ key: 'off', label: 'Off' }]
      .concat(s.streams.map(x => ({ key: 's' + x.id, label: streamLabel(x), choice: x })))
      .concat(s.extra.map(x => ({ key: x.key, label: x.label, choice: x })))
      .concat([{ key: 'search', label: `Search OpenSubtitles · ${Subs.langName(Subs.lang())}` }]);
    const c = s.current;
    const current = !c ? 'off' : c.id ? 's' + c.id : c.key;
    hideOsd();
    pick('Subtitles', options, current, o => {
      if (o.key === 'search') searchSubs();
      else applySub(o.choice || null, true);
    });
  }

  async function searchSubs() {
    const session = st, lang = Subs.lang();
    toast(`Searching OpenSubtitles for ${Subs.langName(lang)} subtitles…`, 2500);
    let options;
    try {
      if (Subs.enabled()) {
        const full = st.meta.Guid ? st.meta : await Plex.lib.meta(st.meta.ratingKey);
        const show = full.type === 'episode' ? await Plex.lib.meta(full.grandparentRatingKey).catch(() => null) : null;
        const found = await Subs.search(full, show, lang, (st.part.file || '').split(/[\\/]/).pop());
        options = found.slice(0, 40).map(r => ({
          key: 'os' + r.fileId, label: r.title + (r.hi ? ' (SDH)' : ''), os: r,
        }));
      } else {
        const found = await Plex.lib.searchSubs(st.meta.ratingKey, lang);
        found.sort((a, b) => (b.perfectMatch | 0) - (a.perfectMatch | 0) || (b.score | 0) - (a.score | 0));
        options = found.slice(0, 40).map(r => ({ key: 'px' + r.id, label: r.title || streamLabel(r), px: r }));
      }
    } catch (e) {
      return toast("Couldn't search OpenSubtitles: " + e.message, 5000);
    }
    if (st !== session) return;
    if (!options.length) return toast(`No ${Subs.langName(lang)} subtitles found for this title.`, 4000);
    pick(`OpenSubtitles · ${Subs.langName(lang)}`, options, null, o => (o.os ? downloadDirect(o) : downloadViaPlex(o.px)));
  }

  async function downloadDirect(o) {
    const session = st;
    toast('Downloading subtitle…', 2000);
    try {
      const text = await Subs.download(o.os.fileId);
      if (st !== session) return;
      const sub = { key: o.key, label: o.label, text, format: 'srt' };
      st.subs.extra.push(sub);
      applySub(sub, false);
      toast('Subtitles on', 1500);
    } catch (e) {
      toast("Couldn't download that subtitle: " + e.message, 5000);
    }
  }

  // Plex adds the subtitle to the title in the background; wait for it to appear.
  async function downloadViaPlex(result) {
    const session = st, rk = st.meta.ratingKey;
    const before = new Set(st.subs.streams.map(s => s.id));
    toast('Downloading subtitle through Plex…', 2500);
    try {
      await Plex.lib.downloadSub(rk, result.key);
      for (let i = 0; i < 8; i++) {
        await sleep(1500);
        if (st !== session) return;
        const streams = subStreams(await Plex.lib.meta(rk));
        const added = streams.find(s => !before.has(s.id));
        if (added) {
          st.subs.streams = streams;
          applySub(added, true);
          toast('Subtitles on', 1500);
          return;
        }
      }
    } catch (e) {}
    if (st === session) {
      toast("Plex couldn't download that subtitle. Its subtitle downloads may need Plex Pass; " +
        'add a free OpenSubtitles API key to js/config.js to search OpenSubtitles directly.', 8000);
    }
  }

  // ---------------------------------------------------------------- controls bar

  const ICON = {
    chapters: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="6" rx="1.5"/><rect x="14" y="5" width="7" height="6" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/></svg>',
    episodes: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    subs: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h7"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5v14M19 5L9 12l10 7z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M18 5v14M5 5l10 7-10 7z"/></svg>',
    back10: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/></svg>',
    playpause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    resume: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
    fwd30: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4"/></svg>',
  };
  const PC = !(window.tizen || /[?&]tv\b/.test(location.search));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The row of buttons under the progress bar. Down moves into it, Left/Right along it,
  // OK opens one, Up or Back leaves it.
  function buildControls() {
    // PC: the mouse has no remote, so it gets the transport buttons too.
    const list = PC ? [['back10', '−10s'], ['playpause', 'Pause'], ['fwd30', '+30s'], ['volume', volLabel()]] : [];
    if (st.meta.type === 'episode') list.push(['prev', 'Previous'], ['next', 'Next']);
    if (st.chapters.length > 1) list.push(['chapters', 'Chapters']);
    if (st.meta.type === 'episode') list.push(['episodes', 'Episodes']);
    list.push(['audio', 'Audio'], ['subs', 'Subtitles'], ['info', 'Info']);
    $('osd-controls').innerHTML = list.map(([id, label]) =>
      `<div class="ctl" data-id="${id}">${ICON[id]}<span>${label}</span>${id === 'subs' ? '<small>Off</small>' : ''}</div>`).join('');
    st.ctl = Math.max(0, list.findIndex(x => x[0] === 'subs')); // not Previous: OK there restarts the episode
    markCtl();
  }

  function markCtl() {
    const items = $('osd-controls').children;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('focused', st.ui === 'controls' && i === st.ctl);
  }

  function enterControls() { st.ui = 'controls'; showOsd(); markCtl(); }
  function leaveControls() { st.ui = 'scrub'; markCtl(); showOsd(); }

  function activateCtl() {
    const id = $('osd-controls').children[st.ctl].dataset.id;
    st.ui = 'scrub';
    markCtl();
    if (id === 'volume') { vol.muted = !vol.muted; applyVolume(); }
    else if (id === 'playpause') togglePause();
    else if (id === 'back10') seekBy(-10000);
    else if (id === 'fwd30') seekBy(30000);
    else if (id === 'prev') goPrevious();
    else if (id === 'next') goNext();
    else if (id === 'chapters') openChapters();
    else if (id === 'episodes') openEpisodes();
    else if (id === 'audio') { hideOsd(); openAudioMenu(); }
    else if (id === 'subs') openSubMenu();
    else { toggleInfo(); showOsd(); }
  }

  function controlsKey(k) {
    const n = $('osd-controls').children.length;
    if (k === 'left') { st.ctl = Math.max(0, st.ctl - 1); markCtl(); }
    else if (k === 'right') { st.ctl = Math.min(n - 1, st.ctl + 1); markCtl(); }
    else if (k === 'enter') activateCtl();
    else if (k === 'up') leaveControls();
    // Back closes the controls and the progress bar together, back to the picture.
    else if (k === 'back') { st.ui = 'scrub'; markCtl(); hideOsd(); }
    else return false;
    return true;
  }

  // Previous: more than 10 s in, restart this episode; within the first 10 s, play the one before.
  async function goPrevious() {
    const session = st;
    if (st.pos > 10000) { st.target = 0; clearTimeout(seekTimer); applySeek(); showOsd(); return; }
    const prev = await prevEpisode(st.meta).catch(() => null);
    if (st !== session) return;
    if (!prev) { toast('This is the first episode.'); return; }
    play(prev, 0, st.onClose).catch(err => toast(err.message));
  }

  async function goNext() {
    const session = st;
    const next = await nextEpisode(st.meta).catch(() => null);
    if (st !== session) return;
    if (!next) { toast('This is the last episode.'); return; }
    play(next, next.viewOffset || 0, st.onClose).catch(err => toast(err.message));
  }

  async function prevEpisode(m) {
    const eps = await Plex.lib.children(m.parentRatingKey);
    const i = eps.findIndex(e => e.ratingKey === m.ratingKey);
    if (i > 0) return eps[i - 1];
    const seasons = await Plex.lib.children(m.grandparentRatingKey);
    const prev = seasons[seasons.findIndex(s => s.ratingKey === m.parentRatingKey) - 1];
    if (!prev) return null;
    const pe = await Plex.lib.children(prev.ratingKey);
    return pe[pe.length - 1] || null;
  }

  // ---------------------------------------------------------------- chapters

  const chapterAt = ms => { let i = 0; st.chapters.forEach((c, j) => { if (c.startTimeOffset <= ms) i = j; }); return i; };

  // A strip of chapter thumbnails along the bottom; OK jumps to the chapter.
  function openChapters() {
    const track = $('ch-track');
    const now = chapterAt(st.pos);
    track.innerHTML = st.chapters.map((c, i) =>
      `<div class="ch${i === now ? ' current' : ''}"><div class="ch-img">${c.thumb ? `<img src="${esc(Plex.img(c.thumb, 320, 180))}" alt="">` : ''}</div>` +
      `<b>${esc(c.tag || 'Chapter ' + (i + 1))}</b><small>${fmt(c.startTimeOffset)}</small></div>`).join('');
    st.ui = 'chapters';
    st.chIdx = now;
    hideOsd();
    $('chapters').hidden = false;
    markChapter();
  }

  function markChapter() {
    const track = $('ch-track'), items = track.children;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('focused', i === st.chIdx);
    const stride = 344; // card width + gap
    const x = Math.max(0, Math.min(st.chIdx - 1, items.length - 5) * stride);
    track.style.transform = x ? `translateX(${-x}px)` : '';
  }

  function closeChapters() {
    $('chapters').hidden = true;
    st.ui = 'scrub';
  }

  function chaptersKey(k) {
    if (k === 'left') { st.chIdx = Math.max(0, st.chIdx - 1); markChapter(); }
    else if (k === 'right') { st.chIdx = Math.min(st.chapters.length - 1, st.chIdx + 1); markChapter(); }
    else if (k === 'enter') {
      const c = st.chapters[st.chIdx];
      closeChapters();
      st.target = c.startTimeOffset;
      clearTimeout(seekTimer);
      applySeek();
      showOsd();
    }
    else if (k === 'back' || k === 'up' || k === 'down') { closeChapters(); showOsd(); }
    return true;
  }

  // ---------------------------------------------------------------- episodes

  async function openEpisodes() {
    const session = st;
    hideOsd();
    const eps = await Plex.lib.children(st.meta.parentRatingKey).catch(() => []);
    if (st !== session || !eps.length) return;
    pick(`Season ${st.meta.parentIndex}`, eps.map(e => ({
      key: e.ratingKey, label: `${e.index}. ${e.title}${e.viewCount && !e.viewOffset ? '  ✓' : ''}`, ep: e,
    })), st.meta.ratingKey, o => {
      if (st && o.ep.ratingKey !== st.meta.ratingKey) play(o.ep, o.ep.viewOffset || 0, st.onClose).catch(err => toast(err.message));
    });
  }

  // ---------------------------------------------------------------- audio tracks

  function openAudioMenu() {
    const a = st.audio;
    if (!a.streams.length) return toast('This video has no audio track details.');
    pick('Audio', a.streams.map(s => ({ key: 's' + s.id, label: streamLabel(s), choice: s })),
      a.current ? 's' + a.current.id : null, o => applyAudio(o.choice));
  }

  async function applyAudio(stream) {
    const a = st.audio;
    if (stream === a.current) return;
    a.current = stream;
    // Remembered on the server, as Plex's own apps do; converted streams also read it.
    await Plex.lib.selectAudio(st.part.id, stream.id).catch(() => {});
    if (av && st.mode === 'direct') {
      a.native = stream;
      if (st.prepared) selectNativeAudio();
      return;
    }
    // A browser can't switch tracks inside a file: have Plex serve this track from here.
    if (st.mode === 'direct') st.directFailed = true;
    restartHls(st.subs.burn);
  }

  // The TV switches tracks itself: find this one by its order among the file's audio tracks.
  function selectNativeAudio() {
    const choice = st.audio.native;
    try {
      const tracks = av.getTotalTrackInfo().filter(t => t.type === 'AUDIO');
      const track = tracks[st.audio.streams.indexOf(choice)];
      if (!track) throw new Error('track not found');
      av.setSelectTrack('AUDIO', track.index);
    } catch (e) {
      st.audio.native = null;
      restartHls(st.subs.burn);
    }
  }

  // ---------------------------------------------------------------- playback info

  function toggleInfo() {
    const panel = $('info');
    panel.hidden = !panel.hidden;
    clearInterval(infoTimer);
    if (!panel.hidden) {
      renderInfo();
      infoTimer = setInterval(renderInfo, 2000);
    }
  }

  // How this video is reaching the screen: direct or converted (and what the server is
  // doing to it), plus the file's own formats. Refreshed every 2 s while open.
  async function renderInfo() {
    if (!st || $('info').hidden) return clearInterval(infoTimer);
    const media = st.meta.Media[0];
    const video = (st.part.Stream || []).find(s => s.streamType === 1) || {};
    const rows = [];
    const up = s => String(s || '').toUpperCase();
    let how = st.mode === 'direct' ? 'Direct play' : 'Converted by the server';
    if (st.mode === 'hls') {
      const ts = await Plex.api('/transcode/sessions').then(r => (r.TranscodeSession || []).find(t => t.key === st.session)).catch(() => null);
      if (!st || $('info').hidden) return;
      if (ts) {
        const part = d => (d === 'copy' ? 'passed through' : d === 'transcode' ? 'converted' : d || '?');
        how += ` · video ${part(ts.videoDecision)}, audio ${part(ts.audioDecision)}`;
        if (ts.speed != null) how += ` · ${Number(ts.speed).toFixed(1)}× speed${ts.throttled ? ' (ahead, resting)' : ''}`;
      }
    }
    rows.push(['Playback', how]);
    rows.push(['Player', av ? 'TV (AVPlay)' : (st.hls ? 'Browser + hls.js' : 'Browser')]);
    rows.push(['Video', [video.displayTitle || up(media.videoCodec), media.width && `${media.width}×${media.height}`,
      video.frameRate && `${Number(video.frameRate).toFixed(3).replace(/\.?0+$/, '')} fps`].filter(Boolean).join(' · ')]);
    rows.push(['Audio', st.audio.current ? streamLabel(st.audio.current) : up(media.audioCodec)]);
    rows.push(['Subtitles', subName() + (st.subs.burn ? ' (burned in)' : st.subs.native ? ' (TV decodes)' : '')]);
    rows.push(['File', [up(media.container), media.bitrate && `${(media.bitrate / 1000).toFixed(1)} Mbps`,
      (st.part.file || '').split(/[\\/]/).pop()].filter(Boolean).join(' · ')]);
    $('info').innerHTML = '<h3>Playback info</h3>' + rows.map(([k, v]) =>
      `<div class="row"><span>${k}</span><b>${String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</b></div>`).join('');
  }

  // ---------------------------------------------------------------- timeline & end

  function report(state) {
    if (!st) return;
    Plex.lib.timeline({
      ratingKey: st.meta.ratingKey,
      key: '/library/metadata/' + st.meta.ratingKey,
      state, time: Math.floor(st.pos), duration: st.duration,
    });
  }

  async function ended() {
    if (!st || st.ended) return;
    st.ended = true;
    st.pos = st.duration;
    report('stopped');
    Plex.lib.scrobble(st.meta.ratingKey).catch(() => {});
    // The credits' card was already counting down: go straight on.
    if (st.upNext && st.upLive && autoRun < STILL_WATCHING_AFTER) return playNext(true);
    const session = st;
    if (st.meta.type === 'episode') {
      const next = await nextEpisode(st.meta).catch(() => null);
      if (next && st === session) return upNext(next);
    }
    if (st === session) close();
  }

  async function nextEpisode(m) {
    const eps = await Plex.lib.children(m.parentRatingKey);
    const i = eps.findIndex(e => e.ratingKey === m.ratingKey);
    if (i >= 0 && eps[i + 1]) return eps[i + 1];
    const seasons = await Plex.lib.children(m.grandparentRatingKey);
    const next = seasons[seasons.findIndex(s => s.ratingKey === m.parentRatingKey) + 1];
    return next ? (await Plex.lib.children(next.ratingKey))[0] || null : null;
  }

  // Episode credits started: offer the next episode while they keep playing (Back keeps watching).
  async function creditsReached(m) {
    st.skipped.add(m);
    const session = st;
    const next = await nextEpisode(st.meta).catch(() => null);
    if (next && st === session && !st.upNext && !st.ended) upNext(next, true);
  }

  function dismissUpNext() {
    clearInterval(upTimer);
    st.upNext = null;
    st.upLive = false;
    $('upnext').hidden = true;
  }

  // `live`: shown over the credits with the video still playing; otherwise the video has ended.
  function upNext(next, live) {
    if (!live) { teardown(); Subs.clear(); }
    st.upNext = next;
    st.upLive = !!live;
    st.skip = null;
    $('skip').hidden = true;
    hideOsd();
    $('upnext-title').textContent = `S${next.parentIndex} E${next.index} · ${next.title}`;
    $('upnext').hidden = false;
    // Several episodes in a row with nobody touching the remote: ask before playing on.
    if (autoRun >= STILL_WATCHING_AFTER) {
      $('upnext-head').textContent = 'Are you still watching?';
      $('upnext-hint').textContent = PC ? 'Click to keep watching · Back (top right) to stop' : 'OK to keep watching · Back to stop';
      return;
    }
    let n = live ? 10 : 5;
    $('upnext-head').innerHTML = `Up next in <span id="upnext-count">${n}</span>`;
    $('upnext-hint').textContent = live
      ? (PC ? 'Click to play now · click the picture to keep watching' : 'OK to play now · Back to keep watching')
      : (PC ? 'Click to play now · Back (top right) to stop' : 'OK to play now · Back to stop');
    upTimer = setInterval(() => {
      $('upnext-count').textContent = --n;
      if (n <= 0) playNext(true);
    }, 1000);
  }

  function playNext(auto) {
    clearInterval(upTimer);
    autoRun = auto ? autoRun + 1 : 0;
    const next = st.upNext, cb = st.onClose;
    play(next, next.viewOffset || 0, cb, true).catch(err => { toast(err.message); if (cb) cb(); });
  }

  function close(silent) {
    if (!st) return;
    clearInterval(tlTimer); clearTimeout(osdTimer); clearTimeout(seekTimer); clearInterval(upTimer); clearInterval(subTimer);
    clearTimeout(st.watchdog);
    clearInterval(infoTimer);
    if (!st.ended) report('stopped');
    if (!st.upNext) teardown();
    if (st.bif) for (const u of Object.values(st.bif.urls)) URL.revokeObjectURL(u);
    const cb = st.onClose;
    st = null;
    Subs.clear();
    document.documentElement.classList.remove('playing');
    $('player').classList.remove('osd-open');
    $('upnext').hidden = true;
    $('skip').hidden = true;
    $('info').hidden = true;
    $('osd-thumb').hidden = true;
    $('chapters').hidden = true;
    $('pause-veil').hidden = true;
    buffering(false);
    if (!silent && cb) cb();
  }

  function key(k) {
    if (st.upNext) {
      if (k === 'enter' || k === 'play' || k === 'playpause') playNext(false);
      else if (k === 'back' && st.upLive) { autoRun = 0; dismissUpNext(); }
      else if (k === 'back' || k === 'stop') close();
      return;
    }
    autoRun = 0; // someone is at the remote
    if (st.ui === 'chapters') return chaptersKey(k);
    if (st.ui === 'controls') {
      if ($('osd').classList.contains('hidden')) st.ui = 'scrub';
      else if (controlsKey(k)) return;
    }
    if (st.skip && k === 'enter') return doSkip();
    if (k === 'info') return toggleInfo();
    if (k === 'back' && !$('info').hidden) return toggleInfo();
    switch (k) {
      case 'enter': case 'playpause': togglePause(); break;
      case 'play': if (st.paused) togglePause(); break;
      case 'pause': if (!st.paused) togglePause(); break;
      case 'left': case 'rew': seekBy(-10000); break;
      case 'right': case 'ff': seekBy(30000); break;
      case 'up': showOsd(); break;
      // First Down just shows the progress bar; Down again moves into the buttons.
      case 'down': if ($('osd').classList.contains('hidden')) showOsd(); else enterControls(); break;
      case 'subs': openSubMenu(); break;
      // Back leaves the video, as on Netflix and Disney+ (from the buttons row it first closes them).
      case 'back': close(); break;
      case 'stop': close(); break;
    }
  }

  // Mouse (PC): moving it shows the controls (they stay while it's over them), clicking the
  // picture pauses or plays, clicking the progress bar jumps there, clicking a button presses it.
  // The controls open only with the pointer on the progress bar or the buttons below it;
  // elsewhere a moving pointer just shows itself (and Back / Full screen) for a moment.
  function pointerAt(near) {
    const was = nearBar;
    nearBar = near;
    // Entering shows the controls; leaving starts their hide timer.
    if (st && !st.upNext && st.ui === 'scrub' && (near || (was && !$('osd').classList.contains('hidden')))) showOsd();
  }
  $('player').addEventListener('mousemove', e => {
    $('player').classList.add('mouse-on');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => $('player').classList.remove('mouse-on'), 2500);
    pointerAt(e.clientY >= $('osd').querySelector('.bar').getBoundingClientRect().top - 40);
  });
  $('player').addEventListener('mouseleave', () => pointerAt(false));
  $('player').addEventListener('click', e => {
    if (!st) return;
    autoRun = 0; // someone is at the mouse
    if (st.upNext) {
      if (e.target.closest('#upnext')) return playNext(false);
      if (!st.upLive) return;
      return dismissUpNext(); // over the credits: a click on the picture keeps watching them
    }
    if (st.ui === 'chapters') {
      const ch = e.target.closest('.ch');
      if (ch) { st.chIdx = Array.prototype.indexOf.call(ch.parentElement.children, ch); chaptersKey('enter'); }
      else { closeChapters(); showOsd(); }
      return;
    }
    const bar = e.target.closest('.bar'), btn = e.target.closest('#osd-controls > *');
    if (bar && st.duration) {
      const r = bar.getBoundingClientRect();
      st.target = Math.max(0, Math.min(st.duration - 5000, (e.clientX - r.left) / r.width * st.duration));
      clearTimeout(seekTimer);
      showOsd();
      applySeek();
    } else if (btn) {
      e.stopPropagation(); // else the app's page-wide click closes the menu this opens (Subtitles, Audio)
      st.ctl = Array.prototype.indexOf.call(btn.parentElement.children, btn);
      activateCtl();
    } else if (e.target.closest('#skip')) doSkip();
    else if (e.target.closest('#info')) toggleInfo(); // clicking the panel closes it
    else if (!e.target.closest('#osd, #chapters')) {
      // PC: wait a moment, so a double-click (full screen) doesn't also pause and resume.
      if (!PC) return togglePause();
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { if (st) togglePause(); }, 250);
    }
  });

  let clickTimer;
  $('player').addEventListener('dblclick', e => {
    if (!PC || !st || e.target.closest('#osd, #chapters, #info, #upnext, #skip')) return;
    clearTimeout(clickTimer);
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  });

  // PC: pointing at the progress bar shows that moment's time (and preview picture).
  const bar = $('osd').querySelector('.bar');
  bar.addEventListener('mousemove', e => {
    if (!st || !st.duration) return;
    const r = bar.getBoundingClientRect();
    st.hover = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.duration;
    loadBif();
    render();
  });
  bar.addEventListener('mouseleave', () => { if (st) { st.hover = null; render(); } });

  // PC volume: the Volume button mutes; the wheel over it sets the level. Remembered between videos.
  const vol = { level: 1, muted: false };
  try { const v = JSON.parse(localStorage.getItem('mq.volume') || 'null'); if (v) Object.assign(vol, v); } catch (e) {}
  function volLabel() { return vol.muted || !vol.level ? 'Muted' : Math.round(vol.level * 100) + '%'; }
  function applyVolume() {
    if (av) return; // the TV's own remote sets its volume
    const v = $('video');
    v.volume = vol.level;
    v.muted = vol.muted;
    const b = $('osd-controls').querySelector('[data-id="volume"] span');
    if (b) b.textContent = volLabel();
    try { localStorage.setItem('mq.volume', JSON.stringify(vol)); } catch (e) {}
  }
  $('osd-controls').addEventListener('wheel', e => {
    if (!e.target.closest('[data-id="volume"]')) return;
    e.preventDefault();
    vol.level = Math.max(0, Math.min(1, Math.round((vol.level + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    vol.muted = false;
    applyVolume();
    showOsd();
  }, { passive: false });

  // PC: the wheel moves along the chapter strip (chapters past the screen edge are reachable).
  $('chapters').addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    if (d && st && st.ui === 'chapters') chaptersKey(d > 0 ? 'right' : 'left');
  }, { passive: false });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !PC && st && !st.paused && !st.upNext) togglePause(); // TV: the app went to the background
  });

  // Window closed or app exited mid-video: stop the server's conversion now rather than
  // leaving it running until Plex times it out.
  addEventListener('pagehide', () => {
    if (st && st.mode === 'hls') Plex.lib.stopTranscode(st.session, true);
  });

  function toast(msg, ms) { document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg, ms } })); }

  return { play, key, active, close };
})();
