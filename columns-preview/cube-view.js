import {
  INITIAL_POSE, initialPoseForBoard, poseForFace, closestPatch, turnPatch, sceneFrame, patchFacing, surfaceSheets,
  projectWorldPoint, surfacePointVisible, surfacePointAtScreen, findVisiblePatchPose, patchCenter, startCubeGesture, updateCubeGesture, tappedPiece,
} from './cube-view-geometry.js?v=18';
import { FACE_BASES, pieceRoute, routeSegments, worldPoint } from './surface-topology.js?v=18';

import { clampView, startPinch, updatePinch } from './view-transform.js?v=19';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIRECTIONS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const DIRECTION_NAMES = { up: '上', right: '右', down: '下', left: '左' };
const FACE_NAMES = { front: '前面', right: '右面', back: '后面', left: '左面', top: '上面', bottom: '底面' };
const OVERVIEW_POSES = {
  front: INITIAL_POSE, right: { pitch: -22, yaw: -120 },
  back: { pitch: -22, yaw: -210 }, left: { pitch: -22, yaw: 60 },
  top: { pitch: -68, yaw: -30 }, bottom: { pitch: 68, yaw: -30 },
};
const pathData = points => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');
const nearestYaw = (target, current) => target + Math.round((current - target) / 360) * 360;
let viewNumber = 0;

