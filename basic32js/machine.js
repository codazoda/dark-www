/* Browser machine layer for the BASIC32 interpreter: a fixed-grid text
 * console rendered into a <pre>, and a graphics surface rendered into a
 * <canvas>. This is the JS analog of projects/basic32/host/machine_posix.c
 * -- the interpreter core never touches the DOM directly. */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* A fixed character grid, the text-mode analog of the POSIX host's ANSI
 * terminal: LOCATE positions an internal cursor, writes advance it (with
 * wrapping and scrolling), and the whole grid is re-rendered into `pre`
 * after every mutation so LOCATE-based layouts (see clock.bas) line up. */
export function createConsole(pre, cols, rows) {
  let grid;
  let cursorRow = 0;
  let cursorCol = 0;

  function blankGrid() {
    return Array.from({ length: rows }, () => new Array(cols).fill(' '));
  }

  function scrollIfNeeded() {
    while (cursorRow >= rows) {
      grid.shift();
      grid.push(new Array(cols).fill(' '));
      cursorRow--;
    }
  }

  function putChar(c) {
    if (c === '\n') {
      cursorRow++;
      cursorCol = 0;
      scrollIfNeeded();
      return;
    }
    if (c === '\t') {
      cursorCol = (Math.floor(cursorCol / 8) + 1) * 8;
      if (cursorCol >= cols) {
        cursorCol = 0;
        cursorRow++;
        scrollIfNeeded();
      }
      return;
    }
    if (cursorCol >= cols) {
      cursorCol = 0;
      cursorRow++;
      scrollIfNeeded();
    }
    grid[cursorRow][cursorCol] = c;
    cursorCol++;
  }

  function render() {
    pre.textContent = grid.map((r) => r.join('')).join('\n');
  }

  function clear() {
    grid = blankGrid();
    cursorRow = 0;
    cursorCol = 0;
    render();
  }

  function write(s) {
    for (const ch of s) putChar(ch);
    render();
  }

  function locate(row, col) {
    cursorRow = clamp(row - 1, 0, rows - 1);
    cursorCol = clamp(col - 1, 0, cols - 1);
  }

  clear();
  return { clear, write, locate, cols, rows };
}

/* Graphics surface backed by a <canvas>, sized to its actual on-screen
 * pixel dimensions -- GWIDTH/GHEIGHT report whatever that is, the same way
 * the POSIX host reports its terminal's probed size. Canvas drawing already
 * clips to the surface bounds, satisfying LINE's clipping requirement for
 * free. */
export function createGraphics(canvas) {
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  function clear() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function line(x1, y1, x2, y2, rgb) {
    ctx.strokeStyle = '#' + rgb.toString(16).padStart(6, '0');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.stroke();
  }

  function width() {
    return canvas.width;
  }

  function height() {
    return canvas.height;
  }

  resize();
  return { resize, clear, line, width, height };
}

/* Wires a console + graphics pair into the machine API the interpreter
 * expects. `onScreenChange` shows/hides the two surfaces. */
export function createMachine(consoleApi, graphicsApi, onScreenChange) {
  const startTime = performance.now();
  return {
    consoleWrite(s) { consoleApi.write(s); },
    consoleClear() { consoleApi.clear(); },
    consoleLocate(row, col) { consoleApi.locate(row, col); },
    graphicsClear() { graphicsApi.clear(); },
    graphicsLine(x1, y1, x2, y2, rgb) { graphicsApi.line(x1, y1, x2, y2, rgb); },
    graphicsWidth() { return graphicsApi.width(); },
    graphicsHeight() { return graphicsApi.height(); },
    screen(mode) { onScreenChange(mode); },
    uptimeMs() { return performance.now() - startTime; },
    delay(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); },
    /* A plain paint-cycle yield, distinct from PAUSE/SLEEP's delay(ms): used
     * by the interpreter to keep a delay-free loop (e.g. `10 PRINT "HELLO" /
     * 20 GOTO 10`) from locking up input and rendering. requestAnimationFrame
     * ties it to the browser's own frame pacing, which stays responsive to
     * input far more reliably than a bare setTimeout(0) chain does. */
    yield() { return new Promise((resolve) => requestAnimationFrame(resolve)); },
  };
}
