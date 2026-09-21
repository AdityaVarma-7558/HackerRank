import { runHeadless } from './headless';
import { runInteractive } from './interactive';

const args = process.argv.slice(2);
let headless = false;
let recover = false;
let reportPath: string | null = null;
let filename: string | null = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--headless') headless = true;
  else if (a === '--recover') recover = true;
  else if (a === '--report') reportPath = args[++i] ?? null;
  else if (!filename) filename = a;
}

if (!filename) {
  console.error('Usage: node dist/cli/index.js [--headless] [--recover] [--report <path>] <file>');
  process.exit(2);
}

if (headless) {
  runHeadless(filename, recover, reportPath);
} else {
  runInteractive(filename, recover);
}