// Presentation and gestures only. The caller owns moves, history and progress.
export function createCubeView({ host, onMove, onPoseChange = () => {} }) {
  if (!host || typeof onMove !== 'function') throw new TypeError('A cube host and move callback are required.');
  const doc = host.ownerDocument, win = doc.defaultView;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const faces = new Map(), skins = [], pieceNodes = new Map(), departures = new Map(), nudges = new Map(), pulses = new Map(), pointers = new Map();
  const viewId = ++viewNumber;
  let currentBoard = null, active = false, closeup = false, hintId = null, selectedFace = 'front';
  let pose = { ...INITIAL_POSE }, gesture = null, dimensions = { width: 320, height: 320 };
  let frame = sceneFrame(null, pose, dimensions), poseFrame = 0, destroyed = false, shapeSignature = '';
  let visibilityState = '', visibilityRevision = 0;
  let view = { scale: 1, x: 0, y: 0 }, pinch = null, multiTouch = false;

  const element = (tag, className) => {
    const node = doc.createElement(tag); if (className) node.className = className; return node;
  };
  const svgElement = (tag, attributes = {}) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const shadow = element('div', 'cube-ground-shadow'); shadow.setAttribute('aria-hidden', 'true');
  const body = element('div', 'cube-body');
  // Flatten the complete projected scene once, then scale it in screen space.
  const viewport = element('div', 'cube-viewport'), projection = element('div', 'cube-projection');
  const hintMarker = element('div', 'cube-hint-marker'); hintMarker.hidden = true; hintMarker.setAttribute('aria-hidden', 'true');
  projection.append(body); viewport.append(shadow, projection);
  host.classList.add('cube-stage'); host.setAttribute('role', 'group');
  host.setAttribute('aria-label', '可旋转的立体箭头组合');
  host.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
  host.replaceChildren(viewport, hintMarker);

  const sideOf = faceId => faces.get(faceId)?.side || 'front';
  const headFace = piece => pieceRoute(piece).at(-1)?.face;
  const targetPose = (faceId, overview = false) => (overview ? OVERVIEW_POSES : null)?.[sideOf(faceId)] || poseForFace(sideOf(faceId));
  const notifyPose = () => onPoseChange({ closeup, zoom: view.scale, face: selectedFace });

  function headPoints(piece) {
    const head = pieceRoute(piece).at(-1), [hx, hy] = [head.x + .5, head.y + .5], [dx, dy] = DIRECTIONS[piece.dir];
    return [[hx, hy], [hx + dx * .24, hy + dy * .24], [hx - dx * .22 - dy * .24, hy - dy * .22 + dx * .24], [hx - dx * .22 + dy * .24, hy - dy * .22 - dx * .24]]
      .map(([x, y]) => worldPoint(currentBoard, head.face, x, y));
  }
  function selectedPoints() {
    const hinted = pieceNodes.get(hintId)?.piece;
    return hinted && headFace(hinted) === selectedFace ? headPoints(hinted) : [patchCenter(currentBoard, selectedFace)];
  }
  function visibleTarget(preferred, points, forceCloseup = false) {
    const settings = { ...dimensions, preferredPose: preferred, closeup: forceCloseup };
    const result = findVisiblePatchPose(currentBoard, selectedFace, points, settings);
    return result?.pose || preferred;
  }

  function updateFrame() {
    frame = sceneFrame(currentBoard, pose, dimensions);
    view = clampView(view, dimensions); closeup = view.scale > 1;
    viewport.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    host.style.setProperty('--cube-edge', `${frame.edge}px`);
    host.style.setProperty('--cube-perspective', `${frame.perspective}px`);
    host.classList.toggle('is-closeup', closeup);
  }

  function syncVisibility() {
    const state = [active, pose.pitch, pose.yaw, frame.edge, frame.perspective, frame.depth, ...frame.focus].join(',');
    if (state !== visibilityState) {
      visibilityState = state; visibilityRevision++;
      for (const [id, face] of faces) {
        face.visible = active && patchFacing(currentBoard, id, pose, frame);
        face.surface.setAttribute('aria-hidden', String(!face.visible));
        face.surface.style.pointerEvents = face.visible ? 'auto' : 'none';
        face.surface.dataset.visible = String(face.visible);
      }
    }
    for (const { fragments } of pieceNodes.values()) for (const fragment of fragments) {
      if (fragment.visibilityRevision === visibilityRevision) continue;
      const face = faces.get(fragment.segment.face);
      fragment.visible = Boolean(face?.visible && fragment.samples.some(point => surfacePointVisible(currentBoard, point, face.side, pose, frame)));
      fragment.group.setAttribute('tabindex', fragment.visible ? '0' : '-1');
      fragment.group.setAttribute('aria-hidden', String(!fragment.visible));
      fragment.group.dataset.visible = String(fragment.visible);
      fragment.visibilityRevision = visibilityRevision;
    }
    const focused = doc.activeElement?.closest?.('[data-cube-piece]');
    if (active && focused && body.contains(focused) && focused.getAttribute('aria-hidden') === 'true') host.focus({ preventScroll: true });
  }

  function applyPose() {
    updateFrame();
    const { edge, depth, focus } = frame;
    body.style.transform = `translateZ(${-depth}px) rotateX(${pose.pitch}deg) rotateY(${pose.yaw}deg) translate3d(${-focus[0] * edge}px,${-focus[1] * edge}px,${-focus[2] * edge}px)`;
    for (const face of faces.values()) {
      const { right, down, normal } = FACE_BASES[face.side];
      const center = face.at.map((value, axis) => (value + normal[axis] * .5) * edge);
      // The element's centered local x/y axes are exactly the topology basis.
      face.surface.style.transform = `matrix3d(${[...right, 0, ...down, 0, ...normal, 0, ...center, 1].join(',')})`;
    }
    for (const skin of skins) {
      const { right, down, normal } = FACE_BASES[skin.side];
      skin.surface.style.width = `${skin.width * edge}px`;
      skin.surface.style.height = `${skin.height * edge}px`;
      skin.surface.style.marginLeft = `${-skin.width * edge / 2}px`;
      skin.surface.style.marginTop = `${-skin.height * edge / 2}px`;
      // CSS 3D can reverse the paint order of coplanar SVG planes as their
      // pixel dimensions change. Keep the welded shell a quarter CSS pixel
      // inside the solid, with the original arrow plane on its exterior.
      const center = skin.center.map((value, axis) => value * edge - normal[axis] * .25);
      skin.surface.style.transform = `matrix3d(${[...right, 0, ...down, 0, ...normal, 0, ...center, 1].join(',')})`;
    }
    host.dataset.face = selectedFace; syncVisibility(); syncMarker();
  }

  function syncMarker() {
    const piece = pieceNodes.get(hintId)?.piece, head = piece && pieceRoute(piece).at(-1);
    const points = piece && headPoints(piece), side = faces.get(head?.face)?.side;
    hintMarker.hidden = !active || !piece || !points.every(point => surfacePointVisible(currentBoard, point, side, pose, frame));
    if (hintMarker.hidden) return;
    const tip = projectWorldPoint(points[1], pose, frame), x = tip[0] * view.scale + view.x, y = tip[1] * view.scale + view.y;
    hintMarker.hidden = Math.abs(x) > dimensions.width / 2 - 18 || Math.abs(y) > dimensions.height / 2 - 18;
    hintMarker.style.transform = `translate(${x}px,${y}px)`;
    hintMarker.dataset.piece = piece.id;
  }

  function measure() {
    const rect = host.getBoundingClientRect();
    if (rect.width && rect.height) dimensions = { width: rect.width, height: rect.height };
    applyPose();
  }

  function stopPoseAnimation() { if (poseFrame) win.cancelAnimationFrame(poseFrame); poseFrame = 0; }
  function animatePose(target, immediate = false) {
    stopPoseAnimation();
    const start = { ...pose }, end = { pitch: target.pitch, yaw: nearestYaw(target.yaw, pose.yaw) };
    if (reduced.matches || immediate || closeup || !active) { pose = end; applyPose(); return; }
    const began = win.performance.now();
    const animate = now => {
      if (destroyed) return;
      const t = Math.min(1, (now - began) / 280), eased = 1 - (1 - t) ** 3;
      pose = { pitch: start.pitch + (end.pitch - start.pitch) * eased, yaw: start.yaw + (end.yaw - start.yaw) * eased };
      applyPose(); poseFrame = t < 1 ? win.requestAnimationFrame(animate) : 0;
    };
    poseFrame = win.requestAnimationFrame(animate);
  }
  function cancelGesture() { gesture = null; pinch = null; pointers.clear(); multiTouch = false; host.classList.remove('is-dragging'); }
  function clearDeparture(id) {
    const flight = departures.get(id); if (!flight) return;
    win.cancelAnimationFrame(flight.frame); flight.fragments.forEach(node => node.group.remove()); departures.delete(id);
    for (const fragment of pieceNodes.get(id)?.fragments || []) fragment.group.removeAttribute('visibility');
  }
  function clearDepartures() { for (const id of [...departures.keys()]) clearDeparture(id); }
  function clearNudge(id) {
    const nudge = nudges.get(id); if (!nudge) return;
    win.cancelAnimationFrame(nudge.frame); win.clearTimeout(nudge.timer);
    for (const fragment of nudge.fragments) { fragment.group.removeAttribute('transform'); fragment.group.style.opacity = ''; fragment.group.classList.remove('is-blocked'); }
    nudges.delete(id);
  }
  function clearPulse(id) {
    const state = pulses.get(id); if (!state) return;
    win.cancelAnimationFrame(state.frame); pulses.delete(id);
    for (const fragment of state.fragments) { fragment.group.classList.remove('is-pulse'); fragment.group.style.opacity = ''; }
  }
  function clearPulses() { for (const id of [...pulses.keys()]) clearPulse(id); }
  // 新变化的动画引导：棋子刚刚由"不可移"变成"可移"时，做一次短促呼吸，帮玩家定位。
  // 只做视觉强调，不改变可移判定，也不等于给答案；系统开启"减少动效"时跳过。
  function pulse(ids = []) {
    clearPulses();
    if (!active || destroyed || reduced.matches) return;
    for (const id of ids) {
      const node = pieceNodes.get(id); if (!node) continue;
      const began = win.performance.now(), duration = 620, state = { fragments: node.fragments, frame: 0 };
      pulses.set(id, state);
      for (const fragment of node.fragments) fragment.group.classList.add('is-pulse');
      const animate = now => {
        const t = Math.min(1, (now - began) / duration), k = Math.sin(t * Math.PI);
        for (const fragment of node.fragments) fragment.group.style.opacity = String(1 - k * .55);
        if (t < 1 && pulses.get(id) === state) state.frame = win.requestAnimationFrame(animate);
        else clearPulse(id);
      };
      state.frame = win.requestAnimationFrame(animate);
    }
  }
  function clearNudges() { for (const id of [...nudges.keys()]) clearNudge(id); }
  function syncHints() {
    for (const [id, node] of pieceNodes) {
      const hinted = id === hintId;
      if (node.hinted === hinted) continue;
      for (const fragment of node.fragments) fragment.group.classList.toggle('is-hinted', hinted);
      node.hinted = hinted;
    }
    syncMarker();
  }

  function drawFragment(node, segment) {
    const points = segment.points;
    if (!points.length) return;
    const [dx, dy] = DIRECTIONS[segment.dir], [hx, hy] = points.at(-1), tip = [hx + dx * .24, hy + dy * .24];
    const line = pathData(segment.head ? [...points, tip] : points);
    node.line.setAttribute('d', line); node.halo.setAttribute('d', line); node.hit?.setAttribute('d', line);
    if (node.head) node.head.setAttribute('points', [tip, [hx - dx * .22 - dy * .24, hy - dy * .22 + dx * .24], [hx - dx * .22 + dy * .24, hy - dy * .22 - dx * .24]].map(point => point.join(',')).join(' '));
  }

  function segmentSamples(board, segment) {
    const samples = [];
    for (let index = 0; index < segment.points.length; index++) {
      const end = segment.points[index], start = segment.points[index - 1] || end;
      const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) * 5));
      for (let step = 0; step <= steps; step++) samples.push(worldPoint(board, segment.face, start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps));
    }
    return samples;
  }

  const fragmentLabel = (piece, segment, index) => `${faces.get(segment.face).name}，向${DIRECTION_NAMES[piece.dir]}的箭头 ${index + 1}${segment.head ? '' : '，相连线段'}`;

  // 多个方块相邻时，一个物理平面可能被拆成多个 patch。跨面档位
  // 必须按方向和平面坐标去重，不能把同一平面的接缝当成转角。
  function planeKey(face, cubes) {
    const side = face.side || face.id, normal = FACE_BASES[side]?.normal;
    if (!normal) return face.id;
    const at = cubes.get(face.cubeId)?.at || [0, 0, 0];
    return `${side}:${at.reduce((sum, value, axis) => sum + value * normal[axis], 0)}`;
  }
  const crossTierClass = faces => faces >= 3 ? ' cube-cross-deep' : faces === 2 ? ' cube-cross-mid' : '';
  function makeFragment(board, piece, segment, index, fragmentIndex, interactive = true, crossFaces = 0) {
    const attributes = { class: `cube-piece${interactive ? '' : ' cube-departure'}${crossTierClass(crossFaces)}` };
    if (interactive) Object.assign(attributes, {
      role: 'button', tabindex: '-1', 'data-cube-piece': piece.id, 'data-fragment': String(fragmentIndex), 'data-face': segment.face,
      'aria-label': fragmentLabel(piece, segment, index),
    });
    const group = svgElement('g', attributes), halo = svgElement('path', { class: 'cube-arrow-halo' }), line = svgElement('path', { class: 'cube-arrow-line' });
    const head = segment.head ? svgElement('polygon', { class: 'cube-arrow-head' }) : null;
    const hit = interactive ? svgElement('path', { class: 'cube-hit-line' }) : null;
    group.append(halo, line); if (head) group.append(head); if (hit) group.append(hit);
    const node = { group, halo, line, head, hit, piece, segment, samples: interactive ? segmentSamples(board, segment) : [], visible: false };
    drawFragment(node, segment); return node;
  }

  function buildFaces(board) {
    const signature = JSON.stringify([board.id, board.rules, board.cubes, board.faces]);
    if (signature === shapeSignature) return;
    cancelGesture(); stopPoseAnimation(); closeup = false; view = { scale: 1, x: 0, y: 0 }; pose = initialPoseForBoard(board);
    selectedFace = board.faces.find(face => (face.side || face.id) === 'front')?.id || board.faces[0]?.id;
    clearDepartures(); pieceNodes.clear(); faces.clear(); skins.length = 0; body.replaceChildren(); shapeSignature = signature; visibilityState = '';
    host.dataset.surface = String(board.rules === 'surface');
    if (board.rules === 'surface') for (const sheet of surfaceSheets(board)) {
      const surface = element('div', `cube-skin cube-skin-${sheet.side}`);
      surface.dataset.side = sheet.side; surface.setAttribute('aria-hidden', 'true');
      const svg = svgElement('svg', { viewBox: `0 0 ${sheet.width} ${sheet.height}` });
      svg.append(svgElement('path', {
        d: sheet.outlines.map(outline => `${pathData(outline)} Z`).join(' '),
        'fill-rule': 'evenodd', 'vector-effect': 'non-scaling-stroke',
      }));
      surface.append(svg); body.append(surface); skins.push({ ...sheet, surface });
    }
    for (const [index, metadata] of board.faces.entries()) {
      const side = metadata.side || metadata.id, cubeIndex = board.cubes?.findIndex(cube => cube.id === metadata.cubeId) ?? 0;
      const at = board.cubes?.[Math.max(0, cubeIndex)]?.at || [0, 0, 0];
      const name = metadata.nameChinese || metadata.name || `${board.cubes?.length > 1 ? `${cubeIndex + 1}号方块·` : ''}${FACE_NAMES[side]}`;
      const surface = element('div', `cube-face cube-face-${side}`); surface.dataset.face = metadata.id;
      const svg = svgElement('svg', { role: 'group', 'aria-label': name, viewBox: `0 0 ${metadata.size} ${metadata.size}` });
      const defs = svgElement('defs'), clip = svgElement('clipPath', { id: `cube-clip-${viewId}-${index}` });
      clip.append(svgElement('rect', { x: 0, y: 0, width: metadata.size, height: metadata.size })); defs.append(clip);
      const arrows = svgElement('g', { class: 'cube-arrows', 'clip-path': `url(#cube-clip-${viewId}-${index})` });
      const flights = svgElement('g', { class: 'cube-departures', 'aria-hidden': 'true' });
      svg.append(defs, arrows, flights); surface.append(svg); body.append(surface);
      faces.set(metadata.id, { surface, svg, arrows, flights, side, at, size: metadata.size, name, visible: false });
    }
  }

  function render(board, { hintId: nextHint = null } = {}) {
    if (destroyed || !board) return;
    const candidate = doc.activeElement?.closest?.('[data-cube-piece]'), focused = body.contains(candidate) ? candidate : null;
    const focusedId = focused?.dataset.cubePiece, focusedFace = focused?.dataset.face;
    currentBoard = board; hintId = nextHint; clearNudges(); clearPulses(); buildFaces(board);
    if (!faces.has(selectedFace)) selectedFace = board.faces.find(face => (face.side || face.id) === 'front')?.id || board.faces[0]?.id;
    const remaining = new Map(board.pieces.map(piece => [piece.id, piece]));
    const cubes = new Map((board.cubes || []).map(cube => [cube.id, cube]));
    const planes = new Map(board.faces.map(face => [face.id, planeKey(face, cubes)]));
    for (const id of departures.keys()) if (remaining.has(id)) clearDeparture(id);
    // Moves retain their untouched immutable pieces. Keep those SVG groups and
    // their cached world-space samples; only changed or returned routes need
    // topology work and DOM allocation (including undo and restart).
    for (const [id, node] of pieceNodes) if (remaining.get(id) !== node.piece) {
      for (const fragment of node.fragments) fragment.group.remove();
      pieceNodes.delete(id);
    }
    board.pieces.forEach((piece, index) => {
      const retained = pieceNodes.get(piece.id);
      if (retained) {
        if (retained.index !== index) {
          for (const fragment of retained.fragments) fragment.group.setAttribute('aria-label', fragmentLabel(piece, fragment.segment, index));
          retained.index = index;
        }
        return;
      }
      const segments = routeSegments(board, piece);
      const crossFaces = new Set(segments.map(segment => planes.get(segment.face) ?? segment.face)).size;
      const fragments = segments.map((segment, fragmentIndex) => {
        return makeFragment(board, piece, segment, index, fragmentIndex, true, crossFaces);
      });
      pieceNodes.set(piece.id, { piece, fragments, index });
    });
    // Insert returned fragments at their original per-face keyboard position.
    // Existing groups stay attached, preserving their focus and paint identity.
    const nextOnFace = new Map();
    for (let index = board.pieces.length - 1; index >= 0; index--) {
      const { fragments } = pieceNodes.get(board.pieces[index].id);
      for (let fragmentIndex = fragments.length - 1; fragmentIndex >= 0; fragmentIndex--) {
        const { group, segment } = fragments[fragmentIndex];
        if (!group.parentNode) faces.get(segment.face).arrows.insertBefore(group, nextOnFace.get(segment.face) || null);
        nextOnFace.set(segment.face, group);
      }
    }
    syncHints(); measure();
    if (focusedId && active && (!body.contains(focused) || focused.getAttribute('aria-hidden') === 'true')) {
      const target = pieceNodes.get(focusedId)?.fragments.find(node => node.visible && node.segment.face === focusedFace)
        || [...pieceNodes.values()].flatMap(node => node.fragments).find(node => node.visible && node.segment.face === focusedFace);
      if (target) target.group.focus({ preventScroll: true }); else host.focus({ preventScroll: true });
    }
  }

  function reset() {
    cancelGesture(); stopPoseAnimation(); clearDepartures(); clearNudges();
    closeup = false; view = { scale: 1, x: 0, y: 0 }; hintId = null; selectedFace = currentBoard?.faces.find(face => (face.side || face.id) === 'front')?.id || 'front'; pose = initialPoseForBoard(currentBoard);
    syncHints(); measure(); notifyPose();
  }
  function turn(step) {
    if (!active || destroyed || !currentBoard) return;
    cancelGesture(); selectedFace = turnPatch(currentBoard, selectedFace, step);
    animatePose(visibleTarget(targetPose(selectedFace, !closeup), selectedPoints())); notifyPose();
  }
  function findHintPose(piece) {
    const faceId = headFace(piece), points = headPoints(piece), preferredPose = targetPose(faceId);
    const nearby = findVisiblePatchPose(currentBoard, faceId, points, { ...dimensions, preferredPose });
    if (nearby) return nearby;
    // Deep recesses can require viewing from the opposite side of a canonical
    // face. Search the remaining orbit using the same opaque-shell ray tests.
    for (let pitch = -90; pitch <= 90; pitch += 15) for (let yaw = -180; yaw < 180; yaw += 15) {
      const result = findVisiblePatchPose(currentBoard, faceId, points, { ...dimensions, preferredPose: { pitch, yaw }, search: false });
      if (result) return result;
    }
    return null;
  }
  function preferredHint(ids) {
    const supplied = ids.filter(id => pieceNodes.has(id));
    const visible = supplied.find(id => {
      const piece = pieceNodes.get(id).piece, side = faces.get(headFace(piece))?.side;
      return headPoints(piece).every(point => {
        if (!surfacePointVisible(currentBoard, point, side, pose, frame)) return false;
        const screen = projectWorldPoint(point, pose, frame);
        return Math.abs(screen[0] * view.scale + view.x) < dimensions.width / 2 - 20 && Math.abs(screen[1] * view.scale + view.y) < dimensions.height / 2 - 20;
      });
    });
    return visible || supplied.find(id => {
      const piece = pieceNodes.get(id).piece;
      return findHintPose(piece);
    }) || null;
  }
  function focusPiece(id) {
    const piece = currentBoard?.pieces.find(entry => entry.id === id);
    if (!piece || !active || destroyed) return;
    cancelGesture(); stopPoseAnimation(); hintId = id; selectedFace = headFace(piece);
    const points = headPoints(piece);
    const result = findHintPose(piece);
    if (result) {
      pose = { ...result.pose, yaw: nearestYaw(result.pose.yaw, pose.yaw) }; updateFrame();
      const tip = projectWorldPoint(points[1], pose, frame);
      view = clampView({ ...view, x: -tip[0] * view.scale, y: -tip[1] * view.scale }, dimensions);
    }
    syncHints(); applyPose(); notifyPose();
  }
  function setZoom(scale) {
    if (!active || destroyed || !currentBoard) return;
    cancelGesture(); stopPoseAnimation(); view = clampView({ ...view, scale }, dimensions);
    measure(); notifyPose();
  }
  function setCloseup(enabled) { setZoom(enabled ? 3 : 1); }
  function feedback(id) {
    const node = pieceNodes.get(id); if (!node || !active || destroyed) return;
    clearNudge(id); for (const fragment of node.fragments) fragment.group.classList.add('is-blocked');
    const nudge = { fragments: node.fragments, frame: 0, timer: 0 }; nudges.set(id, nudge);
    if (reduced.matches) { nudge.timer = win.setTimeout(() => clearNudge(id), 260); return; }
    const began = win.performance.now();
    const animate = now => {
      const t = Math.min(1, (now - began) / 270), offset = Math.sin(t * Math.PI * 4) * (1 - t) * .12;
      // Opacity feedback preserves exact joins between fragments on folded faces.
      for (const fragment of node.fragments) fragment.group.style.opacity = String(1 - Math.abs(offset) * 2);
      if (t < 1) nudge.frame = win.requestAnimationFrame(animate); else { for (const fragment of node.fragments) fragment.group.style.opacity = ''; clearNudge(id); }
    };
    nudge.frame = win.requestAnimationFrame(animate);
  }

  function playExit(piece) {
    if (!currentBoard || !active || destroyed || !headFace(piece)) return;
    clearDeparture(piece.id); clearNudge(piece.id);
    const board = currentBoard, flight = { fragments: [], frame: 0 }; departures.set(piece.id, flight);
    for (const fragment of pieceNodes.get(piece.id)?.fragments || []) fragment.group.setAttribute('visibility', 'hidden');
    const route = pieceRoute(piece), maxSize = Math.max(...board.faces.map(face => face.size));
    const distance = route.length + maxSize * Math.max(1, board.cubes?.length || 1) + 2;
    const duration = reduced.matches ? 110 : Math.min(760, 350 + route.length * 9), began = win.performance.now();
    const drawFlight = (travel, opacity) => {
      flight.fragments.forEach(node => node.group.remove());
      flight.fragments = routeSegments(board, piece, travel).map((segment, index) => {
        const node = makeFragment(board, piece, segment, 0, index, false); node.group.style.opacity = String(opacity);
        faces.get(segment.face)?.flights.append(node.group); return node;
      });
    };
    drawFlight(0, 1);
    const animate = now => {
      if (!departures.has(piece.id) || destroyed) return;
      const t = Math.min(1, (now - began) / duration);
      drawFlight(reduced.matches ? 0 : distance * (1 - (1 - t) ** 2), reduced.matches ? 1 - t : Math.min(1, (1 - t) * 2.4));
      if (t < 1) flight.frame = win.requestAnimationFrame(animate); else clearDeparture(piece.id);
    };
    flight.frame = win.requestAnimationFrame(animate);
    return duration;
  }

  function setActive(enabled) {
    if (destroyed) return;
    active = Boolean(enabled); host.hidden = !active; host.inert = !active; host.tabIndex = active ? 0 : -1; host.setAttribute('aria-hidden', String(!active));
    if (!active) { cancelGesture(); stopPoseAnimation(); clearDepartures(); clearNudges(); clearPulses(); hintId = null; syncHints(); }
    measure();
  }
  function targetFragment(target) {
    const group = target.closest?.('[data-cube-piece]'), id = group?.dataset.cubePiece;
    return { id, index: Number(group?.dataset.fragment) };
  }
  function actionable(id, index) {
    const node = pieceNodes.get(id);
    return Boolean(active && node && (Number.isInteger(index) ? node.fragments[index]?.visible : node.fragments.some(fragment => fragment.visible)));
  }
  function pointerActionable(id, index, event) {
    if (!actionable(id, index)) return false;
    const fragment = pieceNodes.get(id)?.fragments[index], face = faces.get(fragment?.segment.face);
    if (!face) return false;
    const rect = host.getBoundingClientRect(), screen = [(event.clientX - rect.left - rect.width / 2 - view.x) / view.scale, (event.clientY - rect.top - rect.height / 2 - view.y) / view.scale];
    const point = surfacePointAtScreen(currentBoard, fragment.segment.face, screen, pose, frame);
    return Boolean(point && surfacePointVisible(currentBoard, point, face.side, pose, frame));
  }
  const localPoint = event => {
    const rect = host.getBoundingClientRect();
    return { x: event.clientX - (rect.left || 0) - rect.width / 2, y: event.clientY - (rect.top || 0) - rect.height / 2 };
  };
  host.addEventListener('pointerdown', event => {
    if (!active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, localPoint(event));
    try { host.setPointerCapture(event.pointerId); } catch {}
    stopPoseAnimation();
    if (pointers.size > 1) {
      multiTouch = true; gesture = null; pinch = pointers.size === 2 ? startPinch([...pointers.values()], view) : null;
      host.classList.remove('is-dragging'); event.preventDefault(); return;
    }
    if (multiTouch) return;
    const { id, index } = targetFragment(event.target);
    gesture = startCubeGesture({ x: event.clientX, y: event.clientY, pointerId: event.pointerId, pieceId: pointerActionable(id, index, event) ? id : null, pose }); gesture.fragmentIndex = index;
  }, { ...options, passive: false });
  host.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, localPoint(event));
    if (multiTouch) {
      if (pointers.size === 2 && pinch) { view = updatePinch(pinch, [...pointers.values()], dimensions); applyPose(); notifyPose(); }
      event.preventDefault(); return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture = updateCubeGesture(gesture, { x: event.clientX, y: event.clientY }, pointers.size);
    if (gesture.canceled || !gesture.dragging) return;
    host.classList.add('is-dragging'); pose = gesture.pose; applyPose(); event.preventDefault();
  }, { ...options, passive: false });
  function finishPointer(event, canceled = false) {
    pointers.delete(event.pointerId);
    if (multiTouch) {
      gesture = null;
      pinch = pointers.size === 2 ? startPinch([...pointers.values()], view) : null;
      if (!pointers.size) multiTouch = false;
      host.classList.remove('is-dragging'); return;
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const finished = canceled ? null : updateCubeGesture(gesture, { x: event.clientX, y: event.clientY }, 1);
    gesture = null; host.classList.remove('is-dragging');
    if (!finished) return;
    const id = tappedPiece(finished);
    if (finished.dragging && !finished.canceled) { pose = finished.pose; selectedFace = closestPatch(currentBoard, pose, frame); applyPose(); notifyPose(); }
    if (id && pointerActionable(id, finished.fragmentIndex, event)) onMove(id);
  }
  host.addEventListener('pointerup', event => finishPointer(event), options);
  host.addEventListener('pointercancel', event => finishPointer(event, true), options);
  host.addEventListener('lostpointercapture', event => finishPointer(event, true), options);
  host.addEventListener('click', event => {
    if (event.detail !== 0 || multiTouch || pointers.size) return;
    const { id, index } = targetFragment(event.target); if (id && actionable(id, index)) onMove(id);
  }, options);
  host.addEventListener('keydown', event => {
    if (!active || multiTouch || pointers.size) return; const { id, index } = targetFragment(event.target);
    if ((event.key === 'Enter' || event.key === ' ') && id) { event.preventDefault(); if (!event.repeat && actionable(id, index)) onMove(id); return; }
    if (event.key === 'Home') { event.preventDefault(); reset(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); cancelGesture(); stopPoseAnimation();
    pose = { pitch: Math.max(-90, Math.min(90, pose.pitch + (event.key === 'ArrowUp' ? 18 : event.key === 'ArrowDown' ? -18 : 0))), yaw: pose.yaw + (event.key === 'ArrowLeft' ? -22 : event.key === 'ArrowRight' ? 22 : 0) };
    selectedFace = closestPatch(currentBoard, pose, frame); applyPose(); notifyPose();
  }, options);
  const observer = new ResizeObserver(() => { if (!destroyed) measure(); }); observer.observe(host); setActive(false);
  function destroy() {
    if (destroyed) return;
    cancelGesture(); stopPoseAnimation(); clearDepartures(); clearNudges(); clearPulses(); observer.disconnect(); listeners.abort(); destroyed = true; host.replaceChildren(); host.classList.remove('cube-stage', 'is-closeup', 'is-dragging');
  }
  return { render, reset, turn, focusPiece, setCloseup, setZoom, preferredHint, feedback, playExit, pulse, setActive, destroy };
}
