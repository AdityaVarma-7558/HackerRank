'use strict';
const assert = require('assert');

async function crashAfter(ws, initial, keyStr) {
  const s = ws.live({ initial });
  await s.waitForSwap();
  s.send(keyStr);
  await s.waitSwapQuiet();
  await s.kill();
  assert.ok(ws.swapExists(), 'the swap file must survive a SIGKILL');
}

module.exports = {
  checks: {
    'CRASH-RECOVER': async (ws) => {
      await crashAfter(ws, 'initial\n', 'A_crash<Esc>');
      assert.strictEqual(ws.read(), 'initial\n', 'the file on disk must be untouched by the crash');
      const r = ws.run({ recover: true, keys: ':wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'initial_crash\n');
    },

    'CRASH-MID-INSERT': async (ws) => {
      await crashAfter(ws, 'initial\n', 'Axy');
      const r = ws.run({ recover: true, keys: ':wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'initialxy\n', 'after recovery the editor must be in Normal mode');
    },

    'CRASH-COMPLEX-EDITS': async (ws) => {
      await crashAfter(ws, 'a\nb\nc\n', 'ddGpix<Esc>uggOnew<Esc>Gdd');
      const r = ws.run({ recover: true, keys: ':wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'new\nb\nc\n');
    },

    'CRASH-AFTER-SAVE': async (ws) => {
      await crashAfter(ws, 'a\n', 'A1<Esc>:w<Enter>A2<Esc>');
      assert.strictEqual(ws.read(), 'a1\n');
      const r = ws.run({ recover: true, keys: ':wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'a12\n', 'edits saved before the crash must not be applied a second time');
    },

    'CRASH-RECOVERED-IS-DIRTY': async (ws) => {
      await crashAfter(ws, 'a\n', 'A1<Esc>');
      const r = ws.run({ recover: true, keys: '' });
      assert.ok(r.report, 'no report file was written');
      assert.strictEqual(r.report.finalContent, 'a1');
      assert.strictEqual(r.report.isDirty, true);
      const q = ws.run({ recover: true, keys: ':q<Enter>' });
      assert.strictEqual(q.exitCode, 1, 'recovered unsaved edits must block :q');
    },

    'CRASH-RECOVER-TWICE': async (ws) => {
      await crashAfter(ws, 'a\n', 'A1<Esc>');
      const s = ws.live({ recover: true });
      await s.waitForSwap();
      s.send('A2<Esc>');
      await s.waitSwapQuiet();
      await s.kill();
      const r = ws.run({ recover: true, keys: ':wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'a12\n', 'a second crash after recovery must still be recoverable');
    },
  },
};
