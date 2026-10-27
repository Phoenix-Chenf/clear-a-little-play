// All coordinates are CSS pixels relative to the viewport center.
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const limit = (value, min, max) => Math.max(min, Math.min(max, value));
export function clampView(view = {}, size = {}) {
  const scale = limit(finite(view.scale, 1), 1, 3);
  const maxX = Math.max(0, finite(size.width)) * (scale - 1) / 2;
  const maxY = Math.max(0, finite(size.height)) * (scale - 1) / 2;
  return { scale, x: scale === 1 ? 0 : limit(finite(view.x), -maxX, maxX), y: scale === 1 ? 0 : limit(finite(view.y), -maxY, maxY) };
}
const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
const distance = points => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
export function startPinch(points, view) {
  const middle = midpoint(points), scale = limit(finite(view.scale, 1), 1, 3);
  return { distance: Math.max(1, distance(points)), scale, anchor: { x: (middle.x - finite(view.x)) / scale, y: (middle.y - finite(view.y)) / scale } };
}
export function updatePinch(start, points, size) {
  const middle = midpoint(points), scale = limit(start.scale * Math.max(1, distance(points)) / start.distance, 1, 3);
  return clampView({ scale, x: middle.x - start.anchor.x * scale, y: middle.y - start.anchor.y * scale }, size);
}
