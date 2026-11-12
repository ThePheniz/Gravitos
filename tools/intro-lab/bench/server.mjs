// Results listener for the on-TV bench. The bench app POSTs one JSON record per test to /r.
//   node server.mjs [--port 18765] [--out results.ndjson] [--timeout 1200]
//   node server.mjs --summary results.ndjson      (re-print a summary of an earlier run)
// Exits after the bench posts {type:'end'} (code 0) or on timeout (code 2).
import http from 'node:http';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

export function summary(recs) {
  const L = [], pad = (s, n) => String(s ?? '').padEnd(n), num = (x, n = 7) => String(x ?? '-').padStart(n);
  const caps = recs.find(r => r.type === 'caps')?.caps, ref = recs.find(r => r.type === 'refresh');
  if (caps) {
    L.push('== TV', `UA: ${caps.ua}`, `GPU: ${caps.unmaskedRenderer || caps.RENDERER} | ${caps.VERSION} | webgl2 ${caps.webgl2}`,
      `screen ${caps.screen} inner ${caps.inner} dpr ${caps.dpr} cores ${caps.cores} | MAX_TEXTURE_SIZE ${caps.MAX_TEXTURE_SIZE}`,
      `frag highp ${JSON.stringify(caps.precision?.fragHigh)} probe ${JSON.stringify(caps.highpProbe)} | half-float target: ${caps.halfFloatTarget} | float target: ${caps.floatTarget}`,
      `worker: ${JSON.stringify(caps.worker)}`);
  }
  if (ref) L.push(`refresh: ${ref.hz} Hz (${ref.periodMs} ms)`);
  const syn = recs.filter(r => r.type === 'synth');
  if (syn.length) {
    L.push('', '== synthetic, OffscreenCanvas worker unless noted (avg / p95 / max ms between frames, dropped %, gpu = median GPU ms/frame from timer queries)', pad('test', 44) + num('avg') + num('p95') + num('max') + num('drop%') + num('gpu') + num('setup'));
    for (const r of syn) {
      const s = r.spec, d = s.kind === 'alu' ? `alu n=${s.n}` : s.kind === 'tex' ? `tex${s.dep ? 'dep' : ''} n=${s.n}` : s.kind === 'bloom' ? `bloom ${s.fmt}${s.gl2 ? ' gl2' : ''}${s.levels ? ' L' + s.levels : ''}` : `parts ${s.count} r=${s.size}px`;
      const name = `${d} @${s.w}x${s.h}${s.where ? ' ' + s.where : ''}${s.busy ? '+busy' : ''}`;
      if (r.skipped) { L.push(pad(name, 44) + '  skipped (too slow)'); continue; }
      if (r.err) { L.push(pad(name, 44) + '  ERR ' + r.err); continue; }
      const t = r.stats; L.push(pad(name, 44) + num(t.avg) + num(t.p95) + num(t.max) + num(t.drop) + num(r.gpu) + num(Math.round(r.setupMs)));
    }
  }
  const ren = recs.filter(r => r.type === 'renderer');
  if (ren.length) {
    L.push('', '== renderers (whole timeline avg/p95/max ms, dropped %; per-beat dropped %; setup = start() ms; js = JS ms/frame; gpu/gpu95 = GPU ms/frame median/p95; first = ms to first frame; main = main-thread rAF drop%)',
      pad('renderer / mode', 34) + num('avg') + num('p95') + num('max') + num('drop%') + num('open') + num('bend') + num('rest') + num('exit') + num('setup') + num('js') + num('gpu') + num('gpu95') + num('first') + num('main'));
    for (const r of ren) {
      const name = `${r.name} ${r.mode}`;
      if (r.err) { L.push(pad(name, 34) + '  ERR ' + r.err); continue; }
      const b = r.beats, a = b.all || {};
      L.push(pad(name, 34) + num(a.avg) + num(a.p95) + num(a.max) + num(a.drop) + num(b.open?.drop) + num(b.bend?.drop) + num(b.rest?.drop) + num(b.exit?.drop)
        + num(r.setupMs == null ? '-' : Math.round(r.setupMs)) + num(r.cpu) + num(r.gpu) + num(r.gpuP95) + num(r.firstMs) + num(r.main?.drop) + (r.timeout ? '  (timeout)' : ''));
    }
  }
  recs.filter(r => r.type === 'error').forEach(r => L.push('page error: ' + r.msg + ' ' + r.src + ':' + r.l));
  return L.join('\n');
}

const sumFile = arg('summary');
if (sumFile) {
  console.log(summary(fs.readFileSync(sumFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))));
} else if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const port = +arg('port', 18765), out = arg('out', 'results.ndjson'), recs = [];
  fs.writeFileSync(out, '');
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'POST') return res.end('gravbench listener');
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      res.end('ok');
      let r; try { r = JSON.parse(body); } catch { return; }
      recs.push(r);
      fs.appendFileSync(out, JSON.stringify(r) + '\n');
      if (r.type === 'progress') return;
      const s = r.stats || r.beats?.all;
      console.log(`[tv] ${r.type} ${r.name || ''} ${r.mode || ''} ${r.spec ? JSON.stringify(r.spec) : ''} ${s ? `avg ${s.avg} p95 ${s.p95} drop ${s.drop}%` : ''} ${r.err || r.skipped || ''}`);
      if (r.type === 'end') { console.log('\n' + summary(recs) + `\n\nraw: ${out}`); srv.close(); process.exit(0); }
    });
  });
  srv.listen(port, '0.0.0.0', () => console.log(`listening on :${port} -> ${out}`));
  setTimeout(() => { console.log('TIMEOUT waiting for the TV\n' + summary(recs)); process.exit(2); }, +arg('timeout', 1200) * 1000);
}
