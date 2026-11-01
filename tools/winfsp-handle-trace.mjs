// Exact native handle trace audit; no mount, state mutation or guessed release.
// node tools/winfsp-handle-trace.mjs <result.json> [--self-test]
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function auditTrace(stdout) {
  assert.doesNotMatch(stdout, /NATIVE_HANDLE_TRACE_SATURATED/);
  const traceLines = stdout.split(/\r?\n/).filter(l => l.startsWith('NATIVE_HANDLE '));
  assert.ok(traceLines.length > 0 && traceLines.length <= 20000, 'complete bounded trace required');
  const events =
      traceLines
          .map(line => {
            const m =
                /^NATIVE_HANDLE event=(open|create|cleanup|close) seq=(\d+) tick=(\d+) handle=(\d+) serial=(\d+) flags=([0-9a-f]{8}) name=(.+)$/
                    .exec(line);
            assert.ok(m, 'invalid event record');
            return {
              event: m[1],
              seq: Number(m[2]),
              tick: Number(m[3]),
              handle: m[4],
              serial: m[5],
              flags: m[6],
              name: m[7]
            };
          })
          .sort((a, b) => a.seq - b.seq);
  const handles = new Map();
  let cleaned = 0, closed = 0;
  for (const [i, e] of events.entries()) {
    assert.equal(e.seq, i + 1, 'missing or duplicate event');
    assert.ok(Number.isSafeInteger(e.tick) && e.tick >= 0);
    if (e.event === 'open' || e.event === 'create') {
      assert.ok(!handles.has(e.handle), 'reused native token');
      assert.notEqual(e.name, '-');
      handles.set(e.handle, {open: e, cleanup: null, close: null});
    } else {
      const h = handles.get(e.handle);
      assert.ok(h, 'event without open');
      assert.equal(e.serial, h.open.serial, 'foreign serial');
      assert.ok(e.tick >= h.open.tick, 'event predates open');
      if (e.event === 'cleanup') {
        assert.equal(h.cleanup, null, 'duplicate Cleanup');
        assert.equal(h.close, null, 'Cleanup after Close');
        h.cleanup = e;
        cleaned++;
      } else {
        assert.ok(h.cleanup, 'Close without Cleanup');
        assert.equal(h.close, null, 'duplicate Close');
        assert.ok(e.tick >= h.cleanup.tick, 'Close predates Cleanup');
        assert.equal(e.flags, '00000000', 'Close failed');
        h.close = e;
        closed++;
      }
    }
  }
  const states = [
    ...stdout.matchAll(
        /NORMAL_CLOSE_OBSERVED files=(\d+) directories=(\d+) commit=(\d+) capture=(\d+) retained=(\d+) prepared=(\d+) cleanup=(\d+) close=(\d+)/g)
  ].map(m => m.slice(1).map(Number));
  assert.ok(states.length, 'missing close inventory');
  const state = states.at(-1);
  assert.deepEqual(state.slice(2, 6), [0, 0, 0, 0], 'control ownership is not idle');
  const outstanding = [...handles.values()].filter(h => !h.close);
  assert.equal(state[0] + state[1], outstanding.length, 'inventory and exact tokens disagree');
  assert.equal(state[6], cleaned);
  assert.equal(state[7], closed);
  for (const h of outstanding) assert.ok(h.cleanup, 'application handle still open');
  const normal = stdout.includes('NORMAL_CLOSE_DONE detach=true overlay_closed=true');
  if (normal) {
    assert.equal(outstanding.length, 0);
    const stages = [
      'NORMAL_CLOSE_PREPARED ', 'NORMAL_CLOSE_STOP_BEGIN ', 'NORMAL_CLOSE_DISPATCHER_DRAINED',
      'OVERLAY_CLOSED ', 'NORMAL_CLOSE_DONE '
    ];
    let previous = -1;
    for (const marker of stages) {
      const at = stdout.indexOf(marker);
      assert.ok(at > previous, 'normal close ordering');
      assert.equal(stdout.indexOf(marker, at + marker.length), -1, 'duplicate terminal event');
      previous = at;
    }
    assert.match(stdout, /CALLBACKS .*errors=0/);
  } else {
    assert.ok(outstanding.length > 0);
    assert.doesNotMatch(stdout, /NORMAL_CLOSE_PREPARED|NORMAL_CLOSE_STOP_BEGIN|OVERLAY_CLOSED/);
  }
  return {
    events: events.length,
    opened: handles.size,
    cleaned,
    closed,
    normal_close: normal,
    outstanding
  };
}
export function auditReceipt(raw) {
  const providers = raw.providers ?? raw.cases;
  assert.ok(Array.isArray(providers) && providers.length);
  return providers.map(p => {
    assert.equal(p.error, null);
    if ('deadline_expired' in p)
      assert.equal(p.deadline_expired, false, 'host deadline is not an observation');
    if ('failure' in p) assert.equal(p.failure, null);
    const start = Date.parse(p.started), end = Date.parse(p.finished);
    assert.ok(
        Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 120000,
        'bounded provider time');
    const proof = auditTrace(p.stdout);
    if (proof.normal_close) {
      assert.equal(p.exit.code, 0);
      assert.equal(p.exit.signal, null);
    } else {
      assert.ok(
          typeof p.exit.signal === 'string' && p.exit.signal.length > 0 ||
              Number.isInteger(p.exit.code) && p.exit.code !== 0,
          'retained arm requires explicit abnormal termination');
    }
    if (p.application) {
      assert.equal(p.application.exit, 0);
      assert.equal(p.application.signal, null);
      assert.equal(p.application.error, null);
      const expected = p.mode === 'read' ?
          /MAPPING_LIFETIME mode=read byte=\d+ file_closed=true/ :
          new RegExp(
              'MAPPING_LIFETIME mode=' + p.mode +
              ' view_unmapped=true file_closed=true no_flush=true');
      assert.match(p.application.stdout, expected);
      assert.equal(p.normal_close, proof.normal_close);
      assert.equal(p.busy, !proof.normal_close);
      if (p.busy) {
        assert.match(p.stdout, /NORMAL_CLOSE_REFUSED request=stop service_kept=true/);
        assert.match(p.stderr, /OVERLAY_REFUSAL 80000011/);
      }
    }
    return {provider: p.name ?? p.mode, started: p.started, finished: p.finished, ...proof};
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const result = auditReceipt(raw);
  if (process.argv[3] === '--self-test') {
    console.log('PASS complete retained handle receipt');
    const normal = (raw.providers ?? raw.cases).find(p => p.stdout.includes('NORMAL_CLOSE_DONE'));
    const pending = (raw.providers ?? raw.cases).find(p => !p.stdout.includes('NORMAL_CLOSE_DONE'));
    assert.ok(normal && pending, 'need completed and retained arms');
    const tests = [
      ['missing event', normal.stdout.replace(/^NATIVE_HANDLE event=open .*\r?\n/m, '')],
      ['duplicate sequence', normal.stdout.replace('seq=2 ', 'seq=1 ')],
      [
        'foreign serial',
        normal.stdout.replace(/(event=cleanup[^\n]*serial=)\d+/, (_, prefix) => prefix + '99999')
      ],
      ['Close before Cleanup', normal.stdout.replace('event=cleanup', 'event=close')],
      ['failed Close', normal.stdout.replace(/(event=close[^\n]*flags=)00000000/, '$1c0000001')],
      [
        'false inventory',
        pending.stdout.replace(/NORMAL_CLOSE_OBSERVED files=\d+/, 'NORMAL_CLOSE_OBSERVED files=0')
      ],
      [
        'invented completion',
        pending.stdout + '\nNORMAL_CLOSE_DONE detach=true overlay_closed=true\n'
      ],
      ['saturated trace', normal.stdout + '\nNATIVE_HANDLE_TRACE_SATURATED limit=20000\n'],
    ];
    for (const [name, body] of tests) {
      assert.throws(() => auditTrace(body), name);
      console.log('PASS reject ' + name);
    }
    for (const [name, change] of [
             ['retained result promoted to normal exit', p => p.exit = {code: 0, signal: null}],
             ['missing process outcome', p => p.exit = {code: null, signal: null}],
             ['deadline disguised as observation', p => p.deadline_expired = true],
             ['invalid time', p => p.finished = 'invalid'],
    ]) {
      const altered = structuredClone(raw);
      change(
          (altered.providers ?? altered.cases).find(p => !p.stdout.includes('NORMAL_CLOSE_DONE')));
      assert.throws(() => auditReceipt(altered), name);
      console.log('PASS reject ' + name);
    }
  } else
    console.log(JSON.stringify(result, null, 2));
}
