// Document model: entities, layers, validation, and the one schema-versioned
// boundary shared by autosave and JSON import/export. Pure functions only —
// every operation returns a new document and never mutates its input, so
// undo can keep old documents as snapshots.

export const APP_VERSION = '0.1.0';
export const FORMAT = '2d-web-cad';
export const SCHEMA_VERSION = 1;
export const DEFAULT_LAYER_ID = 'L1';
export const DEFAULT_LAYER_NAME = 'Layer 1';
export const MAX_LAYER_NAME = 40;

// Mid-luminance colors that stay legible on both a white and a black canvas.
export const LAYER_PALETTE = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00',
  '#a855f7', '#0097a7', '#d81b60', '#689f38',
];

export const ENTITY_FIELDS = {
  line: ['x1', 'y1', 'x2', 'y2'],
  circle: ['cx', 'cy', 'r'],
};

export const DEFAULT_SETTINGS = { gridSpacing: 1, snap: true };
export const DEFAULT_VIEW = { cx: 0, cy: 0, scale: 40 };

export function newDocument(settings = DEFAULT_SETTINGS) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    view: { ...DEFAULT_VIEW },
    layers: [{ id: DEFAULT_LAYER_ID, name: DEFAULT_LAYER_NAME, color: 'auto', visible: true, locked: false }],
    activeLayerId: DEFAULT_LAYER_ID,
    entities: [],
    nextId: 1,
  };
}

// ---- numbers and labels ----------------------------------------------------

export function parseNumber(text) {
  const t = String(text ?? '').trim();
  if (t === '') return NaN;
  return Number(t);
}

export function fmt(n) {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 10000) / 10000;
  return String(Object.is(r, -0) ? 0 : r);
}

export function describeEntity(e) {
  if (e.type === 'line') return `Line (${fmt(e.x1)}, ${fmt(e.y1)}) → (${fmt(e.x2)}, ${fmt(e.y2)})`;
  if (e.type === 'circle') return `Circle center (${fmt(e.cx)}, ${fmt(e.cy)}), radius ${fmt(e.r)}`;
  return `Unknown ${e.type}`;
}

// ---- validation ------------------------------------------------------------

// Returns an error message, or null when the geometry is valid.
export function validateGeometry(type, g) {
  const fields = ENTITY_FIELDS[type];
  if (!fields) return `Unsupported entity type "${type}"`;
  for (const f of fields) {
    if (typeof g[f] !== 'number' || !Number.isFinite(g[f])) return `${f} must be a finite number`;
  }
  if (type === 'line' && g.x1 === g.x2 && g.y1 === g.y2) return 'A line needs two different points';
  if (type === 'circle' && !(g.r > 0)) return 'Radius must be greater than 0';
  return null;
}

