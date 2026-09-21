'use strict';
const assert = require('assert');

module.exports = {
  checks: {
    'COUNT-DD': async (ws) => {
      const r = ws.run({ initial: '1\n2\n3\n4\n5\n', keys: '3dd:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, '4\n5\n');
    },

    'COUNT-DD-CLAMP': async (ws) => {
      const r = ws.run({ initial: '1\n2\n3\n4\n5\n', keys: 'jj9dd:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, '1\n2\n');
    },

    'COUNT-DD-REGISTER-ORDER': async (ws) => {
      const r = ws.run({ initial: 'a\nb\nc\nd\n', keys: '2ddGp:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'c\nd\na\nb\n', 'deleted lines must be pasted back in their original order');
    },

    'COUNT-P-LINE': async (ws) => {
      const r = ws.run({ initial: 'a\nb\nc\n', keys: '2yy3p:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'a\na\nb\na\nb\na\nb\nb\nc\n');
    },

    'COUNT-P-CHAR': async (ws) => {
      const r = ws.run({ initial: 'ab\n', keys: 'yl3p:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'aaaab\n');
    },

    'COUNT-DW': async (ws) => {
      const r = ws.run({ initial: 'one two three four\n', keys: '2dw:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'three four\n');
    },

    'COUNT-MOTIONS': async (ws) => {
      const a = ws.run({ initial: 'a b c d e\nf\ng\nh\ni\n', keys: '3w' });
      assert.deepStrictEqual([a.report.cursorRow, a.report.cursorCol], [0, 6], '3w');
      const b = ws.run({ initial: 'a b c d e\nf\ng\nh\ni\n', keys: '5G' });
      assert.deepStrictEqual([b.report.cursorRow, b.report.cursorCol], [4, 0], '5G');
      const c = ws.run({ initial: 'a b c d e\nf\ng\nh\ni\n', keys: '9G' });
      assert.strictEqual(c.report.cursorRow, 4, '9G clamps to the last line');
      const d = ws.run({ initial: 'abcdef\nab\nxyz\n', keys: '$2j' });
      assert.deepStrictEqual([d.report.cursorRow, d.report.cursorCol], [2, 2], '$ then 2j');
    },

    'COUNT-UNDO': async (ws) => {
      const r = ws.run({ initial: 'x\n', keys: 'A1<Esc>A2<Esc>A3<Esc>2u' });
      assert.strictEqual(r.report.finalContent, 'x1');
    },
  },
};
