export type ArrowGeometryHead = "filled" | "none" | "open";
export type ArrowGeometryPathStyle = "curved" | "straight";
export type ArrowGeometryDrawStyle = "clean" | "draw";

export interface ArrowGeometrySource {
  readonly bend: number;
  readonly drawStyle: ArrowGeometryDrawStyle;
  readonly endArrowhead: ArrowGeometryHead;
  readonly id: string;
  readonly pathStyle: ArrowGeometryPathStyle;
  readonly startArrowhead: ArrowGeometryHead;
  readonly strokeWidth: number;
  readonly width: number;
}

export interface ArrowGeometryPoint {
  readonly x: number;
  readonly y: number;
}

export interface ArrowGeometryBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface ArrowHeadGeometry {
  readonly closed: boolean;
  readonly path: string;
  readonly points: readonly ArrowGeometryPoint[];
}

export interface ArrowGeometry {
  readonly bounds: ArrowGeometryBounds;
  readonly control: ArrowGeometryPoint | null;
  readonly end: ArrowGeometryPoint;
  readonly endHead: ArrowHeadGeometry | null;
  readonly samples: readonly ArrowGeometryPoint[];
  readonly shaftPath: string;
  readonly start: ArrowGeometryPoint;
  readonly startHead: ArrowHeadGeometry | null;
}

const SAMPLE_COUNT = 24;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const format = (value: number): string => String(Number(value.toFixed(2)));

const pointPath = (point: ArrowGeometryPoint): string =>
  `${format(point.x)} ${format(point.y)}`;

const hashString = (value: string): number => {
  let hash = 17;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return hash;
};

const seededUnit = (seed: number, salt: number): number => {
  const value = (seed * 16_807 + salt * 48_271 + 1_013_904_223) % 2_147_483_647;
  return value / 2_147_483_647;
};

const normalize = (point: ArrowGeometryPoint): ArrowGeometryPoint => {
  const length = Math.hypot(point.x, point.y);
  if (length < 0.0001) {
    return { x: 1, y: 0 };
  }
  return { x: point.x / length, y: point.y / length };
};

const quadraticPoint = (
  start: ArrowGeometryPoint,
  control: ArrowGeometryPoint,
  end: ArrowGeometryPoint,
  amount: number
): ArrowGeometryPoint => {
  const inverse = 1 - amount;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * amount * control.x +
      amount * amount * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * amount * control.y +
      amount * amount * end.y,
  };
};

const createHead = ({
  drawStyle,
  inward,
  length,
  seed,
  side,
  strokeWidth,
  style,
  tip,
}: {
  readonly drawStyle: ArrowGeometryDrawStyle;
  readonly inward: ArrowGeometryPoint;
  readonly length: number;
  readonly seed: number;
  readonly side: "end" | "start";
  readonly strokeWidth: number;
  readonly style: ArrowGeometryHead;
  readonly tip: ArrowGeometryPoint;
}): ArrowHeadGeometry | null => {
  if (style === "none") {
    return null;
  }

  const salt = side === "start" ? 17 : 31;
  const handScale =
    drawStyle === "draw" ? 0.94 + seededUnit(seed, salt) * 0.12 : 1;
  const headLength = Math.max(
    3,
    Math.min(
      length * 0.42,
      clamp(length / 5, strokeWidth * 1.8, strokeWidth * 3.8)
    )
  );
  const halfWidth = headLength * 0.56 * handScale;
  const base = {
    x: tip.x + inward.x * headLength,
    y: tip.y + inward.y * headLength,
  };
  const normal = { x: -inward.y, y: inward.x };
  const left = {
    x: base.x + normal.x * halfWidth,
    y: base.y + normal.y * halfWidth,
  };
  const right = {
    x: base.x - normal.x * halfWidth,
    y: base.y - normal.y * halfWidth,
  };
  const points = [left, tip, right] as const;

  return {
    closed: style === "filled",
    path: `M ${pointPath(left)} L ${pointPath(tip)} L ${pointPath(right)}${
      style === "filled" ? " Z" : ""
    }`,
    points,
  };
};

const getBounds = (
  points: readonly ArrowGeometryPoint[],
  strokeWidth: number
): ArrowGeometryBounds => {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const padding = strokeWidth / 2;
  return {
    height: Math.max(1, maximumY - minimumY + padding * 2),
    width: Math.max(1, maximumX - minimumX + padding * 2),
    x: minimumX - padding,
    y: minimumY - padding,
  };
};

