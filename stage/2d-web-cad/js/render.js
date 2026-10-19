// SVG rendering. Committed geometry is drawn in world units under one
// transform (svgMatrix); the overlay — selection, preview, snap ring — is
// drawn in screen pixels from worldToScreen, the same mapping.

import { worldToScreen, svgMatrix } from './view.js';
import { fmt } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(name, attrs = {}, cls) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (cls) el.setAttribute('class', cls);
  return el;
}

export function layerColor(layer) {
  return layer.color === 'auto' ? 'var(--ink)' : layer.color;
}

export function renderEntities(g, doc) {
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  const frag = document.createDocumentFragment();
  for (const e of doc.entities) {
    const layer = layers.get(e.layerId);
    if (!layer || !layer.visible) continue;
    const node = e.type === 'line'
      ? svgEl('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }, 'entity')
      : svgEl('circle', { cx: e.cx, cy: e.cy, r: e.r }, 'entity');
    node.dataset.id = e.id;
    node.style.stroke = layerColor(layer);
    frag.append(node);
  }
  g.replaceChildren(frag);
}

export function renderView(refs, v, step) {
  refs.world.setAttribute('transform', svgMatrix(v));
  const px = step * v.scale;
  const o = worldToScreen(v, 0, 0);
  for (const [k, val] of Object.entries({ width: px, height: px, x: o.x - px / 2, y: o.y - px / 2 })) {
    refs.pattern.setAttribute(k, val);
  }
  refs.dot.setAttribute('cx', px / 2);
  refs.dot.setAttribute('cy', px / 2);
  refs.axes.replaceChildren(
    svgEl('line', { x1: 0, y1: o.y, x2: v.w, y2: o.y }, 'axis'),
    svgEl('line', { x1: o.x, y1: 0, x2: o.x, y2: v.h }, 'axis'),
  );
}

function screenShape(v, e, cls) {
  if (e.type === 'line') {
    const a = worldToScreen(v, e.x1, e.y1);
    const b = worldToScreen(v, e.x2, e.y2);
    return svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, cls);
  }
  const c = worldToScreen(v, e.cx, e.cy);
  return svgEl('circle', { cx: c.x, cy: c.y, r: e.r * v.scale }, cls);
}

function handle(p) {
  return svgEl('rect', { x: p.x - 6, y: p.y - 6, width: 12, height: 12 }, 'handle');
}

function label(p, text) {
  return Object.assign(svgEl('text', { x: p.x + 14, y: p.y - 14 }, 'label'), { textContent: text });
}

// state: { v, selected, preview, cursor }
export function renderOverlay(g, { v, selected, preview, cursor }) {
  const out = [];
  if (selected) {
    out.push(screenShape(v, selected, 'halo'));
    const pts = selected.type === 'line'
      ? [[selected.x1, selected.y1], [selected.x2, selected.y2]]
      : [[selected.cx, selected.cy], [selected.cx + selected.r, selected.cy]];
    for (const [x, y] of pts) out.push(handle(worldToScreen(v, x, y)));
  }
  if (preview) {
    out.push(screenShape(v, preview, 'preview'));
    if (preview.type === 'circle' && cursor) {
      const c = worldToScreen(v, preview.cx, preview.cy);
      const p = worldToScreen(v, cursor.x, cursor.y);
      out.push(svgEl('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y }, 'preview radius'));
      out.push(label(p, `r = ${fmt(preview.r)}`));
    }
  }
  if (cursor) {
    const p = worldToScreen(v, cursor.x, cursor.y);
    if (cursor.snapped) {
      out.push(svgEl('circle', { cx: p.x, cy: p.y, r: 10 }, 'snap-outer'));
      out.push(svgEl('circle', { cx: p.x, cy: p.y, r: 10 }, 'snap-inner'));
    } else {
      out.push(svgEl('path', { d: `M${p.x - 8} ${p.y}h16M${p.x} ${p.y - 8}v16` }, 'crosshair'));
    }
  }
  g.replaceChildren(...out);
}
