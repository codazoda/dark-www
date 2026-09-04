// Example drawing module: several spirograph-like loops scattered across
// the artboard in a jittered grid and connected by straight travel lines,
// all as one continuous path. Demonstrates seeded variation (loop count,
// placement, turns, lobes, wobble) and a busier composition than a single
// loop, within the uninterrupted-path constraint.
export default function generate(rng, bounds) {
  const cols = 3;
  const rows = 3;
  const cellWidth = bounds.width / cols;
  const cellHeight = bounds.height / rows;
  const maxLoopRadius = Math.min(cellWidth, cellHeight) * 0.38;

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ col, row });
    }
  }
  shuffle(cells, rng);

  const clusterCount = 5 + Math.floor(rng() * 3); // 5-7 loops
  const clusters = cells.slice(0, clusterCount).map((cell) => {
    const jitterX = (rng() - 0.5) * (cellWidth - maxLoopRadius * 2) * 0.6;
    const jitterY = (rng() - 0.5) * (cellHeight - maxLoopRadius * 2) * 0.6;
    return {
      x: bounds.x + cellWidth * (cell.col + 0.5) + jitterX,
      y: bounds.y + cellHeight * (cell.row + 0.5) + jitterY,
    };
  });

  const points = [];
  for (const cluster of clusters) {
    for (const p of spirographLoop(rng, cluster.x, cluster.y, maxLoopRadius)) {
      const last = points[points.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      points.push(p);
    }
  }

  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

// One in-out loop: radius rises from 0 back to 0, so it starts and ends at
// its own center point, keeping the overall path continuous when chained.
function spirographLoop(rng, cx, cy, maxRadius) {
  const turns = 2 + rng() * 3;
  const lobes = 3 + Math.floor(rng() * 5);
  const wobble = 0.1 + rng() * 0.15;
  const baseRadius = maxRadius / (1 + wobble);
  const steps = 80;

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
  return points;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
