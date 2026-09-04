// Stacked, softly irregular horizons drawn as one boustrophedon path.
// The gaps pinch around an upper-third crest and open toward the bottom.
export default function generate(rng, bounds, path) {
  const bandCount = 20 + Math.floor(rng() * 5) * 2; // 20-28, always even
  const pointCount = 8 + Math.floor(rng() * 3);
  const crestX = 0.2 + rng() * 0.6;
  const pinch = 0.24 + rng() * 0.12;
  const drift = (rng() - 0.5) * 0.18;
  const phase = rng() * Math.PI * 2;
  const positions = makeBandPositions(bandCount, pinch, bounds);
  const bands = positions.map((y, band) => ridgePoints(
    band / (bandCount - 1),
    y,
    pointCount,
    crestX,
    drift,
    phase,
    rng,
    bounds,
  ));

  const startY = bands[0][0][1];
  path.lineTo(bounds.x, startY);
  let lastY = startY;

  for (let band = 0; band < bandCount; band++) {
    const points = bands[band];

    if (band % 2 === 1) points.reverse();
    if (band > 0) drawStep(path, points[0][0], lastY, points[0][1]);
    drawSmoothLine(path, points);
    lastY = points[points.length - 1][1];
  }

  // The even band count leaves the pen at bottom-left. Return along the
  // margin so the renderer's automatic close has no visible segment.
  drawStep(path, bounds.x, lastY, startY);
}

function makeBandPositions(count, pinch, bounds) {
  const weights = [];
  let total = 0;

  for (let gap = 0; gap < count - 1; gap++) {
    const t = (gap + 0.5) / (count - 1);
    const crowded = Math.exp(-((t - pinch) ** 2) / 0.012);
    const weight = 0.68 + t * 1.1 - crowded * 0.55;
    weights.push(weight);
    total += weight;
  }

  const positions = [bounds.y];
  let distance = 0;
  for (const weight of weights) {
    distance += weight;
    positions.push(bounds.y + bounds.height * distance / total);
  }
  return positions;
}

function ridgePoints(t, baseY, count, crestX, drift, phase, rng, bounds) {
  const points = [];
  const maxY = bounds.y + bounds.height;
  const shiftedCrest = clamp(crestX + drift * (t - 0.5), 0.12, 0.88);
  const amplitude = Math.min(18, bounds.height / 18) * Math.sin(Math.PI * t);
  let noise = (rng() - 0.5) * 3;

  for (let i = 0; i < count; i++) {
    const xRatio = i / (count - 1);
    noise = noise * 0.58 + (rng() - 0.5) * 5;
    const crest = -amplitude * Math.exp(-((xRatio - shiftedCrest) ** 2) / 0.032);
    const broadDrift = Math.sin(xRatio * Math.PI * 2 + phase + t * 2.2) * 2.2;
    const edgeFade = Math.sin(Math.PI * xRatio);
    const y = clamp(baseY + (crest + broadDrift + noise) * edgeFade, bounds.y, maxY);
    points.push([bounds.x + bounds.width * xRatio, y]);
  }
  return points;
}

function drawSmoothLine(path, points) {
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nextX, nextY] = points[i + 1];
    path.quadTo(cx, cy, (cx + nextX) / 2, (cy + nextY) / 2);
  }
  const control = points[points.length - 2];
  const end = points[points.length - 1];
  path.quadTo(control[0], control[1], end[0], end[1]);
}

function drawStep(path, x, fromY, toY) {
  const segments = Math.ceil(Math.abs(toY - fromY) / 4);
  for (let i = 1; i <= segments; i++) {
    path.lineTo(x, fromY + (toY - fromY) * i / segments);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
