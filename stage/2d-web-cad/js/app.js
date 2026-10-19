// UI wiring: pointer input, panels, autosave. Geometry, validation, tool
// state, transforms, and undo live in their own modules; this file only
// connects them to the page.

import {
  DEFAULT_LAYER_ID, ENTITY_FIELDS, addEntity, addLayer, deleteEntity, deleteLayer,
  describeEntity, drawingOf, findEntity, findLayer, fmt, newDocument, parseDocument,
  parseNumber, serializeDocument, setActiveLayer, updateEntity, updateLayer, withDrawing,
} from './model.js';
import { fitBounds, gridStep, panBy, screenToWorld, snapToGrid, zoomAt } from './view.js';
import { entityBounds, hitTest } from './geometry.js';
import * as tools from './tool.js';
import { UndoStack } from './undo.js';
import { renderEntities, renderOverlay, renderView, layerColor } from './render.js';
import { loadDocument, loadTheme, saveDocument, saveTheme } from './storage.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const refs = { world: $('world'), pattern: $('grid-pattern'), dot: $('grid-dot'), axes: $('axes') };

const SNAP_TOLERANCE = { touch: 24, pen: 16, mouse: 14 };
const HIT_TOLERANCE = { touch: 22, pen: 14, mouse: 10 };
const DRAG_THRESHOLD = 6;

// ---- state -----------------------------------------------------------------

let doc;
let storageBlocked = false;
let tool = tools.initialToolState();
let selectedId = null;
let cursor = null; // world point { x, y, snapped } under the pointer
let typedPoint = null; // point being typed in the coordinate bar
let size = { w: 1, h: 1 };
let panelTab = 'history';
let confirmDeleteEntity = null;
let confirmDeleteLayer = null;
const undo = new UndoStack(100);

const view = () => ({ ...doc.view, ...size });
const step = () => gridStep(doc.settings.gridSpacing, doc.view.scale);
const layerOf = (e) => findLayer(doc, e.layerId);
const pickable = (e) => {
  const l = layerOf(e);
  return !!l && l.visible && !l.locked;
};

// ---- persistence -----------------------------------------------------------

function save() {
  if (!storageBlocked) saveDocument(doc);
}

let viewTimer = 0;
function saveViewSoon() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(save, 400);
}

// Every undoable change goes through here.
function commit(next) {
  undo.record(drawingOf(doc));
  doc = next;
  save();
  renderAll();
}

function replaceDocument(next) {
  doc = next;
  undo.clear();
  tool = tools.initialToolState();
  selectedId = null;
  confirmDeleteEntity = confirmDeleteLayer = null;
  storageBlocked = false;
  $('message').hidden = true;
  save();
  renderAll();
}

// ---- theme -----------------------------------------------------------------

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => loadTheme() || (systemDark.matches ? 'dark' : 'light');

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  $('theme-btn').textContent = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

systemDark.addEventListener('change', applyTheme);
$('theme-btn').addEventListener('click', () => {
  saveTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
});

// ---- messages --------------------------------------------------------------

let messageTimer = 0;
function flash(text, sticky = false) {
  const m = $('message');
  m.textContent = text;
  m.hidden = false;
  clearTimeout(messageTimer);
  if (!sticky) messageTimer = setTimeout(() => { m.hidden = true; }, 4000);
}

// ---- rendering -------------------------------------------------------------

function renderAll() {
  if (selectedId) {
    const e = findEntity(doc, selectedId);
    if (!e || !pickable(e)) selectedId = null;
  }
  renderEntities($('entities'), doc);
  renderCanvas();
  renderChrome();
  renderPanel();
}

function renderCanvas() {
  const v = view();
  renderView(refs, v, step());
  const point = typedPoint || cursor;
  renderOverlay($('overlay'), {
    v,
    selected: selectedId ? findEntity(doc, selectedId) : null,
    preview: tools.previewGeometry(tool, point),
    cursor: tools.isDrawing(tool) ? point : null,
  });
}

