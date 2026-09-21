import * as fs from 'fs';
import * as readline from 'readline';
import { Engine } from '../core/engine';

export async function runHeadless(filename: string, recover: boolean, reportPath: string | null): Promise<void> {
  const engine = new Engine(filename, recover);
  let exitCode = 0;
  let exitMessage = '';

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const rawLine of rl) {
    const token = rawLine.trim();
    if (!token) continue;
    engine.handleKey(token);
    const err = engine.takeError();
    if (err) {
      exitCode = 1;
      exitMessage = err;
      break;
    }
    if (engine.shouldExit()) break;
  }
  rl.close();

  if (reportPath) {
    const report = {
      exitCode,
      exitMessage,
      finalContent: engine.buffer.lines.join('\n'),
      cursorRow: engine.buffer.cursorRow,
      cursorCol: engine.buffer.cursorCol,
      isDirty: engine.isDirty,
      mode: engine.mode,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  if (exitMessage) process.stderr.write(exitMessage + '\n');
  process.exit(exitCode);
}
