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

  const all = [...head, ...middle, ...tail];
  return dedupe(all);
}

/** Drop consecutive duplicate points and collapse collinear runs. */
export function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    const collinear =
      (prev.x === cur.x && cur.x === next.x) || (prev.y === cur.y && cur.y === next.y);
    if (collinear) out.splice(i, 1);
  }
  return out;
}

/** Render a polyline as an SVG `points` attribute. */
export function toSvgPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
