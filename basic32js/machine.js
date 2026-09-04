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
 * free.
 *
 * Graphics-mode text (SCREEN 1 PRINT/LOCATE, GPRINT) uses the browser's own
 * monospace font at a fixed cell size, drawn one glyph per cell so it stays
 * grid-aligned regardless of the font's exact metrics. A text cursor,
 * separate from createConsole's, is driven by textLocate/textWrite with the
 * same wrap/newline/scroll rules as the text console. */
const GFX_FONT_W = 8;
const GFX_FONT_H = 16;
const GFX_FONT = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function createGraphics(canvas) {
  const ctx = canvas.getContext('2d');
  let textCol = 0;
  let textRow = 0;

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  function textCols() {
    return Math.max(1, Math.floor(canvas.width / GFX_FONT_W));
  }
  function textRows() {
    return Math.max(1, Math.floor(canvas.height / GFX_FONT_H));
  }

  function clear() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    textCol = 0;
    textRow = 0;
  }

  function line(x1, y1, x2, y2, rgb) {
    ctx.strokeStyle = '#' + rgb.toString(16).padStart(6, '0');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.stroke();
  }

  function point(x, y, rgb) {
    ctx.fillStyle = '#' + rgb.toString(16).padStart(6, '0');
    ctx.fillRect(x, y, 1, 1);
  }

  function drawGlyph(px, py, ch) {
    ctx.font = GFX_FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ch, px, py);
  }

  function scrollIfNeeded() {
    const rows = textRows();
    while (textRow >= rows) {
      ctx.drawImage(canvas, 0, -GFX_FONT_H);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, canvas.height - GFX_FONT_H, canvas.width, GFX_FONT_H);
      textRow--;
    }
  }

  function textLocate(row, col) {
    textRow = clamp(row - 1, 0, textRows() - 1);
    textCol = clamp(col - 1, 0, textCols() - 1);
  }

  function textWrite(s) {
    const cols = textCols();
    for (const ch of s) {
      if (ch === '\n') {
        textCol = 0;
        textRow++;
        scrollIfNeeded();
        continue;
      }
      if (ch === '\t') {
        textCol = (Math.floor(textCol / 8) + 1) * 8;
        if (textCol >= cols) {
          textCol = 0;
          textRow++;
          scrollIfNeeded();
        }
        continue;
      }
      if (textCol >= cols) {
        textCol = 0;
        textRow++;
        scrollIfNeeded();
      }
      drawGlyph(textCol * GFX_FONT_W, textRow * GFX_FONT_H, ch);
      textCol++;
    }
  }

  function textAt(x, y, s) {
    let cx = x;
    let cy = y;
    for (const ch of s) {
      if (ch === '\n') {
        cx = x;
        cy += GFX_FONT_H;
        continue;
      }
      drawGlyph(cx, cy, ch);
      cx += GFX_FONT_W;
    }
  }

  function width() {
    return canvas.width;
  }

  function height() {
    return canvas.height;
  }

  function fontWidth() {
    return GFX_FONT_W;
  }

  function fontHeight() {
    return GFX_FONT_H;
  }

  resize();
  return {
    resize, clear, line, point, width, height,
    fontWidth, fontHeight, textLocate, textWrite, textAt,
  };
}

/* Bounded FIFO of pending key codes, the JS analog of the ESP32's
 * button/BLE FreeRTOS queue and the POSIX host's raw keystroke read: a full
 * queue drops the newest key rather than growing or overwriting state. */
const KEY_QUEUE_MAX = 32;

export function createKeyQueue(max = KEY_QUEUE_MAX) {
  const q = [];
  return {
    push(code) {
      if (q.length >= max) return;
      q.push(code);
    },
    getc() {
      return q.length ? q.shift() : -1;
    },
  };
}

/* Wires a console + graphics pair into the machine API the interpreter
 * expects. `onScreenChange` shows/hides the two surfaces. `keyQueue` (see
 * createKeyQueue) backs inputGetc -- the app wires a keydown listener into
 * its push() to act as this port's key source, the analog of the ESP32's
 * buttons/BLE keyboard or the POSIX host's terminal. */
export function createMachine(consoleApi, graphicsApi, onScreenChange, keyQueue) {
  const startTime = performance.now();
  return {
    inputGetc() { return keyQueue.getc(); },
    consoleWrite(s) { consoleApi.write(s); },
    consoleClear() { consoleApi.clear(); },
    consoleLocate(row, col) { consoleApi.locate(row, col); },
    graphicsClear() { graphicsApi.clear(); },
    graphicsLine(x1, y1, x2, y2, rgb) { graphicsApi.line(x1, y1, x2, y2, rgb); },
    graphicsPoint(x, y, rgb) { graphicsApi.point(x, y, rgb); },
    graphicsWidth() { return graphicsApi.width(); },
    graphicsHeight() { return graphicsApi.height(); },
    graphicsFontWidth() { return graphicsApi.fontWidth(); },
    graphicsFontHeight() { return graphicsApi.fontHeight(); },
    graphicsTextLocate(row, col) { graphicsApi.textLocate(row, col); },
    graphicsText(s) { graphicsApi.textWrite(s); },
    graphicsTextAt(x, y, s) { graphicsApi.textAt(x, y, s); },
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