function pickGeometry(type, src) {
  const g = {};
  for (const f of ENTITY_FIELDS[type]) g[f] = src[f];
  return g;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

// ---- ids -------------------------------------------------------------------

function allIds(doc) {
  return new Set([...doc.layers.map((l) => l.id), ...doc.entities.map((e) => e.id)]);
}

function makeId(doc, prefix) {
  const used = allIds(doc);
  let n = doc.nextId;
  while (used.has(prefix + n)) n++;
  return { id: prefix + n, nextId: n + 1 };
}

export const findLayer = (doc, id) => doc.layers.find((l) => l.id === id);
export const findEntity = (doc, id) => doc.entities.find((e) => e.id === id);

// ---- entity operations -----------------------------------------------------

export function addEntity(doc, type, geometry) {
  const g = pickGeometry(type, geometry ?? {});
  const error = validateGeometry(type, g);
  if (error) return { error };
  const { id, nextId } = makeId(doc, 'e');
  const entity = { id, type, ...g, layerId: doc.activeLayerId };
  return { doc: { ...doc, entities: [...doc.entities, entity], nextId }, entity };
}

export function updateEntity(doc, id, patch) {
  const e = findEntity(doc, id);
  if (!e) return { error: 'That shape no longer exists' };
  const merged = { ...e };
  for (const f of ENTITY_FIELDS[e.type]) if (f in patch) merged[f] = patch[f];
  if ('layerId' in patch) {
    if (!findLayer(doc, patch.layerId)) return { error: 'Unknown layer' };
    merged.layerId = patch.layerId;
  }
  const error = validateGeometry(e.type, merged);
  if (error) return { error };
  return { doc: { ...doc, entities: doc.entities.map((x) => (x.id === id ? merged : x)) } };
}

export function deleteEntity(doc, id) {
  if (!findEntity(doc, id)) return { error: 'That shape no longer exists' };
  return { doc: { ...doc, entities: doc.entities.filter((e) => e.id !== id) } };
}

// ---- layer operations ------------------------------------------------------

export function addLayer(doc) {
  const names = new Set(doc.layers.map((l) => l.name));
  let n = 2;
  while (names.has(`Layer ${n}`)) n++;
  const { id, nextId } = makeId(doc, 'L');
  const color = LAYER_PALETTE[(doc.layers.length - 1) % LAYER_PALETTE.length];
  const layer = { id, name: `Layer ${n}`, color, visible: true, locked: false };
  return { doc: { ...doc, layers: [...doc.layers, layer], activeLayerId: id, nextId }, layer };
}

export function updateLayer(doc, id, patch) {
  const layer = findLayer(doc, id);
  if (!layer) return { error: 'Unknown layer' };
  const next = { ...layer };
  if ('name' in patch) {
    const name = String(patch.name).trim();
    if (id === DEFAULT_LAYER_ID && name !== DEFAULT_LAYER_NAME) return { error: 'Layer 1 keeps its name' };
    if (!name) return { error: 'Layer name cannot be empty' };
    if (name.length > MAX_LAYER_NAME) return { error: `Layer name is limited to ${MAX_LAYER_NAME} characters` };
    if (doc.layers.some((l) => l.id !== id && l.name === name)) return { error: 'Another layer already uses that name' };
    next.name = name;
  }
  if ('color' in patch) {
    if (id === DEFAULT_LAYER_ID) return { error: 'Layer 1 always contrasts with the canvas' };
    if (!HEX.test(patch.color)) return { error: 'Color must look like #rrggbb' };
    next.color = patch.color.toLowerCase();
  }
  if ('visible' in patch) next.visible = !!patch.visible;
  if ('locked' in patch) next.locked = !!patch.locked;
  return { doc: { ...doc, layers: doc.layers.map((l) => (l.id === id ? next : l)) } };
}

export function deleteLayer(doc, id) {
  if (id === DEFAULT_LAYER_ID) return { error: 'Layer 1 cannot be deleted' };
  if (!findLayer(doc, id)) return { error: 'Unknown layer' };
  return {
    doc: {
      ...doc,
      layers: doc.layers.filter((l) => l.id !== id),
      entities: doc.entities.map((e) => (e.layerId === id ? { ...e, layerId: DEFAULT_LAYER_ID } : e)),
      activeLayerId: doc.activeLayerId === id ? DEFAULT_LAYER_ID : doc.activeLayerId,
    },
  };
}

export function setActiveLayer(doc, id) {
  if (!findLayer(doc, id)) return { error: 'Unknown layer' };
  return { doc: { ...doc, activeLayerId: id } };
}

// ---- undo snapshots --------------------------------------------------------

// The undoable part of a document. Grid, snap, and view are preferences and
// deliberately survive undo.
export function drawingOf(doc) {
  const { layers, entities, activeLayerId, nextId } = doc;
  return { layers, entities, activeLayerId, nextId };
}

export function withDrawing(doc, drawing) {
  return { ...doc, ...drawing };
}

// ---- schema boundary -------------------------------------------------------

// MIGRATIONS[v] upgrades a raw version-v object to version v+1. Version 1 is
// the first schema, so there is nothing to upgrade yet.
export const MIGRATIONS = {};

export function migrate(raw, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  let doc = raw;
  while (doc.version < target) {
    const step = migrations[doc.version];
    if (!step) throw new Error(`No migration from schema version ${doc.version}`);
    doc = { ...step(doc), version: doc.version + 1 };
  }
  return doc;
}

export function serializeDocument(doc) {
  return JSON.stringify({
    format: FORMAT,
    version: SCHEMA_VERSION,
    app: APP_VERSION,
    settings: { gridSpacing: doc.settings.gridSpacing, snap: doc.settings.snap },
    view: { cx: doc.view.cx, cy: doc.view.cy, scale: doc.view.scale },
    layers: doc.layers.map(({ id, name, color, visible, locked }) => ({ id, name, color, visible, locked })),
    activeLayerId: doc.activeLayerId,
    nextId: doc.nextId,
    entities: doc.entities.map((e) => ({ id: e.id, type: e.type, ...pickGeometry(e.type, e), layerId: e.layerId })),
  }, null, 2);
}

export function parseDocument(text, options) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON (${err.message})`] };
  }
  return validateDocument(raw, options);
}

// Validates the complete file and returns a normalized document, or every
// problem found. Nothing partial is ever returned.
export function validateDocument(raw, { migrations = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  const fail = (errors) => ({ ok: false, errors });
  if (!isObj(raw)) return fail(['The file does not contain a drawing object']);
  if (raw.format !== FORMAT) return fail([`Not a 2D Web CAD drawing (format must be "${FORMAT}")`]);
  if (!Number.isInteger(raw.version) || raw.version < 1) return fail(['Missing or invalid schema version']);
  if (raw.version > target) {
    return fail([`This drawing uses schema version ${raw.version}; this app reads up to version ${target}`]);
  }
  let m;
  try {
    m = migrate(raw, migrations, target);
  } catch (err) {
    return fail([err.message]);
  }

  const errors = [];
  const base = newDocument();

  const settings = { ...base.settings };
  if (m.settings !== undefined) {
    if (!isObj(m.settings)) errors.push('settings must be an object');
    else {
      if (m.settings.gridSpacing !== undefined) {
        if (!(Number.isFinite(m.settings.gridSpacing) && m.settings.gridSpacing > 0)) errors.push('settings.gridSpacing must be a positive number');
        else settings.gridSpacing = m.settings.gridSpacing;
      }
      if (m.settings.snap !== undefined) {
        if (typeof m.settings.snap !== 'boolean') errors.push('settings.snap must be true or false');
        else settings.snap = m.settings.snap;
      }
    }
  }

  const view = { ...base.view };
  if (m.view !== undefined) {
    if (!isObj(m.view)) errors.push('view must be an object');
    else {
      for (const f of ['cx', 'cy', 'scale']) {
        if (m.view[f] === undefined) continue;
        if (!Number.isFinite(m.view[f]) || (f === 'scale' && !(m.view[f] > 0))) errors.push(`view.${f} is invalid`);
        else view[f] = m.view[f];
      }
    }
  }

  const layers = [];
  const ids = new Set();
  if (!Array.isArray(m.layers) || m.layers.length === 0) errors.push('layers must be a non-empty list');
  else {
    m.layers.forEach((l, i) => {
      const where = `Layer ${i + 1}`;
      if (!isObj(l)) return errors.push(`${where}: not an object`);
      if (typeof l.id !== 'string' || !l.id) return errors.push(`${where}: missing id`);
      if (ids.has(l.id)) return errors.push(`${where}: duplicate id "${l.id}"`);
      ids.add(l.id);
      if (typeof l.name !== 'string' || !l.name.trim()) errors.push(`${where}: missing name`);
      if (l.id === DEFAULT_LAYER_ID) {
        if (l.name !== DEFAULT_LAYER_NAME) errors.push(`${where}: layer ${DEFAULT_LAYER_ID} must be named "${DEFAULT_LAYER_NAME}"`);
        if (l.color !== 'auto') errors.push(`${where}: layer ${DEFAULT_LAYER_ID} color must be "auto"`);
      } else if (typeof l.color !== 'string' || !HEX.test(l.color)) errors.push(`${where}: color must look like #rrggbb`);
      for (const f of ['visible', 'locked']) {
        if (l[f] !== undefined && typeof l[f] !== 'boolean') errors.push(`${where}: ${f} must be true or false`);
      }
      layers.push({
        id: l.id,
        name: String(l.name ?? '').trim(),
        color: l.id === DEFAULT_LAYER_ID ? 'auto' : String(l.color).toLowerCase(),
        visible: l.visible ?? true,
        locked: l.locked ?? false,
      });
    });
    if (!ids.has(DEFAULT_LAYER_ID)) errors.push(`Missing the default layer "${DEFAULT_LAYER_ID}"`);
  }

  const entities = [];
  if (!Array.isArray(m.entities)) errors.push('entities must be a list');
  else {
    m.entities.forEach((e, i) => {
      const where = `Entity ${i + 1}`;
      if (!isObj(e)) return errors.push(`${where}: not an object`);
      if (typeof e.id !== 'string' || !e.id) return errors.push(`${where}: missing id`);
      if (ids.has(e.id)) return errors.push(`${where}: duplicate id "${e.id}"`);
      ids.add(e.id);
      if (!ENTITY_FIELDS[e.type]) return errors.push(`${where}: unsupported type "${e.type}"`);
      const g = pickGeometry(e.type, e);
      const gErr = validateGeometry(e.type, g);
      if (gErr) errors.push(`${where}: ${gErr}`);
      if (!layers.some((l) => l.id === e.layerId)) errors.push(`${where}: unknown layer "${e.layerId}"`);
      entities.push({ id: e.id, type: e.type, ...g, layerId: e.layerId });
    });
  }

  if (errors.length) return fail(errors);

  const activeLayerId = layers.some((l) => l.id === m.activeLayerId) ? m.activeLayerId : DEFAULT_LAYER_ID;
  let nextId = Number.isInteger(m.nextId) && m.nextId > 0 ? m.nextId : 1;
  for (const id of ids) {
    const n = Number(id.replace(/^\D+/, ''));
    if (Number.isInteger(n) && n >= nextId) nextId = n + 1;
  }
  return { ok: true, doc: { settings, view, layers, activeLayerId, entities, nextId } };
}
