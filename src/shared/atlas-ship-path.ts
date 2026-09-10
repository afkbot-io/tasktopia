type Point = { x: number; y: number };

/** Round only the inner 15% of each water-route leg, retaining coast clearance. */
export function atlasShipPath(points: Point[]): string {
  if (points.length === 0) return "";
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!, point = points[i]!, after = points[i + 1]!;
    const incoming = Math.hypot(point.x - before.x, point.y - before.y);
    const outgoing = Math.hypot(after.x - point.x, after.y - point.y);
    if (!incoming || !outgoing) continue;
    const radius = Math.min(incoming, outgoing) * .15;
    const entry = { x: point.x + (before.x - point.x) * radius / incoming, y: point.y + (before.y - point.y) * radius / incoming };
    const exit = { x: point.x + (after.x - point.x) * radius / outgoing, y: point.y + (after.y - point.y) * radius / outgoing };
    path += ` L${entry.x},${entry.y} Q${point.x},${point.y} ${exit.x},${exit.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L${end.x},${end.y}`;
}
