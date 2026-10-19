// Browser persistence. The drawing goes through the same serialize/parse
// boundary as JSON export/import.

import { newDocument, parseDocument, serializeDocument } from './model.js';

export const DOC_KEY = '2d-web-cad:document';
export const THEME_KEY = '2d-web-cad:theme';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Returns { doc, errors }. With errors, the stored text is unreadable and
// the caller must not overwrite it until the user starts or imports a
// drawing on purpose.
export function loadDocument() {
  const raw = read(DOC_KEY);
  if (raw === null) return { doc: newDocument(), errors: null };
  const r = parseDocument(raw);
  return r.ok ? { doc: r.doc, errors: null } : { doc: newDocument(), errors: r.errors };
}

export function saveDocument(doc) {
  return write(DOC_KEY, serializeDocument(doc));
}

export const loadTheme = () => read(THEME_KEY);
export const saveTheme = (theme) => write(THEME_KEY, theme);
