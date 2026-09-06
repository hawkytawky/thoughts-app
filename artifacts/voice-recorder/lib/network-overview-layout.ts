export const NETWORK_POINT_RADIUS = 2.5;
export const NETWORK_POINT_MIN_SPACING = 7.5;
export const NETWORK_LABEL_GAP = 12;
export const NETWORK_EDGE_MIN_SIMILARITY = 0.3;
export const NETWORK_MAX_EDGES_PER_THEME = 2;

export type NetworkPointOffset = {
  x: number;
  y: number;
};

export type NetworkLabelInput = {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  width: number;
  height: number;
  importance: number;
};

export type NetworkLabelPlacement = {
  x: number;
  y: number;
  visible: boolean;
  compactVisible: boolean;
};

export type NetworkRelationship = {
  sourceId: string;
  targetId: string;
  similarity: number;
};

export type NetworkOverviewEdge = {
  source: number;
  target: number;
  similarity: number;
};

type Rect = { x: number; y: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seedValue: string): () => number {
  let seed = seedFrom(seedValue);
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate(x: number, y: number, angle: number): NetworkPointOffset {
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  };
}

/** Deterministic blue-noise-like offsets for a quiet, organic point cloud. */
export function buildNetworkPointOffsets(
  count: number,
  radius: number,
  eccentricity: number,
  tilt: number,
  seed: string,
): NetworkPointOffset[] {
  if (count <= 0) return [];
  const random = randomFrom(`network-overview:${seed}:${count}`);
  const horizontalRadius = Math.max(
    NETWORK_POINT_RADIUS,
    radius - NETWORK_POINT_RADIUS,
  );
  const verticalRadius = Math.max(
    NETWORK_POINT_RADIUS,
    radius * clamp(eccentricity, 0.72, 0.9) - NETWORK_POINT_RADIUS,
  );
  const points: NetworkPointOffset[] = [];
  const minimumSpacing = Math.min(
    NETWORK_POINT_MIN_SPACING,
    Math.max(
      NETWORK_POINT_RADIUS * 2 + 0.6,
      Math.sqrt(
        (Math.PI * horizontalRadius * verticalRadius * 0.78) /
          Math.max(1, count),
      ),
    ),
  );

  for (let index = 0; index < count; index += 1) {
    let best = { x: 0, y: 0 };
    let bestDistance = -1;
    const attempts = index === 0 ? 1 : 72;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radial = index === 0 ? random() * 0.12 : Math.sqrt(random()) * 0.98;
      const candidate = rotate(
        Math.cos(angle) * horizontalRadius * radial,
        Math.sin(angle) * verticalRadius * radial,
        tilt,
      );
      const nearest = points.reduce(
        (minimum, point) =>
          Math.min(
            minimum,
            Math.hypot(candidate.x - point.x, candidate.y - point.y),
          ),
        Number.POSITIVE_INFINITY,
      );
      if (nearest > bestDistance) {
        best = candidate;
        bestDistance = nearest;
      }
      if (nearest >= minimumSpacing && attempt >= 12) break;
    }
    points.push(best);
  }
  return points;
}

