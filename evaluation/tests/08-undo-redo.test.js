'use strict';
const assert = require('assert');

function final(ws, initial, keyStr) {
  const r = ws.run({ initial, keys: keyStr });
  assert.ok(r.report, 'no report file was written');
  return r.report.finalContent;
}

module.exports = {
  checks: {
    'UNDO-INSERT': async (ws) => {
      assert.strictEqual(final(ws, 'x\n', 'Ahello<Esc>u'), 'x', 'one insert session is one undo step');
    },

    'UNDO-DELETE': async (ws) => {
      assert.strictEqual(final(ws, 'a\nb\n', 'ddu'), 'a\nb');
    },

    'UNDO-PASTE': async (ws) => {
      assert.strictEqual(final(ws, 'a\nb\n', 'yy3pu'), 'a\nb');
    },

    'REDO': async (ws) => {
      assert.strictEqual(final(ws, 'a\nb\n', 'ddu<C-r>'), 'b');
      assert.strictEqual(final(ws, 'x\n', 'A1<Esc>A2<Esc>uu<C-r>'), 'x1');
    },

    'REDO-CLEARED-BY-NEW-EDIT': async (ws) => {
      assert.strictEqual(final(ws, 'x\n', 'A1<Esc>uA2<Esc><C-r>'), 'x2');
    },

    'UNDO-YANK-NOT-A-STEP': async (ws) => {
      assert.strictEqual(final(ws, 'x\n', 'A1<Esc>yyu'), 'x', 'yy must not consume an undo step');
    },

    'UNDO-NOOP-INSERT': async (ws) => {
      assert.strictEqual(final(ws, 'x\n', 'A1<Esc>i<Esc>u'), 'x', 'entering and leaving Insert without typing must not consume an undo step');
    },

    'UNDO-DEPTH-100': async (ws) => {
      const edit = 'Aa<Esc>'.repeat(100);
      const undo = 'u'.repeat(100);
      assert.strictEqual(final(ws, 'x\n', edit + undo), 'x', '100 consecutive edits must all be undoable');
    },
  },
};
