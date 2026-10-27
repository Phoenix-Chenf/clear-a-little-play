// Compact static routes are decoded only for the selected board.
const DIRECTIONS = ['up','right','down','left'];
export function unpackCampaignBoard(packed) {
  const { packing, packedPieces, ...metadata } = packed;
  const size = metadata.faces?.[0]?.size, area = size * size;
  if (packing !== 'route-cell-v1' || !Number.isInteger(size) || size < 1 || !metadata.faces.every(face => face.size === size)) throw new RangeError('Invalid campaign encoding');
  return {
    ...metadata,
    cubes: metadata.cubes.map(cube => ({ ...cube, at: [...cube.at] })),
    faces: metadata.faces.map(face => ({ ...face })),
    ...(metadata.shape ? { shape: { ...metadata.shape, scale: [...metadata.shape.scale] } } : {}),
    pieces: packedPieces.map(([id, direction, cells, color = 0]) => {
      if (!Number.isInteger(direction) || !DIRECTIONS[direction]) throw new RangeError('Invalid campaign direction');
      return { id, dir: DIRECTIONS[direction], color, route: cells.map(cell => {
        if (!Number.isInteger(cell) || cell < 0 || cell >= area * metadata.faces.length) throw new RangeError('Invalid campaign cell');
        return { face: metadata.faces[Math.floor(cell / area)].id, x: cell % size, y: Math.floor(cell % area / size) };
      }) };
    }),
  };
}
