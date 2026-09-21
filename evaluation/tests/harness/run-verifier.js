#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, Workspace } = require('./helper');

const TESTS_DIR = path.join(REPO, 'evaluation', 'tests');
const SCORING = path.join(REPO, 'evaluation', 'scoring.yml');
const CRITERIA = path.join(REPO, 'evaluation', 'acceptance-criteria.yml');
const BUILD_SH = path.join(REPO, 'app-setup', 'build.sh');
const CHECK_TIMEOUT_MS = 90000;

// ------------------------------------------------------------------ config

function loadWeights() {
  const weights = {};
  let inBlock = false;
  for (const raw of fs.readFileSync(SCORING, 'utf-8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^weights:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const m = line.match(/^\s+([A-Z0-9][A-Z0-9-]*):\s*([0-9]*\.?[0-9]+)\s*$/);
    if (m) weights[m[1]] = parseFloat(m[2]);
    else if (!/^\s/.test(line)) inBlock = false;
  }
  return weights;
}

function loadRequirements() {
  const reqs = [];
  let cur = null;
  let inChecks = false;
  for (const raw of fs.readFileSync(CRITERIA, 'utf-8').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m = line.match(/^\s*-\s+id:\s*(\S+)\s*$/);
    if (m) {
      cur = { id: m[1], checks: [] };
      reqs.push(cur);
      inChecks = false;
      continue;
    }
    if (!cur) continue;
    m = line.match(/^\s+checks:\s*\[(.*)\]\s*$/);
    if (m) {
      cur.checks.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
      inChecks = false;
      continue;
    }
    if (/^\s+checks:\s*$/.test(line)) {
      inChecks = true;
      continue;
    }
    m = line.match(/^\s+-\s+([A-Z0-9][A-Z0-9-]*)\s*$/);
    if (inChecks && m) {
      cur.checks.push(m[1]);
      continue;
    }
    if (inChecks && line.trim() && !/^\s+-/.test(line)) inChecks = false;
  }
  return reqs;
}

function loadChecks() {
  const files = fs.readdirSync(TESTS_DIR).filter((f) => /\.test\.js$/.test(f)).sort();
  const checks = [];
  for (const file of files) {
    const mod = require(path.join(TESTS_DIR, file));
    for (const [id, fn] of Object.entries(mod.checks)) checks.push({ id, fn, file });
  }
  return checks;
}

function validateConfig(checks, weights, reqs) {
  const problems = [];
  const ids = checks.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`duplicate check ids: ${dupes.join(', ')}`);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) problems.push(`scoring.yml weights sum to ${sum}, expected exactly 1.0`);
  const noWeight = ids.filter((id) => !(id in weights));
  const orphanWeight = Object.keys(weights).filter((id) => !ids.includes(id));
  if (noWeight.length) problems.push(`checks without a weight in scoring.yml: ${noWeight.join(', ')}`);
  if (orphanWeight.length) problems.push(`weights for nonexistent checks: ${orphanWeight.join(', ')}`);
  const linked = new Set(reqs.flatMap((r) => r.checks));
  const unlinked = ids.filter((id) => !linked.has(id));
  const ghost = [...linked].filter((id) => !ids.includes(id));
  if (unlinked.length) problems.push(`checks not linked from acceptance-criteria.yml: ${unlinked.join(', ')}`);
  if (ghost.length) problems.push(`acceptance-criteria.yml references nonexistent checks: ${ghost.join(', ')}`);
  return problems;
}

// ------------------------------------------------------------------- build

