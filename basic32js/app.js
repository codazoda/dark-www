import { Interpreter } from './interpreter.js';
import { createConsole, createGraphics, createMachine } from './machine.js';

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

const machine = createMachine(consoleApi, graphicsApi, showScreen);
const interpreter = new Interpreter(machine);

machine.consoleWrite('BASIC32\n\nREADY.\n');
input.focus();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = '';
  input.disabled = true;
  try {
    await interpreter.inputLine(line);
  } finally {
    input.disabled = false;
    input.focus();
  }
});
