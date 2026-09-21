'use strict';
const assert = require('assert');

const LINE = 'foo bar.baz qux\n';

function text(ws, initial, keyStr) {
  const r = ws.run({ initial, keys: keyStr });
  assert.ok(r.report, 'no report file was written');
  return r.report.finalContent;
}

function cursor(ws, initial, keyStr) {
  const r = ws.run({ initial, keys: keyStr });
  assert.ok(r.report, 'no report file was written');
  return [r.report.cursorRow, r.report.cursorCol];
}

module.exports = {
  checks: {
    'OP-DW': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'dw'), 'bar.baz qux');
      assert.strictEqual(text(ws, LINE, 'wdw'), 'foo .baz qux', 'punctuation is its own word');
    },

    'OP-DW-LAST-WORD': async (ws) => {
      assert.strictEqual(text(ws, LINE, '$bdw'), 'foo bar.baz ', 'dw on the last word deletes through the end of the line');
      assert.strictEqual(text(ws, 'ab cd\nef\n', 'wdw'), 'ab \nef', 'dw never joins lines');
    },

    'OP-DE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'de'), ' bar.baz qux', 'e is inclusive');
    },

    'OP-D-DOLLAR': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'wd$'), 'foo ', '$ is inclusive of the last character');
    },

    'OP-D-ZERO': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'wd0'), 'bar.baz qux');
    },

    'OP-DB': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'wwdb'), 'foo .baz qux');
    },

    'OP-C-DOLLAR': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'wc$X<Esc>'), 'foo X');
    },

    'OP-CW-LIKE-CE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'cwX<Esc>'), 'X bar.baz qux', 'cw on a non-blank behaves like ce');
    },

    'OP-CC': async (ws) => {
      assert.strictEqual(text(ws, 'a\nb\nc\n', 'j2ccnew<Esc>'), 'a\nnew');
    },

    'OP-YW-PASTE': async (ws) => {
      assert.strictEqual(text(ws, LINE, 'ywP'), 'foo foo bar.baz qux');
      assert.strictEqual(text(ws, LINE, 'yw$p'), 'foo bar.baz quxfoo ');
    },

    'OP-LINEWISE-MOTIONS': async (ws) => {
      assert.strictEqual(text(ws, 'a\nb\nc\nd\n', 'jdj'), 'a\nd');
      assert.strictEqual(text(ws, 'a\nb\nc\nd\n', 'jdG'), 'a');
      assert.strictEqual(text(ws, 'a\nb\nc\nd\n', 'jjdgg'), 'd');
      assert.strictEqual(text(ws, 'a\nb\nc\nd\n', 'Gdk'), 'a\nb');
    },

    'MOTION-WORDS': async (ws) => {
      assert.deepStrictEqual(cursor(ws, LINE, 'w'), [0, 4], 'w');
      assert.deepStrictEqual(cursor(ws, LINE, 'ww'), [0, 7], 'ww lands on the punctuation');
      assert.deepStrictEqual(cursor(ws, LINE, 'www'), [0, 8], 'www');
      assert.deepStrictEqual(cursor(ws, LINE, 'e'), [0, 2], 'e');
      assert.deepStrictEqual(cursor(ws, LINE, 'ee'), [0, 6], 'ee');
      assert.deepStrictEqual(cursor(ws, LINE, 'wwb'), [0, 4], 'b');
      assert.deepStrictEqual(cursor(ws, LINE, '$'), [0, 14], '$');
      assert.deepStrictEqual(cursor(ws, LINE, '$0'), [0, 0], '0');
      assert.deepStrictEqual(cursor(ws, 'ab\ncd ef\n', 'w'), [1, 0], 'w crosses lines');
    },

    'MOTION-VERTICAL-CLAMP': async (ws) => {
      const init = 'abcdef\nab\n\nxyz\n';
      assert.deepStrictEqual(cursor(ws, init, '$j'), [1, 1], 'column clamps to the last character');
      assert.deepStrictEqual(cursor(ws, init, '$jj'), [2, 0], 'empty line has column 0');
      assert.deepStrictEqual(cursor(ws, init, '$jjj'), [3, 0], 'the desired column is not remembered');
      assert.deepStrictEqual(cursor(ws, init, 'Gk'), [2, 0]);
      assert.deepStrictEqual(cursor(ws, init, 'kkhh'), [0, 0], 'motions never leave the buffer');
      assert.deepStrictEqual(cursor(ws, init, '99lgg'), [0, 0], 'gg');
    },
  },
};