function build(targetAbs) {
  if (!fs.existsSync(path.join(targetAbs, 'package.json'))) {
    return { ok: false, message: `${path.relative(REPO, targetAbs)} has no package.json (generation produced no project)` };
  }
  let res;
  if (process.platform === 'win32') {
    const first = spawnSync('npm install --no-audit --no-fund', { cwd: targetAbs, shell: true, encoding: 'utf-8' });
    res = first.status === 0 ? spawnSync('npm run build', { cwd: targetAbs, shell: true, encoding: 'utf-8' }) : first;
  } else {
    res = spawnSync('bash', [BUILD_SH, targetAbs], { encoding: 'utf-8' });
  }
  if (res.status !== 0) {
    const tail = `${res.stdout || ''}\n${res.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
    return { ok: false, message: `build failed (exit ${res.status}):\n${tail}` };
  }
  if (!fs.existsSync(path.join(targetAbs, 'dist', 'cli', 'index.js'))) {
    return { ok: false, message: 'build succeeded but dist/cli/index.js was not produced' };
  }
  return { ok: true, message: '' };
}

// ------------------------------------------------------------------ verify

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runChecks(target, checks) {
  const results = [];
  for (const c of checks) {
    const ws = new Workspace(target);
    try {
      await withTimeout(Promise.resolve().then(() => c.fn(ws)), CHECK_TIMEOUT_MS, c.id);
      results.push({ id: c.id, file: c.file, passed: true });
    } catch (e) {
      const message = String((e && e.message) || e).split('\n').slice(0, 4).join(' | ');
      results.push({ id: c.id, file: c.file, passed: false, message });
    } finally {
      ws.cleanup();
    }
  }
  return results;
}

function scoreResults(results, weights, reqs) {
  const score = results.reduce((s, r) => s + (r.passed ? weights[r.id] : 0), 0);
  const byRequirement = reqs.map((q) => {
    const total = q.checks.reduce((s, id) => s + (weights[id] || 0), 0);
    const earned = q.checks.reduce((s, id) => s + ((results.find((r) => r.id === id) || {}).passed ? weights[id] || 0 : 0), 0);
    const failed = q.checks.filter((id) => !(results.find((r) => r.id === id) || {}).passed);
    return { requirement: q.id, weight: round(total), earned: round(earned), failedChecks: failed };
  });
  return { score: round(score), byRequirement };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function latestWorkspace() {
  const root = path.join(REPO, 'workspace');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, t: fs.statSync(path.join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return dirs.length ? path.join('workspace', dirs[0].name) : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { target: null, report: null, requirePerfect: false, repeat: 1, build: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') opt.target = argv[++i];
    else if (argv[i] === '--report') opt.report = argv[++i];
    else if (argv[i] === '--require-perfect') opt.requirePerfect = true;
    else if (argv[i] === '--repeat') opt.repeat = parseInt(argv[++i], 10);
    else if (argv[i] === '--no-build') opt.build = false;
  }
  if (!opt.target) opt.target = latestWorkspace();
  if (!opt.target) {
    console.error('No --target given and no workspace/<name> directory exists. Run `npm run generate -- --model <id>` first.');
    process.exit(2);
  }
  const targetAbs = path.resolve(REPO, opt.target);
  if (!opt.report) {
    const rel = path.relative(path.join(REPO, 'workspace'), targetAbs);
    opt.report = rel && !rel.startsWith('..') ? path.join('evaluation', 'proof-of-work', 'models', rel.split(path.sep)[0], 'report.json') : path.join('evaluation', 'proof-of-work', 'latest-report.json');
  }

  const checks = loadChecks();
  const weights = loadWeights();
  const reqs = loadRequirements();
  const problems = validateConfig(checks, weights, reqs);
  if (problems.length) {
    console.error('Verifier configuration is inconsistent:\n  - ' + problems.join('\n  - '));
    process.exit(2);
  }

  console.log(`Verifying ${path.relative(REPO, targetAbs) || '.'} (${checks.length} checks)`);
  let buildInfo = { ok: true, message: '' };
  if (opt.build) buildInfo = build(targetAbs);

  let results;
  let deterministic = true;
  const runs = [];
  if (!buildInfo.ok) {
    console.error(buildInfo.message);
    results = checks.map((c) => ({ id: c.id, file: c.file, passed: false, message: 'not run: build failed' }));
  } else {
    for (let n = 0; n < Math.max(1, opt.repeat); n++) {
      const r = await runChecks(opt.target, checks);
      runs.push(r);
      for (const x of r) if (!x.passed) console.log(`  FAIL ${x.id}: ${x.message}`);
      console.log(`  run ${n + 1}: ${r.filter((x) => x.passed).length}/${r.length} checks passed`);
    }
    results = runs[0];
    deterministic = runs.every((r) => r.every((x, i) => x.passed === runs[0][i].passed));
  }

  const { score, byRequirement } = scoreResults(results, weights, reqs);
  const passed = results.filter((r) => r.passed).length;
  const report = {
    target: path.relative(REPO, targetAbs).split(path.sep).join('/') || '.',
    timestamp: new Date().toISOString(),
    build: buildInfo.ok ? { ok: true } : { ok: false, error: buildInfo.message },
    score,
    scorePercent: round(score * 100),
    checksPassed: passed,
    checksTotal: results.length,
    repeats: runs.length || 1,
    deterministic,
    results,
    byRequirement,
    failureCategories: byRequirement.filter((q) => q.failedChecks.length > 0).map((q) => ({ requirement: q.requirement, failedChecks: q.failedChecks })),
  };
  const reportAbs = path.resolve(REPO, opt.report);
  fs.mkdirSync(path.dirname(reportAbs), { recursive: true });
  fs.writeFileSync(reportAbs, JSON.stringify(report, null, 2) + '\n');
  console.log(`Score: ${report.scorePercent}% (${passed}/${results.length} checks) -> ${path.relative(REPO, reportAbs)}`);

  if (!deterministic) {
    console.error('Repeated runs disagreed: the verifier is not deterministic on this target.');
    process.exit(1);
  }
  if (opt.requirePerfect && (score < 1 - 1e-9 || !buildInfo.ok)) {
    console.error('Expected a perfect score (1.0) but the target did not achieve it.');
    process.exit(1);
  }
}

module.exports = { loadChecks, loadWeights, loadRequirements };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
