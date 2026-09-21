#!/usr/bin/env node
'use strict';
// Single-pass generation of a candidate solution by a real model API.
// Only task/instruction.md and task/public/** are sent to the model -- never reference/ or evaluation/.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const args = process.argv.slice(2);
let model = null;
let reasoning = 'medium';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model') model = args[++i];
  else if (args[i] === '--reasoning') reasoning = args[++i];
}
if (!model) {
  console.error('Usage: npm run generate -- --model <claude-opus-5|gpt-5.6-sol> [--reasoning medium|low|high|none|omit]');
  process.exit(2);
}

const outName = model.replace(/[\\/]/g, '__');
const outDir = path.join(ROOT, 'workspace', outName);
const logDir = path.join(ROOT, 'evaluation', 'proof-of-work', 'models', outName);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

function buildPrompt() {
  let p = 'You are implementing a complete software project from the following specification.\n\n';
  p += `=== task/instruction.md ===\n${fs.readFileSync(path.join(ROOT, 'task', 'instruction.md'), 'utf-8')}\n\n`;
  for (const f of walk(path.join(ROOT, 'task', 'public')).sort()) {
    p += `=== task/public/${path.relative(path.join(ROOT, 'task', 'public'), f).split(path.sep).join('/')} ===\n${fs.readFileSync(f, 'utf-8')}\n\n`;
  }
  p += [
    'Output your ENTIRE solution as a sequence of file blocks in exactly this format, one per file,',
    'with no other commentary before, after or between them. Do not wrap file content in markdown fences.',
    '',
    '--- FILE: src/relative/path.ts ---',
    '<file content>',
    '--- END FILE ---',
    '',
    'Only emit files under src/. Do not emit package.json or tsconfig.json; the harness provides them.',
    'The code is compiled with `tsc` for Node.js (CommonJS) and must produce dist/cli/index.js.',
  ].join('\n');
  return p;
}

function parseBlocks(text) {
  const files = [];
  const re = /--- FILE:\s*(\S+)\s*---\n([\s\S]*?)\n--- END FILE ---/g;
  let m;
  const normalized = text.replace(/\r\n/g, '\n');
  while ((m = re.exec(normalized)) !== null) {
    let content = m[2];
    if (content.startsWith('```')) content = content.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');
    files.push({ rel: m[1], content });
  }
  return files;
}

function post(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const modelId = process.env.CLAUDE_OPUS5_MODEL_ID || model;
  const maxTokens = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '32000', 10);
  const payload = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (reasoning !== 'omit' && reasoning !== 'none') {
    payload.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.floor(maxTokens / 3)) };
  }
  const body = JSON.stringify(payload);
  const resp = await post(
    { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(body) } },
    body
  );
  if (resp.stop_reason === 'max_tokens') console.error('WARNING: response truncated at max_tokens; raise ANTHROPIC_MAX_TOKENS.');
  return { text: (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), usage: resp.usage, modelId };
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const modelId = process.env.OPENAI_MODEL_ID || model;
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '32000', 10);
  const payload = { model: modelId, messages: [{ role: 'user', content: prompt }], max_completion_tokens: maxTokens };
  if (reasoning !== 'omit') payload.reasoning_effort = reasoning;
  const body = JSON.stringify(payload);
  const resp = await post(
    { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'content-length': Buffer.byteLength(body) } },
    body
  );
  const choice = resp.choices[0];
  if (choice.finish_reason === 'length') console.error('WARNING: response truncated; raise OPENAI_MAX_TOKENS.');
  return { text: choice.message.content, usage: resp.usage, modelId };
}

async function main() {
  const prompt = buildPrompt();
  console.log(`Generating with ${model} (reasoning: ${reasoning}), single pass, prompt ${prompt.length} chars`);
  const startedAt = new Date().toISOString();
  const res = /^claude/i.test(model) ? await callAnthropic(prompt) : await callOpenAI(prompt);

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'raw-response.txt'), res.text || '');
  const files = parseBlocks(res.text || '');
  fs.writeFileSync(
    path.join(logDir, 'generation.json'),
    JSON.stringify({ model, apiModelId: res.modelId, reasoning, startedAt, finishedAt: new Date().toISOString(), promptSha256: crypto.createHash('sha256').update(prompt).digest('hex'), usage: res.usage, filesParsed: files.map((f) => f.rel), attempts: 1 }, null, 2) + '\n'
  );
  if (!files.length) {
    console.error('No complete file blocks found in the response (see raw-response.txt).');
    process.exit(1);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.resolve(outDir, f.rel);
    if (!target.startsWith(outDir + path.sep)) {
      console.error(`Refusing to write outside workspace: ${f.rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  for (const f of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(ROOT, 'reference', f), path.join(outDir, f));
  console.log(`Wrote ${files.length} file(s) to ${path.relative(ROOT, outDir)}. Now run: npm run score -- --target workspace/${outName}`);
}

main().catch((e) => {
  console.error(`Generation failed: ${e.message}`);
  process.exit(1);
});
