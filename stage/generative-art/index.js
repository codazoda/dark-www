import { DRAWINGS } from "./drawings.js";

const list = document.getElementById("drawing-list");
const empty = document.getElementById("empty-state");

if (DRAWINGS.length === 0) {
  empty.hidden = false;
} else {
  for (const name of DRAWINGS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `draw.html?d=${encodeURIComponent(name)}`;
    a.className = "drawing-button";
    a.textContent = name;
    li.appendChild(a);
    list.appendChild(li);
  }
}
