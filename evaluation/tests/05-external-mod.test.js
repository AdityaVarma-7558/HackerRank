'use strict';
const assert = require('assert');
const fs = require('fs');

async function openWithPendingEdit(ws, initial) {
  const s = ws.live({ initial });
  await s.waitForSwap();
  s.send('ix<Esc>');
  return s;
}

module.exports = {
  checks: {
    'EXT-REFUSE': async (ws) => {
      const s = await openWithPendingEdit(ws, 'initial\n');
      ws.write('f.txt', 'changed by another process\n');
      s.send(':w<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.ok(r.stderr.toLowerCase().includes('modified'), `stderr must contain "modified", got: ${r.stderr.trim()}`);
      assert.strictEqual(ws.read(), 'changed by another process\n', 'the external change must not be overwritten');
    },

    'EXT-FORCE': async (ws) => {
      const s = await openWithPendingEdit(ws, 'initial\n');
      ws.write('f.txt', 'changed by another process\n');
      s.send(':w!<Enter>:q<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(ws.read(), 'xinitial\n', ':w! must overwrite with the buffer contents');
    },

    'EXT-WQ-REFUSE': async (ws) => {
      const s = await openWithPendingEdit(ws, 'initial\n');
      ws.write('f.txt', 'changed by another process\n');
      s.send(':wq<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.ok(r.stderr.toLowerCase().includes('modified'), `stderr must contain "modified", got: ${r.stderr.trim()}`);
      assert.strictEqual(ws.read(), 'changed by another process\n');
    },

    'EXT-SAME-CONTENT-OK': async (ws) => {
      const s = await openWithPendingEdit(ws, 'initial\n');
      ws.write('f.txt', 'initial\n');
      const future = new Date(Date.now() + 60000);
      fs.utimesSync(ws.path(), future, future);
      s.send(':w<Enter>:q<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 0, `rewriting identical bytes is not a modification, got exit code ${r.exitCode}: ${r.stderr.trim()}`);
      assert.strictEqual(ws.read(), 'xinitial\n');
    },

    'EXT-CREATED-AFTER-OPEN': async (ws) => {
      const s = ws.live({ file: 'later.txt' });
      await s.waitForSwap();
      s.send('ihello<Esc>');
      ws.write('later.txt', 'someone else created me\n');
      s.send(':w<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.ok(r.stderr.toLowerCase().includes('modified'), `stderr must contain "modified", got: ${r.stderr.trim()}`);
      assert.strictEqual(ws.read('later.txt'), 'someone else created me\n');
    },

    'EXT-BASELINE-REFRESH': async (ws) => {
      const s = ws.live({ initial: 'a\n' });
      await s.waitForSwap();
      s.send('ix<Esc>:w<Enter>iy<Esc>:w<Enter>:q<Enter>');
      const r = await s.end();
      assert.strictEqual(r.exitCode, 0, `a second :w after the editor's own save must not be refused, got exit code ${r.exitCode}: ${r.stderr.trim()}`);
      assert.strictEqual(ws.read(), 'yxa\n');
    },
  },
};
