// "Signal Siege": an invented early-1980s arcade defense moment. A relay
// field along the bottom defends a faceted central signal core from
// descending pulse trails, answered by rising counter-signal arcs that
// collide into layered burst rings, with debris sparks and a sparse
// abstract status band along the top. One continuous path: every element
// is entered and left by a straight or right-angled "wire" hop so the
// pen never lifts, and the path starts and ends at the same point on the
// horizon directly under the core.
export default function generate(rng, bounds) {
  const cx = bounds.x + bounds.width * 0.5;
  const baseY = bounds.y + bounds.height * 0.86;
  const coreY = bounds.y + bounds.height * 0.58;
  const coreRadius = Math.min(bounds.width, bounds.height) * (0.09 + rng() * 0.02);
  const bandY = bounds.y + bounds.height * 0.07;
  const bandLeft = bounds.x + bounds.width * 0.1;
  const coreStartAngle = rng() * Math.PI * 2;
  const coreEntry = pointOnCircle(cx, coreY, coreRadius, coreStartAngle);

  const path = new Path(cx, baseY, bounds);

  const towers = drawRelayField(path, rng, bounds, baseY);

  wireTo(path, rng, bandLeft, bandY);
  drawStatusBand(path, rng, bounds, bandY, bandLeft);

  wireTo(path, rng, coreEntry.x, coreEntry.y);
  const core = drawSignalCore(path, rng, bounds, cx, coreY, coreRadius, coreStartAngle);

  const pulseEnds = drawDescendingPulses(path, rng, bounds, core);
  const counterEnds = drawCounterSignals(path, rng, bounds, towers, core);

  drawBurstRings(path, rng, bounds, pulseEnds.concat(counterEnds));
  drawSparks(path, rng, bounds);

  wireTo(path, rng, cx, baseY);

  return path.toString();
}

// A low, irregular horizon of relay towers with occasional antenna ticks,
// drawn as one zigzag baseline. Returns each tower's peak position so
// later elements can anchor to the relay field.
function drawRelayField(path, rng, bounds, baseY) {
  const fieldLeft = bounds.x + bounds.width * 0.04;
  const fieldRight = bounds.x + bounds.width * 0.96;
  const towerCount = 9 + Math.floor(rng() * 5); // 9-13
  const step = (fieldRight - fieldLeft) / towerCount;
  const towers = [];

  path.lineTo(fieldLeft, baseY);

  for (let i = 0; i < towerCount; i++) {
    const peakX = fieldLeft + step * (i + 0.5) + (rng() - 0.5) * step * 0.3;
    const halfWidth = step * (0.18 + rng() * 0.12);
    const height = bounds.height * (0.05 + rng() * 0.09);
    const peakY = baseY - height;

    path.lineTo(peakX - halfWidth, baseY);
    path.lineTo(peakX, peakY);

    if (rng() < 0.5) {
      const tickLen = bounds.height * (0.02 + rng() * 0.03);
      path.lineTo(peakX, peakY - tickLen);
      path.lineTo(peakX, peakY);
    }

    path.lineTo(peakX + halfWidth, baseY);
    towers.push({ x: peakX, y: peakY });
  }

  path.lineTo(fieldRight, baseY);
  return towers;
}

// A sparse row of abstract bars and pips near the top edge, standing in
// for a score display without any text, numerals, or copied symbols.
function drawStatusBand(path, rng, bounds, bandY, left) {
  const right = bounds.x + bounds.width * 0.9;
  const itemCount = 6 + Math.floor(rng() * 5); // 6-10
  const step = (right - left) / Math.max(1, itemCount - 1);

  for (let i = 0; i < itemCount; i++) {
    const x = left + step * i + (rng() - 0.5) * step * 0.2;
    if (rng() < 0.6) {
      const h = bounds.height * (0.015 + rng() * 0.02);
      path.lineTo(x, bandY);
      path.lineTo(x, bandY - h);
      path.lineTo(x, bandY);
    } else {
      const r = bounds.width * (0.006 + rng() * 0.006);
      path.lineTo(x - r, bandY);
      path.lineTo(x, bandY - r);
      path.lineTo(x + r, bandY);
      path.lineTo(x, bandY + r);
      path.lineTo(x - r, bandY);
    }
  }
}