function renderChrome() {
  const drawing = tools.isDrawing(tool);
  const selected = selectedId && findEntity(doc, selectedId);
  $('prompt').textContent = selected && !drawing ? `Selected: ${describeEntity(selected)}` : tools.prompt(tool);
  $('cancel-btn').hidden = !drawing;
  $('done-btn').hidden = !drawing;
  $('edit-btn').hidden = drawing || !selected;
  $('undo-btn').disabled = !undo.canUndo;
  $('redo-btn').disabled = !undo.canRedo;
  const snap = $('snap-btn');
  snap.setAttribute('aria-pressed', String(doc.settings.snap));
  snap.textContent = doc.settings.snap ? '✓Snap' : 'Snap';
  $('coord-set').disabled = !drawing;
  renderToolSheet();
}

function renderToolSheet() {
  const sheet = $('tool-sheet');
  sheet.replaceChildren(...tools.TOOLS.map((t) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(tool.tool === t.id));
    b.dataset.tool = t.id;
    b.disabled = !t.ready;
    b.innerHTML = `<span class="mark" aria-hidden="true">${tool.tool === t.id ? '✓' : ''}</span>${t.label}`
      + (t.ready ? '' : ' <small>Coming later</small>');
    return b;
  }));
}

function renderPanel() {
  for (const b of document.querySelectorAll('[role=tab]')) {
    const on = b.dataset.tab === panelTab;
    b.setAttribute('aria-selected', String(on));
    $(`tab-${b.dataset.tab}`).hidden = !on;
  }
  renderHistory();
  renderLayers();
  const spacing = $('grid-spacing');
  if (document.activeElement !== spacing) spacing.value = doc.settings.gridSpacing;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('aria-') || k === 'role' || k === 'for') el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

function swatch(layer) {
  const s = h('span', { className: 'swatch', 'aria-hidden': 'true' });
  s.style.background = layerColor(layer);
  return s;
}

function renderHistory() {
  const list = $('history-list');
  $('history-empty').hidden = doc.entities.length > 0;
  list.replaceChildren(...doc.entities.map((e, i) => {
    const layer = layerOf(e);
    const state = !layer.visible ? 'hidden' : layer.locked ? 'locked' : '';
    const selected = e.id === selectedId;
    const row = h('button', {
      className: 'row-main', type: 'button', disabled: !!state,
      'aria-pressed': String(selected), dataset: { select: e.id },
    },
    h('span', { className: 'row-num' }, `${i + 1}.`),
    h('span', { className: 'row-text' }, describeEntity(e)),
    h('span', { className: 'row-meta' }, swatch(layer), layer.name, state ? ` · ${state}` : ''));
    const li = h('li', { className: selected ? 'selected' : '' }, row);
    if (selected) li.append(editForm(e));
    return li;
  }));
  const sel = list.querySelector('li.selected');
  if (sel && !$('panel').hidden) sel.scrollIntoView({ block: 'nearest' });
}

function editForm(e) {
  const form = h('form', { className: 'edit', noValidate: true, dataset: { edit: e.id } });
  const fields = h('div', { className: 'edit-fields' });
  for (const f of ENTITY_FIELDS[e.type]) {
    fields.append(h('label', {}, f, h('input', { type: 'number', step: 'any', name: f, value: fmt(e[f]) })));
  }
  const layerSelect = h('select', { name: 'layerId' },
    ...doc.layers.map((l) => h('option', { value: l.id, selected: l.id === e.layerId }, l.name)));
  form.append(fields, h('label', { className: 'edit-layer' }, 'Layer ', layerSelect),
    h('p', { className: 'error', role: 'alert', hidden: true }));
  if (confirmDeleteEntity === e.id) {
    form.append(h('div', { className: 'actions confirm' },
      h('span', {}, `Delete this ${e.type}?`),
      h('button', { type: 'button', className: 'danger', dataset: { confirmDelete: e.id } }, 'Delete'),
      h('button', { type: 'button', dataset: { keep: '1' } }, 'Keep')));
  } else {
    form.append(h('div', { className: 'actions' },
      h('button', { type: 'submit', className: 'primary' }, 'Apply'),
      h('button', { type: 'button', dataset: { askDelete: e.id } }, 'Delete')));
  }
  return form;
}

