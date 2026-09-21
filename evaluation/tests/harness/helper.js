'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const START_SH = path.join(REPO, 'app-setup', 'start.sh');

function resolveTarget(target) {
  return path.resolve(REPO, target);
}

// "ihello<Esc>:wq<Enter>" -> ['i','h','e','l','l','o','<Esc>',':','w','q','<Enter>']
function keys(str) {
  const out = [];
  for (let i = 0; i < str.length; ) {
    const m = /^<[A-Za-z][A-Za-z-]*>/.exec(str.slice(i));
    if (m) {
      out.push(m[0]);
      i += m[0].length;
    } else {
      out.push(str[i] === ' ' ? '<Space>' : str[i]);
      i += 1;
    }
  }
  return out;
}

function launchSpec(targetAbs, extraArgs) {
  if (process.platform === 'win32') {
    return { cmd: process.execPath, args: [path.join(targetAbs, 'dist', 'cli', 'index.js'), '--headless', ...extraArgs] };
  }
  return { cmd: 'bash', args: [START_SH, targetAbs, ...extraArgs] };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Workspace {
  constructor(target) {
    this.target = resolveTarget(target);
    this.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimtask-')));
    this.reportCounter = 0;
  }
  path(name = 'f.txt') {
    return path.join(this.dir, name);
  }
  swap(name = 'f.txt') {
    return path.join(this.dir, `.${name}.swp`);
  }
  write(name, content) {
    fs.writeFileSync(this.path(name), content);
  }
  read(name = 'f.txt') {
    return fs.existsSync(this.path(name)) ? fs.readFileSync(this.path(name), 'utf-8') : null;
  }
  swapExists(name = 'f.txt') {
    return fs.existsSync(this.swap(name));
  }
  nextReport() {
    return path.join(this.dir, `report-${this.reportCounter++}.json`);
  }
  cleanup() {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  // Run a full scripted session synchronously and return what is observable.
  run({ file = 'f.txt', initial, keys: keyStr = '', recover = false, timeoutMs = 20000 } = {}) {
    if (initial !== undefined) this.write(file, initial);
    const reportPath = this.nextReport();
    const extra = [this.path(file), '--report', reportPath];
    if (recover) extra.push('--recover');
    const { cmd, args } = launchSpec(this.target, extra);
    const res = spawnSync(cmd, args, {
      input: keys(keyStr).join('\n') + '\n',
      encoding: 'utf-8',
      timeout: timeoutMs,
      cwd: this.dir,
    });
    let report = null;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      } catch (e) {
        report = null;
      }
    }
    return {
      exitCode: res.status,
      signal: res.signal,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      report,
      content: this.read(file),
      swapExists: this.swapExists(file),
    };
  }

  live({ file = 'f.txt', initial, recover = false } = {}) {
    if (initial !== undefined) this.write(file, initial);
    return new LiveSession(this, file, recover);
  }
}

class LiveSession {
  constructor(ws, file, recover) {
    this.ws = ws;
    this.file = file;
    this.reportPath = ws.nextReport();
    const extra = [ws.path(file), '--report', this.reportPath];
    if (recover) extra.push('--recover');
    const { cmd, args } = launchSpec(ws.target, extra);
    this.stderr = '';
    this.closed = new Promise((resolve) => {
      this.child = spawn(cmd, args, { cwd: ws.dir, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stderr.on('data', (d) => (this.stderr += d.toString()));
      this.child.stdout.on('data', () => {});
      this.child.stdin.on('error', () => {});
      this.child.on('close', (code, signal) => resolve({ code, signal }));
    });
  }
  swapStamp() {
    try {
      const st = fs.statSync(this.ws.swap(this.file));
      return `${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return 'missing';
    }
  }
  send(keyStr) {
    this.baseline = this.swapStamp();
    this.child.stdin.write(keys(keyStr).join('\n') + '\n');
  }
  async waitForSwap(timeoutMs = 6000) {
    const t0 = Date.now();
    while (!this.ws.swapExists(this.file)) {
      if (Date.now() - t0 > timeoutMs) throw new Error('swap file was not created after the editor opened the file');
      await sleep(25);
    }
  }
  // Wait until the editor has journaled what was just sent: the swap file must first change
  // relative to the moment of send(), then stay unchanged for quietMs.
  async waitSwapQuiet(quietMs = 500, timeoutMs = 8000) {
    const t0 = Date.now();
    let last = this.swapStamp();
    let changed = last !== this.baseline;
    let lastChange = Date.now();
    for (;;) {
      const cur = this.swapStamp();
      if (cur !== last) {
        last = cur;
        lastChange = Date.now();
        if (cur !== this.baseline) changed = true;
      }
      if (changed && Date.now() - lastChange >= quietMs) return;
      if (Date.now() - t0 > timeoutMs) return;
      await sleep(25);
    }
  }
  kill() {
    this.child.kill('SIGKILL');
    return this.closed;
  }
  async end(timeoutMs = 15000) {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), timeoutMs);
    const { code, signal } = await this.closed;
    clearTimeout(timer);
    let report = null;
    if (fs.existsSync(this.reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(this.reportPath, 'utf-8'));
      } catch (e) {
        report = null;
      }
    }
    return { exitCode: code, signal, stderr: this.stderr, report, content: this.ws.read(this.file) };
  }
}

module.exports = { REPO, keys, resolveTarget, Workspace, sleep };
