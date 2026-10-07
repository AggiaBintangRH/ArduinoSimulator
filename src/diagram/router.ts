/**
 * Wire-route instruction language from diagram.json.
 *
 *   "v<n>"  vertical move in px   (negative = up)
 *   "h<n>"  horizontal move in px (negative = left)
 *   "*"     anchor: instructions before it are measured from the source,
 *           instructions after it are measured from the target.
 *
 * The remaining gap between the two runs is filled automatically.
 * Reference: docs/wokwi/01-core.md section 1.
 */

export interface Point {
  x: number;
  y: number;
}

export type RouteStep =
  | { axis: 'v'; delta: number }
  | { axis: 'h'; delta: number };

export interface ParsedRoute {
  /** Steps measured forward from the source pin. */
  fromSource: RouteStep[];
  /** Steps measured backward from the target pin (in diagram.json order). */
  fromTarget: RouteStep[];
}

export class RouteParseError extends Error {}

const STEP_RE = /^([vh])(-?\d+(?:\.\d+)?)$/;

/** Parse the raw instruction array into source-side and target-side runs. */
export function parseRoute(instructions: readonly string[]): ParsedRoute {
  const fromSource: RouteStep[] = [];
  const fromTarget: RouteStep[] = [];
  let seenAnchor = false;

  for (const raw of instructions) {
    const token = raw.trim();
    if (token === '') continue;
    if (token === '*') {
      if (seenAnchor) {
        throw new RouteParseError('route contains more than one "*" anchor');
      }
      seenAnchor = true;
      continue;
    }
    const m = STEP_RE.exec(token);
    if (!m) {
      throw new RouteParseError(`invalid route instruction: ${JSON.stringify(raw)}`);
    }
    const step: RouteStep = { axis: m[1] as 'v' | 'h', delta: Number(m[2]) };
    (seenAnchor ? fromTarget : fromSource).push(step);
  }

  return { fromSource, fromTarget };
}

function applySteps(start: Point, steps: readonly RouteStep[]): Point[] {
  const pts: Point[] = [start];
  let cur = start;
  for (const step of steps) {
    cur = step.axis === 'v'
      ? { x: cur.x, y: cur.y + step.delta }
      : { x: cur.x + step.delta, y: cur.y };
    pts.push(cur);
  }
  return pts;
}

/**
 * Join two orthogonal runs with at most two extra segments, so the result stays
 * axis-aligned. `preferAxis` picks which way the elbow turns first.
 */
function bridge(a: Point, b: Point, preferAxis: 'h' | 'v'): Point[] {
  if (a.x === b.x || a.y === b.y) return []; // already aligned; a straight run closes it
  return preferAxis === 'h' ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
}

/**
 * Build the full polyline for a wire.
 *
 * `source`/`target` are the absolute pin positions. The returned array always
 * starts at `source` and ends at `target`.
 */
export function routeWire(
  source: Point,
  target: Point,
  instructions: readonly string[],
): Point[] {
  const { fromSource, fromTarget } = parseRoute(instructions);

  const head = applySteps(source, fromSource);
  // Target-side steps are written walking away from the target, so walking them
  // in reverse gets us from the end of the head run back into the target pin.
  const tailReversed = applySteps(target, fromTarget);
  const tail = [...tailReversed].reverse();

  const lastHead = head[head.length - 1];
  const firstTail = tail[0];

  // Prefer to close the gap along the axis the last explicit step did *not* use,
  // which keeps the elbow away from the pin it just left.
  const lastStep = fromSource[fromSource.length - 1] ?? fromTarget[0];
  const preferAxis: 'h' | 'v' = lastStep?.axis === 'h' ? 'v' : 'h';

  const middle = bridge(lastHead, firstTail, preferAxis);

  const points = dedupe([...head, ...middle, ...tail]);
  // Rounding along the way can leave the run a hair short of the pin it is
  // meant to land on. The pins are the fixed points here, so pin them.
  points[0] = { ...source };
  points[points.length - 1] = { ...target };
  return points;
}

/** Drop consecutive duplicate points and collapse collinear runs. */
export function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    const collinear =
      (same(prev.x, cur.x) && same(cur.x, next.x)) ||
      (same(prev.y, cur.y) && same(cur.y, next.y));
    if (collinear) out.splice(i, 1);
  }
  return out;
}