// The central faceted signal core: a star-like polygon alternating outer
// and inner radii so it reads as cut facets rather than a plain circle.
function drawSignalCore(path, rng, bounds, cx, cy, radius, startAngle) {
  const points = 6 + Math.floor(rng() * 4); // 6-9 facet pairs
  const innerRadius = radius * (0.5 + rng() * 0.2);

  for (let i = 1; i <= points * 2; i++) {
    const angle = startAngle + (Math.PI / points) * i;
    const r = i % 2 === 0 ? radius : innerRadius;
    const p = pointOnCircle(cx, cy, r, angle);
    path.lineTo(p.x, p.y);
  }

  return { x: cx, y: cy, radius };
}

// Descending zigzag/segmented pulse trails converging from the top and
// side edges toward the core. Each is a short chain of jittered straight
// segments, deliberately angular rather than smooth.
function drawDescendingPulses(path, rng, bounds, core) {
  const count = 4 + Math.floor(rng() * 3); // 4-6
  const ends = [];

  for (let i = 0; i < count; i++) {
    const edge = rng() < 0.5 ? "top" : rng() < 0.5 ? "left" : "right";
    let sx;
    let sy;
    if (edge === "top") {
      sx = bounds.x + bounds.width * (0.1 + rng() * 0.8);
      sy = bounds.y + bounds.height * 0.02;
    } else if (edge === "left") {
      sx = bounds.x + bounds.width * 0.02;
      sy = bounds.y + bounds.height * (0.12 + rng() * 0.28);
    } else {
      sx = bounds.x + bounds.width * 0.98;
      sy = bounds.y + bounds.height * (0.12 + rng() * 0.28);
    }

    path.lineTo(sx, sy);

    const targetAngle = rng() * Math.PI * 2;
    const targetDist = core.radius * (1.5 + rng() * 1.7);
    const tx = core.x + Math.cos(targetAngle) * targetDist;
    const ty = core.y + Math.sin(targetAngle) * targetDist;

    const segments = 3 + Math.floor(rng() * 3); // 3-5
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      if (s === segments) {
        path.lineTo(tx, ty);
        break;
      }
      const jitter = bounds.width * 0.03 * (1 - t * 0.5);
      const jx = sx + (tx - sx) * t + (rng() - 0.5) * jitter;
      const jy = sy + (ty - sy) * t + (rng() - 0.5) * jitter * 0.5;
      path.lineTo(jx, jy);
    }

    ends.push({ x: tx, y: ty });
  }

  return ends;
}

// Curving counter-signal trails rising from several relay towers toward
// mid-field, arcing outward on the way up so they read as launched
// responses rather than straight lines.
function drawCounterSignals(path, rng, bounds, towers, core) {
  const count = Math.min(towers.length, 4 + Math.floor(rng() * 3)); // up to 4-6
  const chosen = shuffle(towers.slice(), rng).slice(0, count);
  const ends = [];

  for (const tower of chosen) {
    path.lineTo(tower.x, tower.y);

    const targetAngle = rng() * Math.PI * 2;
    const targetDist = core.radius * (1.7 + rng() * 1.8);
    const tx = core.x + Math.cos(targetAngle) * targetDist;
    const ty = core.y + Math.sin(targetAngle) * targetDist * 0.7 + bounds.height * 0.02;

    const controlX = (tower.x + tx) / 2 + (rng() - 0.5) * bounds.width * 0.25;
    const controlY = Math.min(tower.y, ty) - bounds.height * (0.05 + rng() * 0.1);

    path.quadTo(controlX, controlY, tx, ty);
    ends.push({ x: tx, y: ty });
  }

  return ends;
}

