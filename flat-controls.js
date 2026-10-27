import { updateGesture, isTapGesture } from './geometry.js?v=5';
import { clampView, startPinch, updatePinch } from './view-transform.js?v=1';

// The board owns gestures; the caller owns rendering and game moves.
export function createFlatControls({ host, readView, writeView, pieceAt, onTap }) {
  const pointers = new Map(), controller = new AbortController();
  let single = null, pinch = null, multi = false;
  const size = () => {
    const { width, height } = host.getBoundingClientRect();
    return { width, height };
  };
  const point = event => {
    const rect = host.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };
  const reset = () => { pointers.clear(); single = null; pinch = null; multi = false; };
  const options = { signal: controller.signal };
  host.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, point(event));
    try { host.setPointerCapture(event.pointerId); } catch {}
    if (pointers.size > 1) {
      multi = true; single = null;
      pinch = pointers.size === 2 ? startPinch([...pointers.values()], readView()) : null;
      event.preventDefault(); return;
    }
    if (multi) return;
    single = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      maxDistance: 0, view: { ...readView() }, piece: pieceAt(event) };
  }, options);
  host.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (multi) {
      if (pointers.size === 2) {
        if (!pinch) pinch = startPinch([...pointers.values()], readView());
        writeView(updatePinch(pinch, [...pointers.values()], size()));
      }
      event.preventDefault(); return;
    }
    if (!single || single.pointerId !== event.pointerId) return;
    single = updateGesture(single, { x: event.clientX, y: event.clientY });
    if (single.view.scale > 1 && !isTapGesture(single)) {
      writeView(clampView({ scale: single.view.scale,
        x: single.view.x + event.clientX - single.startX,
        y: single.view.y + event.clientY - single.startY }, size()));
      event.preventDefault();
    }
  }, { ...options, passive: false });
  const release = (event, canceled = false) => {
    pointers.delete(event.pointerId);
    if (multi) { pinch = null; if (!pointers.size) reset(); return; }
    if (!single || single.pointerId !== event.pointerId) return;
    const finished = updateGesture(single, { x: event.clientX, y: event.clientY });
    single = null;
    if (!canceled && isTapGesture(finished) && finished.piece && pieceAt(event) === finished.piece) onTap(finished.piece);
  };
  host.addEventListener('pointerup', event => release(event), options);
  host.addEventListener('pointercancel', event => release(event, true), options);
  host.addEventListener('lostpointercapture', event => release(event, true), options);
  return { reset, destroy() { reset(); controller.abort(); } };
}
