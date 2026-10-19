// Coordinate transforms and grid snapping. World coordinates are Cartesian
// with +Y up; screen coordinates are CSS pixels from the canvas's top-left.
// A view is { cx, cy, scale, w, h }: the world point at the canvas center,
// pixels per world unit, and the canvas size in pixels. Every screen<->world
// conversion in the app goes through these functions.

export const MIN_SCALE = 0.001;
export const MAX_SCALE = 100000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function worldToScreen(v, x, y) {
  return { x: (x - v.cx) * v.scale + v.w / 2, y: v.h / 2 - (y - v.cy) * v.scale };
}

export function screenToWorld(v, sx, sy) {
  return { x: (sx - v.w / 2) / v.scale + v.cx, y: v.cy - (sy - v.h / 2) / v.scale };
}

// SVG transform that draws world geometry with the same mapping as
// worldToScreen.
export function svgMatrix(v) {
  const s = v.scale;
  return `matrix(${s} 0 0 ${-s} ${v.w / 2 - v.cx * s} ${v.h / 2 + v.cy * s})`;
}

// Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen.
export function zoomAt(v, sx, sy, factor) {
  const p = screenToWorld(v, sx, sy);
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  return { ...v, scale, cx: p.x - (sx - v.w / 2) / scale, cy: p.y + (sy - v.h / 2) / scale };
}

// Move the drawing by (dx, dy) screen pixels.
export function panBy(v, dx, dy) {
  return { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale };
}

// The grid spacing actually displayed (and snapped to): the configured
// spacing, thinned by 1-2-5 steps until dots are at least minPx apart.
export function gridStep(spacing, scale, minPx = 12) {
  const factors = [2, 2.5, 2];
  let step = spacing;
  let i = 0;
  while (step * scale < minPx && step < spacing * 1e12) step *= factors[i++ % 3];
  return step;
}

const clean = (n) => Number(n.toPrecision(12)) || 0;

// Snap a world point to the nearest grid point when it lies within tolPx
// screen pixels of it.
export function snapToGrid(v, p, step, tolPx) {
  const gx = clean(Math.round(p.x / step) * step);
  const gy = clean(Math.round(p.y / step) * step);
  const d = Math.hypot((gx - p.x) * v.scale, (gy - p.y) * v.scale);
  return d <= tolPx ? { x: gx, y: gy, snapped: true } : { x: p.x, y: p.y, snapped: false };
}

// Fit world bounds { minX, minY, maxX, maxY } inside the canvas.
export function fitBounds(v, b, marginPx = 48) {
  if (!b) return { ...v, cx: 0, cy: 0 };
  const bw = Math.max(b.maxX - b.minX, 1e-9);
  const bh = Math.max(b.maxY - b.minY, 1e-9);
  const scale = clamp(Math.min((v.w - 2 * marginPx) / bw, (v.h - 2 * marginPx) / bh), MIN_SCALE, MAX_SCALE);
  return { ...v, scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}
