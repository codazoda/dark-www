// Shared renderer: owns the 4x6in artboard, safe margins, the `createPath`
// builder that validates as drawing modules draw through it, closure, and
// SVG serialization.

const ARTBOARD_WIDTH_IN = 4;
const ARTBOARD_HEIGHT_IN = 6;
const UNITS_PER_INCH = 72; // arbitrary but generous coordinate resolution
const ARTBOARD_WIDTH = ARTBOARD_WIDTH_IN * UNITS_PER_INCH;
const ARTBOARD_HEIGHT = ARTBOARD_HEIGHT_IN * UNITS_PER_INCH;
const SAFE_MARGIN = 0.25 * UNITS_PER_INCH;
const STROKE_WIDTH = 1.5;
const CLOSE_PATH_DEFAULT = true;

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

// Builder drawing modules call directly instead of returning a `d` string
// for the renderer to reparse. Validates every call against `bounds`, so a
// bad coordinate throws right where it was produced. Lifting the pen (a
// second `M`) is unrepresentable rather than rejected: there's no `moveTo`.
export function createPath(bounds) {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const commands = [];
  let penX = null;
  let penY = null;

  function checkFinite(method, args) {
    if (args.some((v) => !Number.isFinite(v))) {
      throw new Error(`${method}(${args.join(", ")}) has a non-finite coordinate`);
    }
  }

  function checkBounds(method, args) {
    for (let p = 0; p < args.length; p += 2) {
      const x = args[p];
      const y = args[p + 1];
      if (x < minX || x > maxX || y < minY || y > maxY) {
        throw new Error(`${method}(${args.join(", ")}) leaves the artboard's safe margins`);
      }
    }
  }

  return {
    lineTo(x, y) {
      checkFinite("lineTo", [x, y]);
      checkBounds("lineTo", [x, y]);
      if (penX === x && penY === y) return;
      commands.push({ cmd: commands.length === 0 ? "M" : "L", args: [x, y] });
      penX = x;
      penY = y;
    },
    curveTo(c1x, c1y, c2x, c2y, x, y) {
      if (commands.length === 0) {
        throw new Error("path must begin with a point");
      }
      checkFinite("curveTo", [c1x, c1y, c2x, c2y, x, y]);
      checkBounds("curveTo", [c1x, c1y, c2x, c2y, x, y]);
      commands.push({ cmd: "C", args: [c1x, c1y, c2x, c2y, x, y] });
      penX = x;
      penY = y;
    },
    quadTo(cx, cy, x, y) {
      if (commands.length === 0) {
        throw new Error("path must begin with a point");
      }
      checkFinite("quadTo", [cx, cy, x, y]);
      checkBounds("quadTo", [cx, cy, x, y]);
      commands.push({ cmd: "Q", args: [cx, cy, x, y] });
      penX = x;
      penY = y;
    },
    get commands() {
      return commands;
    },
  };
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

// Builds the full SVG document for one generated drawing. `path` is
// already validated per-call by `createPath`; this only checks it's
// non-empty before serializing.
export function buildDrawing({ filename, seed, path, closePath = CLOSE_PATH_DEFAULT }) {
  let commands = path.commands;
  if (commands.length === 0) {
    throw new Error("path has no commands");
  }

  if (closePath) {
    commands = [...commands, { cmd: "Z", args: [] }];
  }

  const d = serializeCommands(commands);
  const meta = JSON.stringify({ drawing: filename, seed });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ARTBOARD_WIDTH_IN}in" height="${ARTBOARD_HEIGHT_IN}in" viewBox="0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}">
<title>${escapeXml(filename)}</title>
<metadata>${escapeXml(meta)}</metadata>
<rect x="0" y="0" width="${ARTBOARD_WIDTH}" height="${ARTBOARD_HEIGHT}" fill="#ffffff"/>
<path d="${d}" fill="none" stroke="#000000" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