/**
 * Equal for drawing purposes.
 *
 * A route is a chain of additions, so a run that should land exactly on a pin
 * can arrive a few times 1e-14 away. Compared exactly, that left a hairline
 * segment at the end of the wire - invisible, but real enough to collect its
 * own drag handle. The tolerance is far below one screen pixel; the grid pitch
 * is 19.2 units.
 */
const EPSILON = 1e-6;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Render a polyline as an SVG `points` attribute. */
export function toSvgPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * Unit vector at right angles to an axis-aligned segment. Zero-length segments
 * have no direction of their own, so they get an arbitrary but stable one.
 */
export function perpendicular(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: -1 };
  // `+ 0` collapses a negative zero, which would otherwise show up in
  // comparisons as a different value from plain zero.
  return { x: -dy / len + 0, y: dx / len + 0 };
}

/**
 * Slide one segment of a polyline sideways by `offset`, keeping the result
 * orthogonal and keeping both ends where they are.
 *
 * The first and last points are pin pads. Moving them with the segment would
 * pull the wire off the pin it is connected to, so a dragged end segment grows
 * a new elbow instead. Interior segments need no extra points: the offset is
 * perpendicular to this segment and therefore parallel to its neighbours, which
 * simply get longer or shorter.
 */
export function offsetSegment(
  points: readonly Point[],
  segIndex: number,
  offset: number,
): Point[] {
  if (segIndex < 0 || segIndex >= points.length - 1) return points.map((p) => ({ ...p }));

  const a = points[segIndex];
  const b = points[segIndex + 1];
  const perp = perpendicular(a, b);
  const slide = (p: Point): Point => ({ x: p.x + perp.x * offset, y: p.y + perp.y * offset });

  const out = points.map((p) => ({ ...p }));
  out[segIndex] = slide(a);
  out[segIndex + 1] = slide(b);
  if (segIndex === 0) out.unshift({ ...a });
  if (segIndex === points.length - 2) out.push({ ...b });
  return dedupe(out);
}

/** Keep subpixel pin alignment while removing floating-point noise. */
function tidy(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Describe a polyline as route instructions, all measured from the source pin.
 *
 * Feeding the result back to `routeWire` with the same endpoints reproduces the
 * polyline exactly: the steps land on the target, so nothing is left to bridge.
 */
export function routeFromPoints(points: readonly Point[]): string[] {
  const steps: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = tidy(points[i + 1].x - points[i].x);
    const dy = tidy(points[i + 1].y - points[i].y);
    // Diagram routes are orthogonal; a stray diagonal becomes two steps rather
    // than being dropped.
    if (dx !== 0) steps.push(`h${dx}`);
    if (dy !== 0) steps.push(`v${dy}`);
  }
  return steps;
}

/** Index of the polyline segment nearest to `p`, or -1 for an empty polyline. */
export function nearestSegment(points: readonly Point[], p: Point): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(p, points[i], points[i + 1]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0), 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Render a polyline as an SVG path with rounded corners.
 *
 * A real jumper wire does not turn a square corner. The radius is trimmed at
 * every bend to half the shorter of the two segments meeting there, so short
 * runs round off less rather than overshooting into each other.
 */
export function roundedPath(points: readonly Point[], radius: number): string {
  if (points.length === 0) return '';
  const at = (p: Point) => `${trim(p.x)} ${trim(p.y)}`;
  if (points.length === 1) return `M${at(points[0])}`;

  const parts = [`M${at(points[0])}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const r = Math.min(
      radius,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    if (r < 0.01) {
      parts.push(`L${at(corner)}`);
      continue;
    }
    // Stop short of the corner, curve through it, and carry on.
    parts.push(`L${at(towards(corner, prev, r))}`);
    parts.push(`Q${at(corner)} ${at(towards(corner, next, r))}`);
  }
  parts.push(`L${at(points[points.length - 1])}`);
  return parts.join(' ');
}

/** The point `distance` away from `from`, heading towards `to`. */
function towards(from: Point, to: Point, distance: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return { ...from };
  return {
    x: from.x + ((to.x - from.x) / len) * distance,
    y: from.y + ((to.y - from.y) / len) * distance,
  };
}

/** Two decimals is well under a screen pixel, and keeps the path readable. */
function trim(n: number): number {
  return Math.round(n * 100) / 100;
}