// Layered polygonal interference rings dropped where trails converge —
// a few of the pulse/counter-signal endpoints get a small concentric
// burst instead of ending bare.
function drawBurstRings(path, rng, bounds, points) {
  if (points.length === 0) return;
  const burstCount = Math.min(points.length, 2 + Math.floor(rng() * 3)); // 2-4
  const chosen = shuffle(points.slice(), rng).slice(0, burstCount);

  for (const center of chosen) {
    path.lineTo(center.x, center.y);
    const layers = 2 + Math.floor(rng() * 2); // 2-3
    const baseRadius = bounds.width * (0.018 + rng() * 0.022);
    const sides = 5 + Math.floor(rng() * 4); // 5-8

    for (let layer = 1; layer <= layers; layer++) {
      const r = baseRadius * layer;
      const rot = rng() * Math.PI * 2;
      const first = pointOnCircle(center.x, center.y, r, rot);
      path.lineTo(first.x, first.y);
      for (let s = 1; s <= sides; s++) {
        const angle = rot + (Math.PI * 2 * s) / sides;
        const p = pointOnCircle(center.x, center.y, r, angle);
        path.lineTo(p.x, p.y);
      }
    }
  }
}

// Small debris ticks and echo marks scattered across the mid-field to
// keep the frozen moment feeling active. Most are short straight ticks;
// some are tiny arcs standing in for fading echoes.
function drawSparks(path, rng, bounds) {
  const count = 12 + Math.floor(rng() * 10); // 12-21
  for (let i = 0; i < count; i++) {
    const x = bounds.x + bounds.width * (0.08 + rng() * 0.84);
    const y = bounds.y + bounds.height * (0.15 + rng() * 0.65);
    const len = bounds.width * (0.008 + rng() * 0.015);

    path.lineTo(x, y);
    if (rng() < 0.3) {
      const startAngle = rng() * Math.PI * 2;
      const endAngle = startAngle + Math.PI * (0.6 + rng() * 0.6);
      const r = len * 1.5;
      const midAngle = (startAngle + endAngle) / 2;
      const controlX = x + Math.cos(midAngle) * r * 1.3;
      const controlY = y + Math.sin(midAngle) * r * 1.3;
      const endX = x + Math.cos(endAngle) * r;
      const endY = y + Math.sin(endAngle) * r;
      path.quadTo(controlX, controlY, endX, endY);
      path.lineTo(x, y);
    } else {
      const angle = rng() * Math.PI * 2;
      path.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      path.lineTo(x, y);
    }
  }
}

// A right-angled "circuit trace" hop between unrelated scene elements,
// so the connectors read as decorative circuitry rather than a bare
// diagonal travel line. The step position is randomized so repeated
// calls don't stack into one mechanical-looking straight line.
function wireTo(path, rng, tx, ty) {
  const t = 0.25 + rng() * 0.5;
  const stepX = path.x + (tx - path.x) * t;
  path.lineTo(stepX, path.y);
  path.lineTo(stepX, ty);
  path.lineTo(tx, ty);
}

function pointOnCircle(cx, cy, r, angle) {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmt(n) {
  return Math.round(n * 1000) / 1000;
}

// Minimal path builder: clamps every emitted coordinate to bounds so the
// shared renderer's safe-margin validation always passes regardless of
// which seeded values a helper above produced.
class Path {
  constructor(x, y, bounds) {
    this.bounds = bounds;
    const [cx, cy] = this.clamp(x, y);
    this.x = cx;
    this.y = cy;
    this.commands = [`M${fmt(cx)},${fmt(cy)}`];
  }

  clamp(x, y) {
    const minX = this.bounds.x;
    const maxX = this.bounds.x + this.bounds.width;
    const minY = this.bounds.y;
    const maxY = this.bounds.y + this.bounds.height;
    return [Math.min(maxX, Math.max(minX, x)), Math.min(maxY, Math.max(minY, y))];
  }

  lineTo(x, y) {
    const [cx, cy] = this.clamp(x, y);
    this.commands.push(`L${fmt(cx)},${fmt(cy)}`);
    this.x = cx;
    this.y = cy;
    return this;
  }

  quadTo(cx1, cy1, x, y) {
    const [qx, qy] = this.clamp(cx1, cy1);
    const [ex, ey] = this.clamp(x, y);
    this.commands.push(`Q${fmt(qx)},${fmt(qy)} ${fmt(ex)},${fmt(ey)}`);
    this.x = ex;
    this.y = ey;
    return this;
  }

  toString() {
    return this.commands.join(" ");
  }
}
