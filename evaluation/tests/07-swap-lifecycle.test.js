'use strict';
const assert = require('assert');

module.exports = {
  checks: {
    'SWAP-NAMING': async (ws) => {
      const s = ws.live({ file: 'notes.txt', initial: 'x\n' });
      await s.waitForSwap();
      assert.ok(ws.swapExists('notes.txt'), 'expected .notes.txt.swp next to notes.txt');
      s.send('ihi<Esc>');
      await s.waitSwapQuiet();
      assert.ok(ws.swapExists('notes.txt'), 'the swap file must remain while the session is open');
      await s.kill();
    },

    'SWAP-DELETED-WQ': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.swapExists, false, 'swap file must be deleted after :wq');
    },

    'SWAP-DELETED-CLEAN-Q': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: ':q<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.swapExists, false, 'swap file must be deleted after a clean :q');
    },

    'SWAP-DELETED-FORCE-Q': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:q!<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.swapExists, false, 'swap file must be deleted after :q!');
    },

    'SWAP-KEPT-ON-REFUSED-QUIT': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:q<Enter>' });
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.strictEqual(r.swapExists, true, 'a refused :q must leave the swap file in place');
    },

    'SWAP-STALE-IGNORED': async (ws) => {
      const s = ws.live({ initial: 'a\n' });
      await s.waitForSwap();
      s.send('Axyz<Esc>');
      await s.waitSwapQuiet();
      await s.kill();
      assert.ok(ws.swapExists(), 'precondition: a leftover swap file exists');

      const r = ws.run({ keys: '' });
      assert.ok(r.report, 'no report file was written');
      assert.strictEqual(r.report.finalContent, 'a', 'without --recover the leftover swap must not be replayed');
      assert.strictEqual(r.report.isDirty, false, 'opening a file must not start dirty');

      const q = ws.run({ keys: ':q<Enter>' });
      assert.strictEqual(q.exitCode, 0, `expected exit code 0, got ${q.exitCode}`);
      assert.strictEqual(q.swapExists, false);

      const again = ws.run({ recover: true, keys: '' });
      assert.strictEqual(again.report.finalContent, 'a', '--recover with no swap file must open the file unchanged');
      assert.strictEqual(again.report.isDirty, false);
    },
  },
};
