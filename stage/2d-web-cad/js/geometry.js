// Entity geometry: distances for hit testing and drawing bounds.

import { screenToWorld } from './view.js';

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// World-space distance from point (x, y) to the entity's stroke.
export function distToEntity(e, x, y) {
  if (e.type === 'line') return distToSegment(x, y, e.x1, e.y1, e.x2, e.y2);
  if (e.type === 'circle') return Math.abs(Math.hypot(x - e.cx, y - e.cy) - e.r);
  return Infinity;
}

// Id of the pickable entity nearest screen point (sx, sy) within tolPx
// screen pixels, or null. Later (topmost) entities win ties.
export function hitTest(entities, pickable, v, sx, sy, tolPx) {
  const p = screenToWorld(v, sx, sy);
  let best = null;
  let bestD = tolPx;
  for (const e of entities) {
    if (!pickable(e)) continue;
    const d = distToEntity(e, p.x, p.y) * v.scale;
    if (d <= bestD) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

export function entityBounds(entities) {
  if (!entities.length) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of entities) {
    const [x0, y0, x1, y1] = e.type === 'line'
      ? [Math.min(e.x1, e.x2), Math.min(e.y1, e.y2), Math.max(e.x1, e.x2), Math.max(e.y1, e.y2)]
      : [e.cx - e.r, e.cy - e.r, e.cx + e.r, e.cy + e.r];
    b.minX = Math.min(b.minX, x0);
    b.minY = Math.min(b.minY, y0);
    b.maxX = Math.max(b.maxX, x1);
    b.maxY = Math.max(b.maxY, y1);
  }
  return b;
}
