'use strict';
const assert = require('assert');

module.exports = {
  checks: {
    'QUIT-REFUSE-DIRTY': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:q<Enter>' });
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.ok(r.stderr.toLowerCase().includes('unsaved'), `stderr must contain "unsaved", got: ${r.stderr.trim()}`);
      assert.strictEqual(r.content, 'a\n', 'file must be untouched');
    },

    'QUIT-FORCE': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:q!<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'a\n', ':q! must discard the edit');
    },

    'QUIT-CLEAN': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: ':q<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
    },

    'QUIT-WQ': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'xa\n');
    },

    'QUIT-AFTER-SAVE': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'ix<Esc>:w<Enter>:q<Enter>' });
      assert.strictEqual(r.exitCode, 0, `:q after :w must succeed, got exit code ${r.exitCode}`);
      assert.strictEqual(r.content, 'xa\n');
    },

    'QUIT-DIRTY-IS-CONTENT-BASED': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: 'Ax<Esc>u:q<Enter>' });
      assert.strictEqual(r.exitCode, 0, `after undoing every change :q must succeed, got exit code ${r.exitCode}`);
    },

    'CMD-UNKNOWN': async (ws) => {
      const r = ws.run({ initial: 'a\n', keys: ':foo<Enter>' });
      assert.strictEqual(r.exitCode, 1, `expected exit code 1, got ${r.exitCode}`);
      assert.ok(r.stderr.toLowerCase().includes('unknown'), `stderr must contain "unknown", got: ${r.stderr.trim()}`);
      const r2 = ws.run({ initial: 'a\n', keys: ':qq<Enter>' });
      assert.strictEqual(r2.exitCode, 1, '":qq" is not ":q" and must be rejected as unknown');
    },

    'CMD-GOTO-LINE': async (ws) => {
      const r = ws.run({ initial: 'a\nb\nc\nd\n', keys: ':3<Enter>' });
      assert.ok(r.report, 'no report file was written');
      assert.strictEqual(r.report.cursorRow, 2);
      assert.strictEqual(r.report.cursorCol, 0);
      const r2 = ws.run({ initial: 'a\nb\n', keys: ':99<Enter>' });
      assert.strictEqual(r2.report.cursorRow, 1, 'line numbers past the end clamp to the last line');
    },
  },
};
