export const NETWORK_POINT_RADIUS = 2.7;
export const NETWORK_POINT_MIN_SPACING = 5.6;
export const NETWORK_LABEL_GAP = 10;

export type NetworkPointOffset = {
  x: number;
  y: number;
};

export type NetworkLabelInput = {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  cloudLeft?: number;
  cloudRight?: number;
  cloudTop?: number;
  cloudBottom?: number;
  width: number;
  height: number;
  importance: number;
};

export type NetworkLabelPlacement = {
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  visible: boolean;
  compactVisible: boolean;
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

/** Deterministic organic offsets with a dense center and a looser fringe. */
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
  const baseSpacing = Math.min(
    NETWORK_POINT_MIN_SPACING,
    Math.max(
      NETWORK_POINT_RADIUS * 2 + 0.15,
      Math.sqrt(
        (Math.PI * horizontalRadius * verticalRadius * 0.6) /
          Math.max(1, count),
      ),
    ),
  );

  for (let index = 0; index < count; index += 1) {
    let best = { x: 0, y: 0 };
    let bestDistance = -1;
    const attempts = index === 0 ? 1 : 120;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const corePoint = index < Math.ceil(count * 0.78);
      const radial =
        index === 0
          ? random() * 0.08
          : corePoint
            ? Math.pow(random(), 0.64) * (0.68 + random() * 0.06)
            : 0.72 + Math.pow(random(), 0.8) * 0.25;
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
      const localSpacing = baseSpacing + Math.pow(radial, 1.8) * 1.25;
      // Accept the first comfortably separated random candidate instead of
      // always maximizing distance. This avoids visible rows and rings.
      if (nearest >= localSpacing && attempt >= 4) {
        best = candidate;
        break;
      }
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

type WorkingLabel = NetworkLabelInput & {
  centerX: number;
  centerY: number;
  targetX: number;
  targetY: number;
  cloudLeftValue: number;
  cloudRightValue: number;
  cloudTopValue: number;
  cloudBottomValue: number;
};

function footprint(item: WorkingLabel): Rect {
  const left = Math.min(item.cloudLeftValue, -item.width / 2);
  const right = Math.max(item.cloudRightValue, item.width / 2);
  return {
    x: item.centerX + left,
    y: item.centerY + item.cloudTopValue,
    width: right - left,
    height:
      item.cloudBottomValue -
      item.cloudTopValue +
      NETWORK_LABEL_GAP +
      item.height,
  };
}

function clampWorkingLabel(
  item: WorkingLabel,
  width: number,
  top: number,
  bottom: number,
): void {
  const bounds = footprint(item);
  if (bounds.x < 8) item.centerX += 8 - bounds.x;
  if (bounds.x + bounds.width > width - 8) {
    item.centerX -= bounds.x + bounds.width - (width - 8);
  }
  if (bounds.y < top) item.centerY += top - bounds.y;
  if (bounds.y + bounds.height > bottom) {
    item.centerY -= bounds.y + bounds.height - bottom;
  }
}

/**
 * Repositions whole cloud/label units before placing every label below its
 * cloud. Semantic target positions remain the weak attractor; labels are not
 * dropped merely because the initial spring layout was crowded.
 */
export function placeNetworkLabels(
  inputs: NetworkLabelInput[],
  width: number,
  height: number,
  top = 48,
  bottom = height - 86,
  compactZoom = 0.7,
): Record<string, NetworkLabelPlacement> {
  const working: WorkingLabel[] = inputs.map((input) => ({
    ...input,
    centerX: input.cx,
    centerY: input.cy,
    targetX: input.cx,
    targetY: input.cy,
    cloudLeftValue: input.cloudLeft ?? -input.radius,
    cloudRightValue: input.cloudRight ?? input.radius,
    cloudTopValue: input.cloudTop ?? -input.radius,
    cloudBottomValue: input.cloudBottom ?? input.radius,
  }));

  for (const item of working) clampWorkingLabel(item, width, top, bottom);

  for (let iteration = 0; iteration < 520; iteration += 1) {
    for (const item of working) {
      item.centerX += (item.targetX - item.centerX) * 0.0025;
      item.centerY += (item.targetY - item.centerY) * 0.0025;
    }
    for (let leftIndex = 0; leftIndex < working.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < working.length;
        rightIndex += 1
      ) {
        const left = working[leftIndex];
        const right = working[rightIndex];
        const leftBounds = footprint(left);
        const rightBounds = footprint(right);
        const gap = 5;
        const overlapX =
          Math.min(
            leftBounds.x + leftBounds.width,
            rightBounds.x + rightBounds.width,
          ) -
          Math.max(leftBounds.x, rightBounds.x) +
          gap;
        const overlapY =
          Math.min(
            leftBounds.y + leftBounds.height,
            rightBounds.y + rightBounds.height,
          ) -
          Math.max(leftBounds.y, rightBounds.y) +
          gap;
        if (overlapX <= 0 || overlapY <= 0) continue;

        const leftBodyX = leftBounds.x + leftBounds.width / 2;
        const leftBodyY = leftBounds.y + leftBounds.height / 2;
        const rightBodyX = rightBounds.x + rightBounds.width / 2;
        const rightBodyY = rightBounds.y + rightBounds.height / 2;
        const leftShare =
          right.importance / Math.max(1, left.importance + right.importance);
        const rightShare = 1 - leftShare;
        if (overlapX <= overlapY) {
          const direction =
            rightBodyX === leftBodyX
              ? seedFrom(`${left.id}:${right.id}`) % 2 === 0
                ? 1
                : -1
              : Math.sign(rightBodyX - leftBodyX);
          left.centerX -= direction * overlapX * leftShare;
          right.centerX += direction * overlapX * rightShare;
        } else {
          const direction =
            rightBodyY === leftBodyY
              ? seedFrom(`${right.id}:${left.id}`) % 2 === 0
                ? 1
                : -1
              : Math.sign(rightBodyY - leftBodyY);
          left.centerY -= direction * overlapY * leftShare;
          right.centerY += direction * overlapY * rightShare;
        }
      }
    }
    for (const item of working) clampWorkingLabel(item, width, top, bottom);
  }

  const result: Record<string, NetworkLabelPlacement> = {};
  const placed: Rect[] = [];
  const ordered = [...working].sort(
    (left, right) =>
      right.importance - left.importance || left.id.localeCompare(right.id),
  );

  for (const input of ordered) {
    const horizontalOffsets = [
      0,
      -input.width * 0.12,
      input.width * 0.12,
      -input.width * 0.24,
      input.width * 0.24,
    ];
    let chosen: NetworkLabelPlacement | null = null;
    for (const horizontalOffset of horizontalOffsets) {
      const x = clamp(
        input.centerX + horizontalOffset,
        8 + input.width / 2,
        width - 8 - input.width / 2,
      );
      const y =
        input.centerY +
        input.cloudBottomValue +
        NETWORK_LABEL_GAP +
        input.height / 2;
      const rect = {
        x: x - input.width / 2,
        y: y - input.height / 2,
        width: input.width,
        height: input.height,
      };
      const hitsLabel = placed.some((other) => overlaps(rect, other, 5));
      const hitsCloud = working.some(
        (other) =>
          other.id !== input.id &&
          rectangleHitsCircle(
            rect,
            other.centerX,
            other.centerY,
            other.radius + 5,
          ),
      );
      if (hitsLabel || hitsCloud) continue;
      chosen = {
        centerX: input.centerX,
        centerY: input.centerY,
        x,
        y,
        visible: true,
        compactVisible: false,
      };
      placed.push(rect);
      break;
    }
    result[input.id] = chosen ?? {
      centerX: input.centerX,
      centerY: input.centerY,
      x: input.centerX,
      y:
        input.centerY +
        input.cloudBottomValue +
        NETWORK_LABEL_GAP +
        input.height / 2,
      visible: true,
      compactVisible: false,
    };
  }

  const compactRects: Rect[] = [];
  for (const input of ordered) {
    const placement = result[input.id];
    const rect = projectedRect(placement, input, width, height, compactZoom);
    const inside =
      rect.x >= 8 &&
      rect.x + rect.width <= width - 8 &&
      rect.y >= top &&
      rect.y + rect.height <= bottom;
    const hitsLabel = compactRects.some((other) => overlaps(rect, other, 12));
    const hitsCloud = inputs.some((other) => {
      if (other.id === input.id) return false;
      const otherPlacement = result[other.id];
      const cx = width / 2 + (otherPlacement.centerX - width / 2) * compactZoom;
      const cy =
        height / 2 + (otherPlacement.centerY - height / 2) * compactZoom;
      return rectangleHitsCircle(rect, cx, cy, other.radius * compactZoom + 28);
    });
    placement.compactVisible = inside && !hitsLabel && !hitsCloud;
    if (placement.compactVisible) compactRects.push(rect);
  }

  return result;
}
