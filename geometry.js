const DIRECTIONS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

// Points are measured in grid cells, with each occupied cell spanning [x, x + 1).
// Selecting occupied cells keeps a winding path's empty interior available to other arrows.
export function hitPieceAt(pieces, point) {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  return pieces.find(piece => piece.cells.some(cell => cell[0] === x && cell[1] === y))?.id ?? null;
}

// Move a fixed-length window along the original tail-to-head route, then its exit ray.
// A bend stays in place until the tail reaches it; no body segment crosses an adjacent cell.
export function exitPath(piece, travel) {
  const cells = piece.cells;
  const distances = [0];
  for (let i = 1; i < cells.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]));
  }
  const length = distances[distances.length - 1];
  const [dx, dy] = DIRECTIONS[piece.dir];
  const head = cells[cells.length - 1];
  const pointAt = distance => {
    if (distance >= length) return [head[0] + dx * (distance - length), head[1] + dy * (distance - length)];
    const index = distances.findIndex(value => value > distance);
    const from = cells[index - 1], to = cells[index];
    const fraction = (distance - distances[index - 1]) / (distances[index] - distances[index - 1]);
    return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
  };
  const start = Math.max(0, travel), end = start + length;
  const path = [pointAt(start)];
  for (let i = 1; i < cells.length; i++) {
    if (distances[i] > start && distances[i] < end) path.push([...cells[i]]);
  }
  if (length) path.push(pointAt(end));
  return path;
}

export function updateGesture(gesture, point) {
  return { ...gesture, maxDistance: Math.max(gesture.maxDistance, Math.hypot(point.x - gesture.startX, point.y - gesture.startY)) };
}

export function isTapGesture(gesture) {
  return gesture.maxDistance < 7;
}