function renderLayers() {
  const counts = new Map();
  for (const e of doc.entities) counts.set(e.layerId, (counts.get(e.layerId) || 0) + 1);
  $('layer-list').replaceChildren(...doc.layers.map((l) => {
    const isDefault = l.id === DEFAULT_LAYER_ID;
    const active = l.id === doc.activeLayerId;
    const radio = h('input', { type: 'radio', name: 'active-layer', checked: active, dataset: { active: l.id } });
    const name = h('input', {
      type: 'text', name: `name-${l.id}`, value: l.name, disabled: isDefault, maxLength: 40,
      'aria-label': 'Layer name', dataset: { rename: l.id },
    });
    const color = isDefault
      ? h('span', { className: 'auto-color', title: 'Contrasts with the canvas' }, swatch(l), 'Auto')
      : h('input', { type: 'color', name: `color-${l.id}`, value: l.color, 'aria-label': `${l.name} color`, dataset: { recolor: l.id } });
    const top = h('div', { className: 'layer-top' },
      h('label', { className: 'active-pick', title: 'Active layer' }, radio, h('span', { className: 'visually-hidden' }, `Make ${l.name} active`)),
      name, color);
    const n = counts.get(l.id) || 0;
    let bottom;
    if (confirmDeleteLayer === l.id) {
      bottom = h('div', { className: 'actions confirm' },
        h('span', {}, n ? `Delete? ${n === 1 ? '1 shape moves' : `${n} shapes move`} to Layer 1.` : 'Delete this layer?'),
        h('button', { className: 'danger', dataset: { confirmDeleteLayer: l.id } }, 'Delete'),
        h('button', { dataset: { keep: '1' } }, 'Keep'));
    } else {
      bottom = h('div', { className: 'actions' },
        h('button', { 'aria-pressed': String(!l.visible), dataset: { toggleVisible: l.id } }, l.visible ? '👁 Shown' : '— Hidden'),
        h('button', { 'aria-pressed': String(l.locked), dataset: { toggleLock: l.id } }, l.locked ? '🔒 Locked' : '🔓 Unlocked'),
        isDefault ? null : h('button', { dataset: { askDeleteLayer: l.id } }, 'Delete'));
    }
    return h('li', { className: active ? 'active' : '' }, top,
      h('p', { className: 'layer-info' }, `${active ? 'Active · ' : ''}${n} shape${n === 1 ? '' : 's'}`),
      bottom, h('p', { className: 'error', role: 'alert', hidden: true }));
  }));
}

// ---- drawing ---------------------------------------------------------------

function placeAt(p) {
  if (!tools.isDrawing(tool)) return;
  const layer = findLayer(doc, doc.activeLayerId);
  if (!layer.visible || layer.locked) {
    flash(`The active layer “${layer.name}” is ${layer.locked ? 'locked' : 'hidden'}. Pick another in Layers.`);
    return;
  }
  const r = tools.placePoint(tool, p);
  tool = r.state;
  if (r.error) flash(r.error);
  if (r.entity) {
    const { type, ...g } = r.entity;
    const added = addEntity(doc, type, g);
    if (added.error) flash(added.error);
    else commit(added.doc);
  }
  renderCanvas();
  renderChrome();
}

function setTool(id) {
  tool = tools.selectTool(tool, id);
  if (tools.isDrawing(tool)) selectedId = null;
  closeToolSheet();
  renderAll();
}

function select(id) {
  selectedId = id;
  confirmDeleteEntity = null;
  renderAll();
}

// ---- coordinate bar --------------------------------------------------------

const coordX = $('coord-x');
const coordY = $('coord-y');
const coordFocused = () => document.activeElement === coordX || document.activeElement === coordY;

function showCursorCoords() {
  if (coordFocused() || !cursor) return;
  coordX.value = fmt(cursor.x);
  coordY.value = fmt(cursor.y);
}

function readTyped() {
  return { x: parseNumber(coordX.value), y: parseNumber(coordY.value) };
}

for (const input of [coordX, coordY]) {
  input.addEventListener('input', () => {
    const p = readTyped();
    typedPoint = Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p, snapped: false } : null;
    renderCanvas();
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!coordFocused()) {
        typedPoint = null;
        renderCanvas();
      }
    });
  });
}

