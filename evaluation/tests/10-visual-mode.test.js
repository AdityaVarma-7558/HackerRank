'use strict';
const assert = require('assert');

const LINE = 'foo bar.baz qux\n';
const LINES = 'a\nb\nc\nd\n';

function text(ws, initial, keyStr) {
  const r = ws.run({ initial, keys: keyStr });
  assert.ok(r.report, 'no report file was written');
  return r.report.finalContent;
}

module.exports = {
  checks: {
    'VISUAL-CHAR-DELETE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'lvlld'), 'fbar.baz qux', 'v selection is inclusive of both ends');
      assert.strictEqual(text(ws, LINE, 'wvhd'), 'fooar.baz qux', 'selection can extend backwards');
    },

    'VISUAL-CHAR-YANK-PASTE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'vey$p'), 'foo bar.baz quxfoo');
      const r = ws.run({ initial: LINE, keys: 'vey' });
      assert.strictEqual(r.report.cursorCol, 0, 'yank leaves the cursor at the start of the selection');
      assert.strictEqual(r.report.mode, 'NORMAL');
    },

    'VISUAL-LINE-DELETE': async (ws) => {
      assert.strictEqual(text(ws, LINES, 'jVjd'), 'a\nd');
    },

    'VISUAL-LINE-YANK-PASTE': async (ws) => {
      assert.strictEqual(text(ws, LINES, 'VjyGp'), 'a\nb\nc\nd\na\nb');
    },

    'VISUAL-CHANGE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'vecX<Esc>'), 'X bar.baz qux');
      assert.strictEqual(text(ws, LINES, 'jVjcnew<Esc>'), 'a\nnew\nd');
    },

    'VISUAL-ESCAPE': async (ws) => {
      const r = ws.run({ initial: LINE, keys: 'vl<Esc>' });
      assert.strictEqual(r.report.mode, 'NORMAL');
      assert.strictEqual(r.report.finalContent, 'foo bar.baz qux');
      assert.strictEqual(r.report.isDirty, false);
      assert.strictEqual(text(ws, LINE, 'vl<Esc>ix<Esc>'), 'fxoo bar.baz qux');
    },

    'VISUAL-NAMED-REGISTER': async (ws) => {
      assert.strictEqual(text(ws, LINE, 've"ay$"ap'), 'foo bar.baz quxfoo');
      assert.strictEqual(text(ws, LINE, 'yw$ve"ayp'), 'foo bar.baz quxfoo ', 'a named visual yank must leave the unnamed register alone');
    },

    'VISUAL-UNDO': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'vlldu'), 'foo bar.baz qux');
    },
  },
};
