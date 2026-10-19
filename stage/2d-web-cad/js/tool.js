// Command state machine. A tool state is { tool, phase, first }:
//   select                        phase 'idle'
//   line / circle                 'awaiting-first-point' -> 'awaiting-second-point'
// Only placePoint ever produces an entity, and only from a complete pair of
// points, so cancel, tool switching, and gestures cannot leave a partial one.

import { validateGeometry } from './model.js';

export const TOOLS = [
  { id: 'select', label: 'Select', ready: true },
  { id: 'line', label: 'Line', ready: true },
  { id: 'circle', label: 'Circle', ready: true },
  { id: 'rectangle', label: 'Rectangle', ready: false },
  { id: 'arc', label: 'Arc', ready: false },
];

export function initialToolState() {
  return { tool: 'select', phase: 'idle', first: null };
}

export function isDrawing(s) {
  return s.phase !== 'idle';
}

export function selectTool(s, tool) {
  const t = TOOLS.find((x) => x.id === tool);
  if (!t || !t.ready) return s;
  if (tool === 'select') return initialToolState();
  return { tool, phase: 'awaiting-first-point', first: null };
}

function geometryFrom(tool, a, b) {
  if (tool === 'line') return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  if (tool === 'circle') return { cx: a.x, cy: a.y, r: Math.hypot(b.x - a.x, b.y - a.y) };
  return null;
}

// Returns { state, entity?, error? }. `entity` is { type, ...geometry }.
export function placePoint(s, p) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { state: s, error: 'Enter numbers for X and Y' };
  if (s.phase === 'awaiting-first-point') {
    return { state: { ...s, phase: 'awaiting-second-point', first: { x: p.x, y: p.y } } };
  }
  if (s.phase === 'awaiting-second-point') {
    const g = geometryFrom(s.tool, s.first, p);
    const error = validateGeometry(s.tool, g);
    if (error) return { state: s, error };
    return { state: { ...s, phase: 'awaiting-first-point', first: null }, entity: { type: s.tool, ...g } };
  }
  return { state: s };
}

// Live preview geometry for the entity in progress, or null.
export function previewGeometry(s, p) {
  if (s.phase !== 'awaiting-second-point' || !p) return null;
  return { type: s.tool, ...geometryFrom(s.tool, s.first, p) };
}

// Cancel drops the entity in progress; with nothing in progress it ends the
// command like Done.
export function cancel(s) {
  if (s.phase === 'awaiting-second-point') return { ...s, phase: 'awaiting-first-point', first: null };
  return initialToolState();
}

export function done() {
  return initialToolState();
}

export function prompt(s) {
  if (s.tool === 'line') return s.phase === 'awaiting-first-point' ? 'Line: choose first point' : 'Line: choose end point';
  if (s.tool === 'circle') return s.phase === 'awaiting-first-point' ? 'Circle: choose center' : 'Circle: choose radius';
  return 'Select: tap a shape or a History row';
}