coordX.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    coordY.focus();
  }
});

$('coord-bar').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('coord-error');
  if (!tools.isDrawing(tool)) return;
  const p = readTyped();
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    err.textContent = 'Enter a number in both X and Y.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  placeAt(p);
  coordX.focus();
});

// ---- pointer input ---------------------------------------------------------

const pointers = new Map();
let press = null; // single-pointer press that may become a tap/placement
let gesture = null; // { type: 'pan', id, last } | { type: 'pinch', mid, dist } | { type: 'ended' }

function local(e) {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function setView(v) {
  doc.view = { cx: v.cx, cy: v.cy, scale: v.scale };
  saveViewSoon();
  if (cursorScreen) updateCursor(cursorScreen, lastPointerType);
  renderCanvas();
}

let cursorScreen = null;
let lastPointerType = 'mouse';

function updateCursor(p, type) {
  cursorScreen = p;
  lastPointerType = type;
  const v = view();
  const w = screenToWorld(v, p.x, p.y);
  cursor = doc.settings.snap
    ? snapToGrid(v, w, step(), SNAP_TOLERANCE[type] ?? 14)
    : { ...w, snapped: false };
  showCursorCoords();
  renderCanvas();
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}

svg.addEventListener('pointerdown', (e) => {
  const p = local(e);
  try {
    svg.setPointerCapture(e.pointerId);
  } catch {
    // The pointer may already be gone; capture is only a nicety.
  }
  pointers.set(e.pointerId, p);
  if (coordFocused()) document.activeElement.blur();
  closeToolSheet();
  if (e.pointerType === 'touch' && pointers.size >= 2) {
    press = null;
    gesture = { type: 'pinch', ...pinchInfo() };
    cursor = null;
    renderCanvas();
    return;
  }
  if (gesture) return;
  if (e.button === 1) {
    e.preventDefault();
    gesture = { type: 'pan', id: e.pointerId, last: p };
    return;
  }
  if (e.button !== 0) return;
  press = { id: e.pointerId, start: p, type: e.pointerType };
  if (tools.isDrawing(tool)) updateCursor(p, e.pointerType);
});

svg.addEventListener('pointermove', (e) => {
  const p = local(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (gesture?.type === 'pinch' && pointers.size >= 2) {
    const now = pinchInfo();
    let v = zoomAt(view(), gesture.mid.x, gesture.mid.y, now.dist / gesture.dist);
    v = panBy(v, now.mid.x - gesture.mid.x, now.mid.y - gesture.mid.y);
    gesture = { type: 'pinch', ...now };
    setView(v);
    return;
  }
  if (gesture?.type === 'pan' && gesture.id === e.pointerId) {
    const v = panBy(view(), p.x - gesture.last.x, p.y - gesture.last.y);
    gesture.last = p;
    setView(v);
    return;
  }
  if (gesture) return;
  if (press && press.id === e.pointerId && !tools.isDrawing(tool)
      && Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_THRESHOLD) {
    // In Select, dragging empty canvas with one pointer pans.
    gesture = { type: 'pan', id: e.pointerId, last: press.start };
    press = null;
    return;
  }
  if (tools.isDrawing(tool) && (press?.id === e.pointerId || e.pointerType !== 'touch')) {
    updateCursor(p, e.pointerType);
  }
});

function endPointer(e, cancelled) {
  const p = local(e);
  pointers.delete(e.pointerId);
  if (gesture) {
    if (gesture.type === 'pan' && gesture.id === e.pointerId) gesture = null;
    else if (gesture.type === 'pinch' && pointers.size < 2) gesture = { type: 'ended' };
    if (gesture?.type === 'ended' && pointers.size === 0) gesture = null;
    return;
  }
  if (!press || press.id !== e.pointerId) return;
  const type = press.type;
  press = null;
  if (cancelled) return;
  if (tools.isDrawing(tool)) {
    updateCursor(p, type);
    placeAt({ x: cursor.x, y: cursor.y });
  } else {
    select(hitTest(doc.entities, pickable, view(), p.x, p.y, HIT_TOLERANCE[type] ?? 10));
  }
  if (type === 'touch') {
    cursor = null;
    renderCanvas();
  }
}

svg.addEventListener('pointerup', (e) => endPointer(e, false));
svg.addEventListener('pointercancel', (e) => endPointer(e, true));
svg.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch' && !pointers.size) {
    cursor = null;
    cursorScreen = null;
    renderCanvas();
  }
});
svg.addEventListener('contextmenu', (e) => e.preventDefault());
svg.addEventListener('auxclick', (e) => e.preventDefault());

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = local(e);
  const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
  setView(zoomAt(view(), p.x, p.y, Math.exp(-e.deltaY * unit)));
}, { passive: false });

