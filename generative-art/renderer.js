// Shared renderer: owns the 4x6in artboard, safe margins, path validation,
// closure, and SVG serialization. Drawing modules only ever see `rng` and
// `bounds` — they never touch any of this directly.

const ARTBOARD_WIDTH_IN = 4;
const ARTBOARD_HEIGHT_IN = 6;
const UNITS_PER_INCH = 72; // arbitrary but generous coordinate resolution
const ARTBOARD_WIDTH = ARTBOARD_WIDTH_IN * UNITS_PER_INCH;
const ARTBOARD_HEIGHT = ARTBOARD_HEIGHT_IN * UNITS_PER_INCH;
const SAFE_MARGIN = 0.25 * UNITS_PER_INCH;
const STROKE_WIDTH = 1.5;
const CLOSE_PATH_DEFAULT = true;

const ARG_COUNTS = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

// mulberry32 - small, deterministic, good enough for generative sketches.
export function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getBounds() {
  return {
    x: SAFE_MARGIN,
    y: SAFE_MARGIN,
    width: ARTBOARD_WIDTH - SAFE_MARGIN * 2,
    height: ARTBOARD_HEIGHT - SAFE_MARGIN * 2,
  };
}

export function parsePathData(d) {
  if (typeof d !== "string" || d.trim() === "") {
    throw new Error("path data is empty");
  }
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  if (!tokens) {
    throw new Error("path data contains no recognizable commands");
  }
  const commands = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (!(cmd in ARG_COUNTS)) {
      throw new Error(`unsupported command "${cmd}" (only M, L, C, Q, Z are allowed)`);
    }
    i++;
    const argCount = ARG_COUNTS[cmd];
    const args = [];
    for (let a = 0; a < argCount; a++) {
      const raw = tokens[i++];
      const value = Number(raw);
      if (raw === undefined || !Number.isFinite(value)) {
        throw new Error(`command "${cmd}" is missing a finite argument`);
      }
      args.push(value);
    }
    commands.push({ cmd, args });
  }
  return commands;
}

export function validatePath(commands, bounds) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error("path has no commands");
  }
  if (commands[0].cmd !== "M") {
    throw new Error("path must begin with a single move command");
  }
  for (let i = 1; i < commands.length; i++) {
    const cmd = commands[i].cmd;
    if (cmd === "M") {
      throw new Error("path contains a second move command, which would lift the tool");
    }
    if (cmd === "Z" && i !== commands.length - 1) {
      throw new Error("path close command must be the last command");
    }
  }
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  for (const { cmd, args } of commands) {
    if (cmd === "Z") continue;
    for (let p = 0; p < args.length; p += 2) {
      const x = args[p];
      const y = args[p + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("path contains a non-finite coordinate");
      }
      if (x < minX || x > maxX || y < minY || y > maxY) {
        throw new Error("path leaves the artboard's safe margins");
      }
    }
  }
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function serializeCommands(commands) {
  return commands.map(({ cmd, args }) => `${cmd}${args.map(round).join(",")}`).join(" ");
}

function escapeXml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]);
}

// Builds and validates the full SVG document for one generated drawing.
// Throws with a readable message if the path data breaks the contract.
export function buildDrawing({ filename, seed, pathData, closePath = CLOSE_PATH_DEFAULT }) {
  const bounds = getBounds();
  let commands = parsePathData(pathData);

  const last = commands[commands.length - 1];
  if (closePath && last.cmd !== "Z") {
    commands = [...commands, { cmd: "Z", args: [] }];
  }

  validatePath(commands, bounds);

  const d = serializeCommands(commands);
  const meta = JSON.stringify({ drawing: filename, seed });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ARTBOARD_WIDTH_IN}in" height="${ARTBOARD_HEIGHT_IN}in" viewBox="0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}">
<title>${escapeXml(filename)}</title>
<metadata>${escapeXml(meta)}</metadata>
<rect x="0" y="0" width="${ARTBOARD_WIDTH}" height="${ARTBOARD_HEIGHT}" fill="#ffffff"/>
<path d="${d}" fill="none" stroke="#000000" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
