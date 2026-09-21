'use strict';
const assert = require('assert');

const INITIAL = 'line1\nline2\nline3\n';

module.exports = {
  checks: {
    'REG-NAMED-NO-CLOBBER': async (ws) => {
      const r = ws.run({ initial: INITIAL, keys: 'yyj"ayyp:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'line1\nline2\nline1\nline3\n', 'p must paste the unnamed register (line1), not "a');
    },

    'REG-NAMED-PASTE': async (ws) => {
      const r = ws.run({ initial: INITIAL, keys: '"ayyG"ap:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'line1\nline2\nline3\nline1\n');
    },

    'REG-NAMED-DELETE': async (ws) => {
      const r = ws.run({ initial: INITIAL, keys: 'yyj"addGp"ap:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      // "add removes line2 into "a and leaves the unnamed register (line1) alone.
      // G,p appends line1 after line3; "ap then appends line2 after that line1's row.
      assert.strictEqual(r.content, 'line1\nline3\nline1\nline2\n');
    },

    'REG-UNNAMED-DELETE': async (ws) => {
      const r = ws.run({ initial: INITIAL, keys: 'ddp:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'line2\nline1\nline3\n');
    },

    'REG-TWO-NAMED-INDEPENDENT': async (ws) => {
      const r = ws.run({ initial: INITIAL, keys: '"ayyj"byyG"ap"bp:wq<Enter>' });
      assert.strictEqual(r.exitCode, 0, `expected exit code 0, got ${r.exitCode}`);
      assert.strictEqual(r.content, 'line1\nline2\nline3\nline1\nline2\n');
    },
  },
};