function overlaps(left: Rect, right: Rect, gap = 0): boolean {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

function rectangleHitsCircle(
  rect: Rect,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const nearestX = clamp(cx, rect.x, rect.x + rect.width);
  const nearestY = clamp(cy, rect.y, rect.y + rect.height);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

function projectedRect(
  placement: NetworkLabelPlacement,
  input: NetworkLabelInput,
  width: number,
  height: number,
  zoom: number,
): Rect {
  const x = width / 2 + (placement.x - width / 2) * zoom;
  const y = height / 2 + (placement.y - height / 2) * zoom;
  return {
    x: x - input.width / 2,
    y: y - input.height / 2,
    width: input.width,
    height: input.height,
  };
}

/** Places labels below clouds, hiding lower-priority labels if no safe slot exists. */
export function placeNetworkLabels(
  inputs: NetworkLabelInput[],
  width: number,
  height: number,
  top = 48,
  bottom = height - 86,
  compactZoom = 0.7,
): Record<string, NetworkLabelPlacement> {
  const result: Record<string, NetworkLabelPlacement> = {};
  const placed: Rect[] = [];
  const ordered = [...inputs].sort(
    (left, right) =>
      right.importance - left.importance || left.id.localeCompare(right.id),
  );

  for (const input of ordered) {
    const horizontalOffsets = [0, -input.width * 0.18, input.width * 0.18];
    const extraGaps = [0, 7, 14];
    let chosen: NetworkLabelPlacement | null = null;
    for (const extraGap of extraGaps) {
      for (const horizontalOffset of horizontalOffsets) {
        const x = input.cx + horizontalOffset;
        const y =
          input.cy +
          input.radius +
          NETWORK_LABEL_GAP +
          extraGap +
          input.height / 2;
        const rect = {
          x: x - input.width / 2,
          y: y - input.height / 2,
          width: input.width,
          height: input.height,
        };
        const inside =
          rect.x >= 8 &&
          rect.x + rect.width <= width - 8 &&
          rect.y >= top &&
          rect.y + rect.height <= bottom;
        const hitsLabel = placed.some((other) => overlaps(rect, other, 12));
        const hitsCloud = inputs.some(
          (other) =>
            other.id !== input.id &&
            rectangleHitsCircle(rect, other.cx, other.cy, other.radius + 28),
        );
        if (!inside || hitsLabel || hitsCloud) continue;
        chosen = { x, y, visible: true, compactVisible: false };
        placed.push(rect);
        break;
      }
      if (chosen) break;
    }
    result[input.id] =
      chosen ??
      ({
        x: input.cx,
        y: input.cy + input.radius + NETWORK_LABEL_GAP + input.height / 2,
        visible: false,
        compactVisible: false,
      } satisfies NetworkLabelPlacement);
  }

  const compactRects: Rect[] = [];
  for (const input of ordered) {
    const placement = result[input.id];
    if (!placement.visible) continue;
    const rect = projectedRect(placement, input, width, height, compactZoom);
    const inside =
      rect.x >= 8 &&
      rect.x + rect.width <= width - 8 &&
      rect.y >= top &&
      rect.y + rect.height <= bottom;
    const hitsLabel = compactRects.some((other) => overlaps(rect, other, 12));
    const hitsCloud = inputs.some((other) => {
      if (other.id === input.id) return false;
      const cx = width / 2 + (other.cx - width / 2) * compactZoom;
      const cy = height / 2 + (other.cy - height / 2) * compactZoom;
      return rectangleHitsCircle(rect, cx, cy, other.radius * compactZoom + 28);
    });
    placement.compactVisible = inside && !hitsLabel && !hitsCloud;
    if (placement.compactVisible) compactRects.push(rect);
  }

  return result;
}

/** Keeps only strong, real relationships and at most two lines per theme. */
export function selectNetworkOverviewEdges(
  themeIds: string[],
  relationships: NetworkRelationship[],
): NetworkOverviewEdge[] {
  const indexById = new Map(themeIds.map((id, index) => [id, index]));
  const degrees = new Array(themeIds.length).fill(0);
  const seen = new Set<string>();
  const edges: NetworkOverviewEdge[] = [];
  const ordered = [...relationships].sort(
    (left, right) => right.similarity - left.similarity,
  );
  for (const relationship of ordered) {
    if (relationship.similarity < NETWORK_EDGE_MIN_SIMILARITY) continue;
    const source = indexById.get(relationship.sourceId);
    const target = indexById.get(relationship.targetId);
    if (source == null || target == null || source === target) continue;
    const key = source < target ? `${source}:${target}` : `${target}:${source}`;
    if (seen.has(key)) continue;
    if (
      degrees[source] >= NETWORK_MAX_EDGES_PER_THEME ||
      degrees[target] >= NETWORK_MAX_EDGES_PER_THEME
    ) {
      continue;
    }
    seen.add(key);
    degrees[source] += 1;
    degrees[target] += 1;
    edges.push({
      source,
      target,
      similarity: clamp(relationship.similarity, 0, 1),
    });
  }
  return edges;
}