export const getArrowGeometry = (
  source: ArrowGeometrySource
): ArrowGeometry => {
  const width = Math.max(1, source.width);
  const start = { x: -width / 2, y: 0 };
  const end = { x: width / 2, y: 0 };
  const seed = hashString(source.id);
  const noise =
    source.drawStyle === "draw"
      ? Math.min(width * 0.018, Math.max(0.75, source.strokeWidth * 0.6))
      : 0;
  const bend = source.pathStyle === "curved" ? source.bend : 0;
  const control = {
    x: (seededUnit(seed, 7) - 0.5) * noise * 1.5,
    y: -bend + (seededUnit(seed, 11) - 0.5) * noise * 2,
  };
  const hasCurve = Math.abs(control.x) > 0.01 || Math.abs(control.y) > 0.01;
  const startDirection = normalize({
    x: hasCurve ? control.x - start.x : end.x - start.x,
    y: hasCurve ? control.y - start.y : end.y - start.y,
  });
  const endDirection = normalize({
    x: hasCurve ? end.x - control.x : end.x - start.x,
    y: hasCurve ? end.y - control.y : end.y - start.y,
  });
  const startHead = createHead({
    drawStyle: source.drawStyle,
    inward: startDirection,
    length: width,
    seed,
    side: "start",
    strokeWidth: source.strokeWidth,
    style: source.startArrowhead,
    tip: start,
  });
  const endHead = createHead({
    drawStyle: source.drawStyle,
    inward: { x: -endDirection.x, y: -endDirection.y },
    length: width,
    seed,
    side: "end",
    strokeWidth: source.strokeWidth,
    style: source.endArrowhead,
    tip: end,
  });
  const shaftStart =
    startHead?.closed === true
      ? {
          x: (startHead.points[0].x + startHead.points[2].x) / 2,
          y: (startHead.points[0].y + startHead.points[2].y) / 2,
        }
      : start;
  const shaftEnd =
    endHead?.closed === true
      ? {
          x: (endHead.points[0].x + endHead.points[2].x) / 2,
          y: (endHead.points[0].y + endHead.points[2].y) / 2,
        }
      : end;
  const samples: ArrowGeometryPoint[] = [];
  if (hasCurve) {
    for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
      samples.push(
        quadraticPoint(shaftStart, control, shaftEnd, index / SAMPLE_COUNT)
      );
    }
  } else {
    samples.push(shaftStart, shaftEnd);
  }
  const allPoints = [
    ...samples,
    ...(startHead?.points ?? []),
    ...(endHead?.points ?? []),
  ];

  return {
    bounds: getBounds(allPoints, source.strokeWidth),
    control: hasCurve ? control : null,
    end,
    endHead,
    samples,
    shaftPath: hasCurve
      ? `M ${pointPath(shaftStart)} Q ${pointPath(control)} ${pointPath(shaftEnd)}`
      : `M ${pointPath(shaftStart)} L ${pointPath(shaftEnd)}`,
    start,
    startHead,
  };
};

const distanceToSegment = (
  point: ArrowGeometryPoint,
  start: ArrowGeometryPoint,
  end: ArrowGeometryPoint
): number => {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const amount = clamp(
    ((point.x - start.x) * (end.x - start.x) +
      (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1
  );
  return Math.hypot(
    point.x - (start.x + (end.x - start.x) * amount),
    point.y - (start.y + (end.y - start.y) * amount)
  );
};

const isPointInTriangle = (
  point: ArrowGeometryPoint,
  [first, second, third]: readonly [
    ArrowGeometryPoint,
    ArrowGeometryPoint,
    ArrowGeometryPoint,
  ]
): boolean => {
  const sign = (
    current: ArrowGeometryPoint,
    start: ArrowGeometryPoint,
    end: ArrowGeometryPoint
  ): number =>
    (current.x - end.x) * (start.y - end.y) -
    (start.x - end.x) * (current.y - end.y);
  const firstSign = sign(point, first, second);
  const secondSign = sign(point, second, third);
  const thirdSign = sign(point, third, first);
  const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0;
  const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0;
  return !(hasNegative && hasPositive);
};

const isPointInHead = (
  point: ArrowGeometryPoint,
  head: ArrowHeadGeometry,
  threshold: number
): boolean => {
  if (
    head.closed &&
    isPointInTriangle(
      point,
      head.points as readonly [
        ArrowGeometryPoint,
        ArrowGeometryPoint,
        ArrowGeometryPoint,
      ]
    )
  ) {
    return true;
  }
  return (
    distanceToSegment(point, head.points[0], head.points[1]) <= threshold ||
    distanceToSegment(point, head.points[1], head.points[2]) <= threshold
  );
};

export const isPointInArrowGeometry = (
  point: ArrowGeometryPoint,
  geometry: ArrowGeometry,
  strokeWidth: number
): boolean => {
  const threshold = Math.max(7, strokeWidth / 2 + 3);
  for (let index = 1; index < geometry.samples.length; index += 1) {
    const start = geometry.samples[index - 1];
    const end = geometry.samples[index];
    if (start && end && distanceToSegment(point, start, end) <= threshold) {
      return true;
    }
  }
  return Boolean(
    (geometry.startHead &&
      isPointInHead(point, geometry.startHead, threshold)) ||
      (geometry.endHead && isPointInHead(point, geometry.endHead, threshold))
  );
};
