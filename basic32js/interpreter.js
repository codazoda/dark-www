/* BASIC32 interpreter core, ported from projects/basic32/core/basic.c.
 * Depends only on an injected `machine` object (see createMachine in
 * machine.js), the same separation of concerns as basic.c/machine.h.
 *
 * Differences from the C core, both required by running in a browser
 * instead of blocking a thread:
 *  - Statement execution is async so PAUSE/SLEEP can yield to the event
 *    loop (via machine.delay) instead of blocking it.
 *  - Errors propagate as thrown BasicError instead of a manually checked
 *    flow flag; observable behavior (message text, READY. prompt, where
 *    execution stops) is unchanged.
 */

export class BasicError extends Error {
  constructor(msg) {
    super(msg);
    this.basicMsg = msg;
  }
}

const RGB_TAG = 16777216; // 0x1000000 -- see BASIC.md's RGB() tagging notes
const MAX_FOR_DEPTH = 16;
const RUN_YIELD_EVERY = 50; // statements between forced yields back to the event loop

const PALETTE = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa,
  0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff,
  0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

function isAlphaChar(c) {
  return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z';
}
function isDigitChar(c) {
  return c >= '0' && c <= '9';
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* Formats a double the way C's `snprintf(buf, n, "%.6g", v)` does: six
 * significant digits, fixed notation unless the exponent is < -4 or >= 6. */
export function formatNumber(v) {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (v === 0) return '0';
  const precision = 6;
  const neg = v < 0;
  const av = Math.abs(v);
  let exp = Math.floor(Math.log10(av));
  if (av / Math.pow(10, exp) >= 10) exp++;
  if (av / Math.pow(10, exp) < 1) exp--;
  let s;
  if (exp < -4 || exp >= precision) {
    let mantissa = av / Math.pow(10, exp);
    let m = mantissa.toFixed(precision - 1);
    if (parseFloat(m) >= 10) {
      exp++;
      m = (mantissa / 10).toFixed(precision - 1);
    }
    m = stripTrailingZeros(m);
    const sign = exp < 0 ? '-' : '+';
    const abs = String(Math.abs(exp)).padStart(2, '0');
    s = `${m}e${sign}${abs}`;
  } else {
    const decimals = Math.max(precision - 1 - exp, 0);
    s = stripTrailingZeros(av.toFixed(decimals));
  }
  return neg ? '-' + s : s;
}

function stripTrailingZeros(s) {
  if (s.indexOf('.') === -1) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/* A cursor into a single line's source text -- the JS analog of the `const
 * char **p` pointer threaded through every parse function in basic.c. */
class Cursor {
  constructor(s) {
    this.s = s;
    this.i = 0;
  }
  peek() {
    return this.i < this.s.length ? this.s[this.i] : '';
  }
  eof() {
    return this.i >= this.s.length;
  }
  rest() {
    return this.s.slice(this.i);
  }
  skipSpaces() {
    while (this.peek() === ' ' || this.peek() === '\t') this.i++;
  }
  expect(ch) {
    if (this.peek() !== ch) throw new BasicError('SYNTAX');
    this.i++;
  }
}

function parseIdent(cur) {
  let s = '';
  while (isAlphaChar(cur.peek()) || isDigitChar(cur.peek())) {
    s += cur.s[cur.i].toUpperCase();
    cur.i++;
  }
  return s;
}

function callFunction(name, arg) {
  switch (name) {
    case 'ABS': return Math.abs(arg);
    case 'INT': return Math.floor(arg);
    case 'SQR':
      if (arg < 0) throw new BasicError('ILLEGAL QUANTITY');
      return Math.sqrt(arg);
    case 'SIN': return Math.sin(arg);
    case 'COS': return Math.cos(arg);
    default: throw new BasicError('SYNTAX');
  }
}

function makeRgb(rf, gf, bf) {
  const r = Math.trunc(rf), g = Math.trunc(gf), b = Math.trunc(bf);
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
    throw new BasicError('ILLEGAL QUANTITY');
  }
  return (((r << 16) | (g << 8) | b) >>> 0) + RGB_TAG;
}

function resolveColor(v) {
  if (v >= RGB_TAG) return Math.trunc(v - RGB_TAG);
  const idx = Math.trunc(v);
  if (idx < 0 || idx > 15) throw new BasicError('ILLEGAL QUANTITY');
  return PALETTE[idx];
}

export class Interpreter {
  constructor(machine) {
    this.machine = machine;
    this.init();
  }

  init() {
    this.cmdNew();
  }

  out(s) {
    this.machine.consoleWrite(s);
  }

  reportError(msg) {
    if (this.running) this.out(`?${msg} ERROR IN ${this.lines[this.pc].number}\n`);
    else this.out(`?${msg} ERROR\n`);
  }

  getVar(name) {
    if (!this.vars.has(name)) this.vars.set(name, 0);
    return this.vars.get(name);
  }

  setVar(name, v) {
    this.vars.set(name, v);
  }

  findLineIndex(number) {
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].number === number) return i;
      if (this.lines[i].number > number) break;
    }
    return -1;
  }

  storeLine(number, text) {
    const idx = this.findLineIndex(number);
    if (idx >= 0) {
      this.lines[idx].text = text;
      return;
    }
    let insertAt = this.lines.length;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].number > number) {
        insertAt = i;
        break;
      }
    }
    this.lines.splice(insertAt, 0, { number, text });
  }

  deleteLine(number) {
    const idx = this.findLineIndex(number);
    if (idx >= 0) this.lines.splice(idx, 1);
  }

  /* ---- expressions ---- */

  parseExpr(cur) {
    return this.parseCompare(cur);
  }

  parseCompare(cur) {
    const v = this.parseAddSub(cur);
    cur.skipSpaces();
    const two = cur.s.slice(cur.i, cur.i + 2);
    if (two === '<>') { cur.i += 2; return v !== this.parseAddSub(cur) ? 1 : 0; }
    if (two === '<=') { cur.i += 2; return v <= this.parseAddSub(cur) ? 1 : 0; }
    if (two === '>=') { cur.i += 2; return v >= this.parseAddSub(cur) ? 1 : 0; }
    if (cur.peek() === '<') { cur.i += 1; return v < this.parseAddSub(cur) ? 1 : 0; }
    if (cur.peek() === '>') { cur.i += 1; return v > this.parseAddSub(cur) ? 1 : 0; }
    if (cur.peek() === '=') { cur.i += 1; return v === this.parseAddSub(cur) ? 1 : 0; }
    return v;
  }

  parseAddSub(cur) {
    let v = this.parseTerm(cur);
    for (;;) {
      cur.skipSpaces();
      if (cur.peek() === '+') { cur.i++; v += this.parseTerm(cur); }
      else if (cur.peek() === '-') { cur.i++; v -= this.parseTerm(cur); }
      else break;
    }
    return v;
  }

  parseTerm(cur) {
    let v = this.parseUnary(cur);
    for (;;) {
      cur.skipSpaces();
      if (cur.peek() === '*') {
        cur.i++;
        v *= this.parseUnary(cur);
      } else if (cur.peek() === '/') {
        cur.i++;
        const rhs = this.parseUnary(cur);
        if (rhs === 0) throw new BasicError('DIVISION BY ZERO');
        v /= rhs;
      } else break;
    }
    return v;
  }

  parseUnary(cur) {
    cur.skipSpaces();
    if (cur.peek() === '-') { cur.i++; return -this.parseUnary(cur); }
    if (cur.peek() === '+') { cur.i++; return this.parseUnary(cur); }
    return this.parsePrimary(cur);
  }

  parsePrimary(cur) {
    cur.skipSpaces();
    if (cur.peek() === '(') {
      cur.i++;
      const v = this.parseExpr(cur);
      cur.skipSpaces();
      cur.expect(')');
      return v;
    }
    if (isDigitChar(cur.peek()) || cur.peek() === '.') {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(cur.rest());
      cur.i += m[0].length;
      return parseFloat(m[0]);
    }
    if (isAlphaChar(cur.peek())) {
      const name = parseIdent(cur);
      cur.skipSpaces();
      if (cur.peek() === '(') {
        cur.i++;
        if (name === 'RGB') {
          const r = this.parseExpr(cur);
          cur.skipSpaces();
          cur.expect(',');
          const g = this.parseExpr(cur);
          cur.skipSpaces();
          cur.expect(',');
          const b = this.parseExpr(cur);
          cur.skipSpaces();
          cur.expect(')');
          return makeRgb(r, g, b);
        }
        const arg = this.parseExpr(cur);
        cur.skipSpaces();
        cur.expect(')');
        return callFunction(name, arg);
      }
      if (name === 'TICK') return this.machine.uptimeMs();
      if (name === 'GWIDTH') return this.machine.graphicsWidth();
      if (name === 'GHEIGHT') return this.machine.graphicsHeight();
      return this.getVar(name);
    }
    throw new BasicError('SYNTAX');
  }

  /* ---- statements ---- */

  execPrint(cur) {
    let suppressNewline = false;
    cur.skipSpaces();
    if (cur.eof()) { this.out('\n'); return; }
    for (;;) {
      cur.skipSpaces();
      if (cur.peek() === '"') {
        cur.i++;
        const start = cur.i;
        while (!cur.eof() && cur.peek() !== '"') cur.i++;
        this.out(cur.s.slice(start, cur.i));
        if (cur.peek() === '"') cur.i++;
        suppressNewline = false;
      } else if (cur.peek() === ',' || cur.peek() === ';' || cur.eof()) {
        /* empty item: a trailing separator's suppress_newline (set below
         * on the previous iteration) must survive this final no-op pass,
         * so it's deliberately left untouched here. */
      } else {
        const v = this.parseExpr(cur);
        this.out(formatNumber(v));
        suppressNewline = false;
      }
      cur.skipSpaces();
      if (cur.peek() === ',') { cur.i++; this.out('\t'); suppressNewline = true; }
      else if (cur.peek() === ';') { cur.i++; suppressNewline = true; }
      else break;
    }
    if (!suppressNewline) this.out('\n');
  }

  execLet(cur) {
    cur.skipSpaces();
    if (!isAlphaChar(cur.peek())) throw new BasicError('SYNTAX');
    const name = parseIdent(cur);
    cur.skipSpaces();
    cur.expect('=');
    const v = this.parseExpr(cur);
    this.setVar(name, v);
  }

  execGoto(cur) {
    if (!this.running) throw new BasicError('ILLEGAL DIRECT');
    cur.skipSpaces();
    const m = /^-?\d+/.exec(cur.rest());
    if (!m) throw new BasicError('SYNTAX');
    cur.i += m[0].length;
    this.flow = { type: 'goto', target: parseInt(m[0], 10) };
  }

  async execIf(cur) {
    const cond = this.parseExpr(cur);
    cur.skipSpaces();
    let kw = '';
    if (isAlphaChar(cur.peek())) kw = parseIdent(cur);
    if (kw !== 'THEN') throw new BasicError('SYNTAX');
    if (cond === 0) return;
    cur.skipSpaces();
    if (isDigitChar(cur.peek())) {
      this.execGoto(cur);
    } else {
      await this.execStatement(cur);
      cur.i = cur.s.length;
    }
  }

  execFor(cur) {
    cur.skipSpaces();
    if (!isAlphaChar(cur.peek())) throw new BasicError('SYNTAX');
    const name = parseIdent(cur);
    cur.skipSpaces();
    cur.expect('=');
    const start = this.parseExpr(cur);
    cur.skipSpaces();
    let kw = '';
    if (isAlphaChar(cur.peek())) kw = parseIdent(cur);
    if (kw !== 'TO') throw new BasicError('SYNTAX');
    const limit = this.parseExpr(cur);
    let step = 1;
    cur.skipSpaces();
    const save = cur.i;
    if (isAlphaChar(cur.peek())) {
      kw = parseIdent(cur);
      if (kw === 'STEP') step = this.parseExpr(cur);
      else cur.i = save;
    }
    if (!this.running) throw new BasicError('ILLEGAL DIRECT');
    if (this.forStack.length >= MAX_FOR_DEPTH) throw new BasicError('FOR TOO DEEP');
    this.setVar(name, start);
    this.forStack.push({ varName: name, limit, step, returnIndex: this.pc + 1 });
  }

  execNext(cur) {
    if (!this.running) throw new BasicError('ILLEGAL DIRECT');
    cur.skipSpaces();
    if (isAlphaChar(cur.peek())) parseIdent(cur); /* Phase 1: always the top-of-stack loop */
    if (this.forStack.length === 0) throw new BasicError('NEXT WITHOUT FOR');
    const f = this.forStack[this.forStack.length - 1];
    const v = this.getVar(f.varName) + f.step;
    this.setVar(f.varName, v);
    const cont = f.step >= 0 ? v <= f.limit : v >= f.limit;
    if (cont) {
      this.pc = f.returnIndex;
      this.jumped = true;
    } else {
      this.forStack.pop();
    }
  }

  execCls() {
    if (this.screenMode === 1) this.machine.graphicsClear();
    else this.machine.consoleClear();
  }

  execScreen(cur) {
    const mode = this.parseExpr(cur);
    const m = Math.trunc(mode);
    if (m !== 0 && m !== 1) throw new BasicError('ILLEGAL QUANTITY');
    this.screenMode = m;
    this.machine.screen(m);
  }

  /* LINE (x1,y1)-(x2,y2),color -- the only statement with this bracketed,
   * comma-and-dash syntax, so it parses itself. */
  execLine(cur) {
    if (this.screenMode !== 1) throw new BasicError('ILLEGAL IN SCREEN 0');
    cur.skipSpaces();
    cur.expect('(');
    const x1 = this.parseExpr(cur);
    cur.skipSpaces();
    cur.expect(',');
    const y1 = this.parseExpr(cur);
    cur.skipSpaces();
    cur.expect(')');
    cur.skipSpaces();
    cur.expect('-');
    cur.skipSpaces();
    cur.expect('(');
    const x2 = this.parseExpr(cur);
    cur.skipSpaces();
    cur.expect(',');
    const y2 = this.parseExpr(cur);
    cur.skipSpaces();
    cur.expect(')');
    cur.skipSpaces();
    cur.expect(',');
    const color = this.parseExpr(cur);
    const rgb = resolveColor(color);
    this.machine.graphicsLine(Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2), rgb);
  }

  execLocate(cur) {
    const row = this.parseExpr(cur);
    cur.skipSpaces();
    cur.expect(',');
    const col = this.parseExpr(cur);
    this.machine.consoleLocate(Math.trunc(row), Math.trunc(col));
  }

  async execPause(cur) {
    const tenths = this.parseExpr(cur);
    await this.machine.delay(tenths * 100);
  }

  async execSleep(cur) {
    const seconds = this.parseExpr(cur);
    await this.machine.delay(seconds * 1000);
  }

  async execStatement(cur) {
    cur.skipSpaces();
    if (cur.eof()) return;
    if (cur.peek() === "'") return; /* tolerate a bare comment marker */
    if (!isAlphaChar(cur.peek())) throw new BasicError('SYNTAX');

    const save = cur.i;
    const kw = parseIdent(cur);
    cur.skipSpaces();
    switch (kw) {
      case 'REM': return;
      case 'PRINT': this.execPrint(cur); return;
      case 'LET': this.execLet(cur); return;
      case 'GOTO': this.execGoto(cur); return;
      case 'IF': await this.execIf(cur); return;
      case 'FOR': this.execFor(cur); return;
      case 'NEXT': this.execNext(cur); return;
      case 'END': this.flow = { type: 'end' }; return;
      case 'CLS': this.execCls(cur); return;
      case 'LOCATE': this.execLocate(cur); return;
      case 'PAUSE': await this.execPause(cur); return;
      case 'SLEEP': await this.execSleep(cur); return;
      case 'SCREEN': this.execScreen(cur); return;
      case 'LINE': this.execLine(cur); return;
      default:
        if (cur.peek() === '=') { cur.i = save; this.execLet(cur); return; }
        throw new BasicError('SYNTAX');
    }
  }

  /* ---- commands ---- */

  cmdList() {
    for (const line of this.lines) this.out(`${line.number} ${line.text}\n`);
  }

  cmdNew() {
    this.lines = [];
    this.vars = new Map();
    this.forStack = [];
    this.screenMode = 0;
    this.pc = 0;
    this.running = false;
    this.jumped = false;
    this.flow = null;
    this.machine.screen(0);
  }

  /* Runs the stored program from its lowest line number. `maxIterations`
   * bounds how many statements execute before stopping -- unused by normal
   * RUN (default unlimited), but lets a host (e.g. the test harness) run an
   * intentionally-endless animation loop "far enough" to inspect instead of
   * awaiting a promise that would otherwise never resolve. */
  async run(maxIterations = Infinity) {
    this.pc = 0;
    this.running = true;
    this.forStack = [];
    this.flow = null;
    let iterations = 0;
    try {
      while (this.pc < this.lines.length && iterations < maxIterations) {
        iterations++;
        this.jumped = false;
        this.flow = null;
        const cur = new Cursor(this.lines[this.pc].text);
        await this.execStatement(cur);
        if (this.flow && this.flow.type === 'goto') {
          const idx = this.findLineIndex(this.flow.target);
          if (idx < 0) throw new BasicError("UNDEF'D STATEMENT");
          this.pc = idx;
        } else if (this.flow && this.flow.type === 'end') {
          break;
        } else if (!this.jumped) {
          this.pc++;
        }
        /* A program with no PAUSE/SLEEP (e.g. the classic `10 PRINT "HELLO"
         * / 20 GOTO 10`) never otherwise awaits anything, so without this
         * the tab would lock up solid instead of just scrolling fast. */
        if (iterations % RUN_YIELD_EVERY === 0) await this.machine.yield();
      }
    } catch (e) {
      if (e instanceof BasicError) this.reportError(e.basicMsg);
      else throw e;
    } finally {
      this.running = false;
    }
  }

  /* ---- top-level line dispatch ---- */

  async inputLine(rawLine) {
    const line = rawLine.replace(/[\r\n \t]+$/, '');
    const cur = new Cursor(line);
    cur.skipSpaces();
    if (cur.eof()) return;

    if (isDigitChar(cur.peek())) {
      const m = /^\d+/.exec(cur.rest());
      const number = parseInt(m[0], 10);
      cur.i += m[0].length;
      cur.skipSpaces();
      if (cur.eof()) this.deleteLine(number);
      else this.storeLine(number, cur.rest());
      return;
    }

    const save = cur.i;
    const kw = parseIdent(cur);
    cur.skipSpaces();
    if (kw === 'RUN' && cur.eof()) { await this.run(); this.out('\nREADY.\n'); return; }
    if (kw === 'LIST' && cur.eof()) { this.cmdList(); this.out('READY.\n'); return; }
    if (kw === 'NEW' && cur.eof()) { this.cmdNew(); this.out('READY.\n'); return; }

    cur.i = save;
    try {
      this.flow = null;
      await this.execStatement(cur);
    } catch (e) {
      if (e instanceof BasicError) this.reportError(e.basicMsg);
      else throw e;
    } finally {
      this.out('READY.\n');
    }
  }

  /* Splits multi-line source text and stores each line as if typed, without
   * executing anything or printing READY. Used to seed an embedded program. */
  loadSource(source) {
    for (const raw of source.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const cur = new Cursor(line);
      cur.skipSpaces();
      if (cur.eof()) continue;
      if (isDigitChar(cur.peek())) {
        const m = /^\d+/.exec(cur.rest());
        const number = parseInt(m[0], 10);
        cur.i += m[0].length;
        cur.skipSpaces();
        this.storeLine(number, cur.rest());
      }
    }
  }
}
