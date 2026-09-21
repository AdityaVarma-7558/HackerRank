import * as readline from 'readline';
import { Engine } from '../core/engine';

function mapKey(str: string | undefined, key: readline.Key | undefined): string | null {
  if (key) {
    if (key.ctrl && key.name === 'r') return '<C-r>';
    if (key.name === 'escape') return '<Esc>';
    if (key.name === 'return' || key.name === 'enter') return '<Enter>';
    if (key.name === 'backspace') return '<Backspace>';
    if (key.name === 'space') return '<Space>';
  }
  if (str && str.length === 1 && str >= ' ' && str !== '\x7f') return str === ' ' ? '<Space>' : str;
  return null;
}

export function runInteractive(filename: string, recover: boolean): void {
  const engine = new Engine(filename, recover);
  let status = '';

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const render = () => {
    const out: string[] = ['\x1b[2J\x1b[H'];
    engine.buffer.lines.forEach((line, i) => {
      if (i === engine.buffer.cursorRow) {
        const col = Math.min(engine.buffer.cursorCol, line.length);
        out.push(line.slice(0, col) + '\x1b[7m' + (line[col] ?? ' ') + '\x1b[0m' + line.slice(col + 1));
      } else {
        out.push(line);
      }
    });
    const dirty = engine.isDirty ? ' [+]' : '';
    out.push(`-- ${engine.mode} -- ${engine.buffer.filename}${dirty} ${status}`);
    process.stdout.write(out.join('\n') + '\n');
  };

  render();

  process.stdin.on('keypress', (str: string | undefined, key: readline.Key | undefined) => {
    if (key && key.ctrl && key.name === 'c') process.exit(130);
    const mapped = mapKey(str, key);
    if (mapped === null) return;
    engine.handleKey(mapped);
    status = engine.takeError() ?? '';
    if (engine.shouldExit()) {
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
    }
    render();
  });
}