new ResizeObserver(() => {
  const r = svg.getBoundingClientRect();
  size = { w: r.width || 1, h: r.height || 1 };
  renderCanvas();
}).observe(svg);

// Keep the coordinate bar above an on-screen keyboard.
function syncKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', `${kb}px`);
}
window.visualViewport?.addEventListener('resize', syncKeyboard);
window.visualViewport?.addEventListener('scroll', syncKeyboard);

// ---- toolbar and status ----------------------------------------------------

function closeToolSheet() {
  $('tool-sheet').hidden = true;
  $('tool-btn').setAttribute('aria-expanded', 'false');
}

$('tool-btn').addEventListener('click', () => {
  const sheet = $('tool-sheet');
  sheet.hidden = !sheet.hidden;
  $('tool-btn').setAttribute('aria-expanded', String(!sheet.hidden));
  if (!sheet.hidden) sheet.querySelector('[aria-checked=true]')?.focus();
});

$('tool-sheet').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tool]');
  if (b && !b.disabled) setTool(b.dataset.tool);
});

function doUndo() {
  const snap = undo.undo(drawingOf(doc));
  if (!snap) return;
  doc = withDrawing(doc, snap);
  save();
  renderAll();
}

function doRedo() {
  const snap = undo.redo(drawingOf(doc));
  if (!snap) return;
  doc = withDrawing(doc, snap);
  save();
  renderAll();
}

$('undo-btn').addEventListener('click', doUndo);
$('redo-btn').addEventListener('click', doRedo);

$('snap-btn').addEventListener('click', () => {
  doc.settings = { ...doc.settings, snap: !doc.settings.snap };
  save();
  if (cursorScreen) updateCursor(cursorScreen, lastPointerType);
  renderChrome();
});

$('fit-btn').addEventListener('click', () => {
  const visible = doc.entities.filter((e) => layerOf(e).visible);
  setView(fitBounds(view(), entityBounds(visible)));
});

$('cancel-btn').addEventListener('click', () => {
  tool = tools.cancel(tool);
  renderCanvas();
  renderChrome();
});

$('done-btn').addEventListener('click', () => {
  tool = tools.done(tool);
  renderCanvas();
  renderChrome();
});

$('edit-btn').addEventListener('click', () => openPanel('history'));

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, select, textarea');
  if (e.key === 'Escape') {
    if (!$('tool-sheet').hidden) closeToolSheet();
    else if (tools.isDrawing(tool)) tool = tools.cancel(tool);
    else selectedId = null;
    renderAll();
    return;
  }
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    doRedo();
  }
});

// ---- panel -----------------------------------------------------------------

function openPanel(tab) {
  if (tab) panelTab = tab;
  $('panel').hidden = false;
  $('panel-btn').setAttribute('aria-expanded', 'true');
  renderPanel();
}

function closePanel() {
  $('panel').hidden = true;
  $('panel-btn').setAttribute('aria-expanded', 'false');
}

$('panel-btn').addEventListener('click', () => ($('panel').hidden ? openPanel() : closePanel()));
$('panel-close').addEventListener('click', closePanel);
for (const b of document.querySelectorAll('[role=tab]')) {
  b.addEventListener('click', () => openPanel(b.dataset.tab));
}

function showRowError(target, text) {
  const err = target.closest('li').querySelector('.error');
  err.textContent = text;
  err.hidden = false;
}

