import { DRAWINGS } from "./drawings.js";
import { createRng, randomSeed, getBounds, buildDrawing } from "./renderer.js";

const params = new URLSearchParams(location.search);
const name = params.get("d") || "";

const img = document.getElementById("artwork");
const errorBox = document.getElementById("error");
const titleEl = document.getElementById("drawing-title");

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
    return;
  }

  const seed = randomSeed();
  const rng = createRng(seed);
  const bounds = getBounds();

  let svg;
  try {
    const pathData = generate(rng, bounds);
    svg = buildDrawing({ filename: name, seed, pathData });
  } catch (err) {
    showError(`"${name}" produced an invalid drawing: ${err.message}`);
    return;
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  revokeCurrent();
  currentUrl = url;
  img.src = url;
  img.hidden = false;
  errorBox.hidden = true;
}

window.addEventListener("pagehide", revokeCurrent);

render();
