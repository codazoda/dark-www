import { DRAWINGS } from "./drawings.js";
import { createRng, randomSeed, getBounds, createPath, buildDrawing } from "./renderer.js";

const params = new URLSearchParams(location.search);
const name = params.get("d") || "";
const closed = params.get("closed") !== "0";
const seedParam = params.get("seed");

const img = document.getElementById("artwork");
const errorBox = document.getElementById("error");
const titleEl = document.getElementById("drawing-title");
const toggleLink = document.getElementById("toggle-close-link");

let currentUrl = null;

function revokeCurrent() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

function showError(message) {
  img.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = message;
}

async function render() {
  if (!DRAWINGS.includes(name)) {
    titleEl.textContent = "Not found";
    document.title = "Not found — Generative Art";
    showError(`"${name || "(no drawing given)"}" isn't a known drawing. Go back to the index and pick one from the list.`);
    toggleLink.hidden = true;
    return;
  }

  titleEl.textContent = name;
  document.title = `${name} — Generative Art`;

  let generate;
  try {
    const module = await import(`./drawings/${name}.js`);
    generate = module.default;
    if (typeof generate !== "function") {
      throw new Error("module has no default export function");
    }
  } catch (err) {
    showError(`Couldn't load drawing "${name}": ${err.message}`);
    toggleLink.hidden = true;
    return;
  }

  const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : randomSeed();
  const rng = createRng(seed);
  const bounds = getBounds();

  let svg;
  try {
    const path = createPath(bounds);
    generate(rng, bounds, path);
    svg = buildDrawing({ filename: name, seed, path, closePath: closed });
  } catch (err) {
    showError(`"${name}" produced an invalid drawing: ${err.message}`);
    toggleLink.hidden = true;
    return;
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  revokeCurrent();
  currentUrl = url;
  img.src = url;
  img.hidden = false;
  errorBox.hidden = true;

  const otherParams = new URLSearchParams({ d: name, seed: String(seed) });
  if (closed) {
    otherParams.set("closed", "0");
  }
  toggleLink.href = `draw.html?${otherParams.toString()}`;
  toggleLink.textContent = closed ? "View unclosed" : "View closed";
  toggleLink.hidden = false;
}

window.addEventListener("pagehide", revokeCurrent);

render();
