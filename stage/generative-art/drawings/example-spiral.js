// Example drawing module: a spirograph-like loop that grows out from the
// center of the artboard and spirals back in to the same point, so the
// renderer's closing segment is a no-op. Demonstrates seeded variation
// (turns, lobes, wobble) within the uninterrupted-path constraint.
export default function generate(rng, bounds) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const maxRadius = Math.min(bounds.width, bounds.height) / 2;

  const turns = 2 + rng() * 3;
  const lobes = 3 + Math.floor(rng() * 5);
  const wobble = 0.1 + rng() * 0.15;
  const baseRadius = maxRadius / (1 + wobble); // keeps peaks within maxRadius
  const steps = 240;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inOut = t < 0.5 ? t / 0.5 : (1 - t) / 0.5; // 0 -> 1 -> 0
    const angle = t * turns * Math.PI * 2;
    const radius = inOut * baseRadius * (1 + Math.sin(angle * lobes) * wobble);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    points.push([round(x), round(y)]);
  }

  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
