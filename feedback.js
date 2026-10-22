export function expireNudges(nudges, time) {
  for (const [pieceId, start] of nudges) {
    if (time - start >= 300) nudges.delete(pieceId);
  }
}
