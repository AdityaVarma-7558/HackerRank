'use strict';
const assert = require('assert');

module.exports = {
  checks: {
    'BASIC-INSERT-SAVE': async (ws) => {
      const r = ws.run({ initial: 'foo\n', keys: 'A_bar<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'foo_bar\n');
    },

    'BASIC-ENTER-SPACE-BACKSPACE': async (ws) => {
      const r = ws.run({ initial: '', keys: 'ihelx<Backspace>lo w<Enter>orld<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'hello w\norld\n');
    },

    'BASIC-OPEN-LINES': async (ws) => {
      const r = ws.run({
        initial: 'one\ntwo\n',
        keys: 'oX<Esc>GOY<Esc>ggI><Esc>:wq<Enter>',
      });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, '>one\nX\nY\ntwo\n');
    },

    'BASIC-NEW-FILE': async (ws) => {
      assert.strictEqual(ws.read('new.txt'), null);
      const r = ws.run({ file: 'new.txt', keys: 'ihi<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'hi\n');
    },

    'BASIC-NO-PHANTOM-LINE': async (ws) => {
      const r = ws.run({ initial: 'a\nb\n', keys: 'Gix<Esc>:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'a\nxb\n', 'a trailing newline must not create an extra empty last line');
    },

    'BASIC-REPORT-FIELDS': async (ws) => {
      const r = ws.run({ initial: 'abc\n', keys: 'Ade<Esc>' });
      assert.ok(r.report, 'no report file was written');
      assert.strictEqual(r.report.exitCode, 0);
      assert.strictEqual(r.report.finalContent, 'abcde');
      assert.strictEqual(r.report.cursorRow, 0);
      assert.strictEqual(r.report.cursorCol, 4);
      assert.strictEqual(r.report.isDirty, true);
      assert.strictEqual(r.content, 'abc\n', 'the file on disk must not change without :w');
    },
  },
};
