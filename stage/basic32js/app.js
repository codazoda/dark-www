import { Interpreter } from './interpreter.js';
import { createConsole, createGraphics, createMachine, createKeyQueue } from './machine.js';

const COLS = 40;
const ROWS = 20;

const consoleEl = document.getElementById('console');
const canvasEl = document.getElementById('canvas');
const form = document.getElementById('repl-form');
const input = document.getElementById('repl-input');

const consoleApi = createConsole(consoleEl, COLS, ROWS);
const graphicsApi = createGraphics(canvasEl);

function showScreen(mode) {
  if (mode === 1) {
    consoleEl.hidden = true;
    canvasEl.hidden = false;
    graphicsApi.resize();
  } else {
    canvasEl.hidden = true;
    consoleEl.hidden = false;
  }
}

window.addEventListener('resize', () => {
  if (!canvasEl.hidden) graphicsApi.resize();
});

const keyQueue = createKeyQueue();
const machine = createMachine(consoleApi, graphicsApi, showScreen, keyQueue);
const interpreter = new Interpreter(machine);

machine.consoleWrite('BASIC32\n\nREADY.\n');
input.focus();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = '';
  input.disabled = true;
  try {
    consoleApi.write(line + '\n');
    await interpreter.inputLine(line);
  } finally {
    input.disabled = false;
    input.focus();
  }
});

/* INKEY's key source: only feeds the queue while a program is running, the
 * browser analog of the POSIX host dropping into per-keystroke terminal
 * mode for the duration of RUN (see machine_run_began in
 * ../../basic32/host/machine_posix.c). The REPL's own input box is
 * `disabled` (and so un-focusable) during that same window, so normal
 * typing never reaches both places at once -- typing is either REPL text
 * entry or INKEY input, never both. Ctrl-C maps to BREAK (ASCII 3) and is
 * prevented from triggering the browser's copy shortcut. */
function keyEventToCode(e) {
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'c') return 3;
  if (e.key === 'Enter') return 13;
  if (e.key === 'Backspace') return 8;
  if (e.key === 'Tab') return 9;
  if (e.key.length === 1) return e.key.charCodeAt(0);
  return -1;
}

document.addEventListener('keydown', (e) => {
  if (!interpreter.running) return;
  const code = keyEventToCode(e);
  if (code === -1) return;
  e.preventDefault();
  keyQueue.push(code);
});