$('history-list').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.select) select(d.select === selectedId ? null : d.select);
  else if (d.askDelete) { confirmDeleteEntity = d.askDelete; renderHistory(); }
  else if (d.keep) { confirmDeleteEntity = null; renderHistory(); }
  else if (d.confirmDelete) {
    const r = deleteEntity(doc, d.confirmDelete);
    confirmDeleteEntity = null;
    if (r.error) return showRowError(b, r.error);
    selectedId = null;
    commit(r.doc);
    flash('Shape deleted. Undo restores it.');
  }
});

$('history-list').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.edit;
  const patch = { layerId: form.elements.layerId.value };
  for (const f of ENTITY_FIELDS[findEntity(doc, id).type]) patch[f] = parseNumber(form.elements[f].value);
  const r = updateEntity(doc, id, patch);
  if (r.error) return showRowError(form, r.error);
  commit(r.doc);
});

function layerChange(target, result) {
  if (result.error) {
    renderLayers();
    const li = $('layer-list').querySelector(`[data-rename="${target}"], [data-active="${target}"]`)?.closest('li');
    if (li) {
      const err = li.querySelector('.error');
      err.textContent = result.error;
      err.hidden = false;
    }
    return;
  }
  commit(result.doc);
}

$('layer-list').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.toggleVisible) {
    const l = findLayer(doc, d.toggleVisible);
    layerChange(l.id, updateLayer(doc, l.id, { visible: !l.visible }));
  } else if (d.toggleLock) {
    const l = findLayer(doc, d.toggleLock);
    layerChange(l.id, updateLayer(doc, l.id, { locked: !l.locked }));
  } else if (d.askDeleteLayer) { confirmDeleteLayer = d.askDeleteLayer; renderLayers(); }
  else if (d.keep) { confirmDeleteLayer = null; renderLayers(); }
  else if (d.confirmDeleteLayer) {
    confirmDeleteLayer = null;
    layerChange(d.confirmDeleteLayer, deleteLayer(doc, d.confirmDeleteLayer));
  }
});

$('layer-list').addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d.active) {
    // Choosing the active layer is a setting, not an undoable edit.
    doc = setActiveLayer(doc, d.active).doc;
    save();
    renderAll();
  } else if (d.rename) layerChange(d.rename, updateLayer(doc, d.rename, { name: e.target.value }));
  else if (d.recolor) layerChange(d.recolor, updateLayer(doc, d.recolor, { color: e.target.value }));
});

$('layer-list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.rename) e.target.blur();
});

$('add-layer').addEventListener('click', () => commit(addLayer(doc).doc));

$('grid-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = parseNumber($('grid-spacing').value);
  const err = $('grid-error');
  if (!(Number.isFinite(n) && n > 0)) {
    err.textContent = 'Grid spacing must be a number greater than 0.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  doc.settings = { ...doc.settings, gridSpacing: n };
  save();
  renderCanvas();
});

// ---- file ------------------------------------------------------------------

function fileStatus(title, errors = []) {
  const box = $('file-status');
  box.replaceChildren(h('p', {}, title));
  if (errors.length) box.append(h('ul', { className: 'error' }, ...errors.slice(0, 8).map((x) => h('li', {}, x))));
}

$('new-btn').addEventListener('click', () => {
  if (doc.entities.length && !confirm('Start a new drawing? The current drawing will be replaced. Export it first to keep a copy.')) return;
  replaceDocument(newDocument(doc.settings));
  fileStatus('Started a new drawing.');
});

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([serializeDocument(doc)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `drawing-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  fileStatus('Exported the drawing as JSON.');
});

$('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = parseDocument(await file.text());
  if (!r.ok) return fileStatus(`Could not import “${file.name}”. Your current drawing is unchanged.`, r.errors);
  if (doc.entities.length && !confirm(`Replace the current drawing with “${file.name}”?`)) return;
  replaceDocument(r.doc);
  fileStatus(`Imported “${file.name}”: ${r.doc.entities.length} shapes, ${r.doc.layers.length} layers.`);
});

// ---- start -----------------------------------------------------------------

const loaded = loadDocument();
doc = loaded.doc;
if (loaded.errors) {
  storageBlocked = true;
  flash('Your saved drawing could not be read, so it was left untouched and is not being overwritten. '
    + 'Start a new drawing or import one to resume autosave.', true);
}
applyTheme();
syncKeyboard();
renderAll();
