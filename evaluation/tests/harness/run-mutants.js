#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { REPO, } = require('./helper');

const REFERENCE = path.join(REPO, 'reference');
const MUTANT_ROOT = path.join(REPO, 'workspace', '.mutants');
const REPORT_DIR = path.join(REPO, 'evaluation', 'proof-of-work', 'mutants');
const VERIFIER = path.join(__dirname, 'run-verifier.js');
const CONCURRENCY = 4;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function prepareMutant(m) {
  const dir = path.join(MUTANT_ROOT, m.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  copyDir(path.join(REFERENCE, 'src'), path.join(dir, 'src'));
  for (const f of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(REFERENCE, f), path.join(dir, f));
  fs.symlinkSync(path.join(REFERENCE, 'node_modules'), path.join(dir, 'node_modules'), 'junction');

  const file = path.join(dir, m.file);
  const original = fs.readFileSync(file, 'utf-8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`mutant ${m.id}: pattern must match exactly once in ${m.file}, matched ${hits}`);
  fs.writeFileSync(file, original.replace(m.find, () => m.replace));

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const b = spawnSync(npm, ['run', 'build'], { cwd: dir, encoding: 'utf-8', shell: process.platform === 'win32' });
  if (b.status !== 0) throw new Error(`mutant ${m.id} does not compile:\n${b.stdout}${b.stderr}`);
  return dir;
}

function verify(m, dir) {
  return new Promise((resolve) => {
    const reportRel = path.join('evaluation', 'proof-of-work', 'mutants', `${m.id}.report.json`);
    const child = spawn(process.execPath, [VERIFIER, '--target', path.relative(REPO, dir), '--report', reportRel, '--no-build'], { cwd: REPO });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => resolve({ reportPath: path.join(REPO, reportRel), log: out }));
  });
}

async function main() {
  if (!fs.existsSync(path.join(REFERENCE, 'node_modules'))) {
    console.error('reference/node_modules is missing. Run: bash app-setup/build.sh reference');
    process.exit(2);
  }
  const mutants = JSON.parse(fs.readFileSync(path.join(__dirname, 'mutants.json'), 'utf-8'));
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const f of fs.readdirSync(REPORT_DIR)) fs.rmSync(path.join(REPORT_DIR, f), { force: true });

  const summary = [];
  const queue = [...mutants];
  async function worker() {
    while (queue.length) {
      const m = queue.shift();
      const entry = { id: m.id, description: m.description, file: m.file, expectFail: m.expectFail };
      try {
        const dir = prepareMutant(m);
        const { reportPath, log } = await verify(m, dir);
        if (!fs.existsSync(reportPath)) throw new Error(`verifier produced no report:\n${log}`);
        const rep = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        entry.failedChecks = rep.results.filter((r) => !r.passed).map((r) => r.id);
        entry.failedFiles = [...new Set(rep.results.filter((r) => !r.passed).map((r) => r.file))];
        entry.score = rep.score;
        entry.caught = entry.failedChecks.length > 0;
        entry.expectedChecksFailed = m.expectFail.every((id) => entry.failedChecks.includes(id));
      } catch (e) {
        entry.error = String(e.message || e);
        entry.caught = false;
        entry.expectedChecksFailed = false;
      }
      summary.push(entry);
      const tag = entry.caught && entry.expectedChecksFailed ? 'CAUGHT ' : 'MISSED ';
      console.log(`${tag} ${m.id}  failed=[${(entry.failedChecks || []).join(', ')}]${entry.error ? '  ERROR: ' + entry.error : ''}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  summary.sort((a, b) => a.id.localeCompare(b.id));

  const testFiles = fs.readdirSync(path.join(REPO, 'evaluation', 'tests')).filter((f) => /\.test\.js$/.test(f));
  const covered = new Set(summary.flatMap((s) => s.failedFiles || []));
  const uncovered = testFiles.filter((f) => !covered.has(f));

  const ok = summary.every((s) => s.caught && s.expectedChecksFailed) && uncovered.length === 0;
  fs.writeFileSync(
    path.join(REPORT_DIR, 'summary.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), mutants: summary.length, allCaught: ok, testFilesWithoutAMutant: uncovered, results: summary }, null, 2) + '\n'
  );
  fs.rmSync(MUTANT_ROOT, { recursive: true, force: true });

  if (uncovered.length) console.error(`Test files that no mutant fails: ${uncovered.join(', ')}`);
  if (!ok) {
    console.error('\nMutant check FAILED.');
    process.exit(1);
  }
  console.log(`\nAll ${summary.length} mutants were caught by their expected checks; every test file catches at least one mutant.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
