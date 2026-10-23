import { routeSegments, worldPoint } from './surface-topology.js?v=18';

const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const ease = value => value * value * (3 - 2 * value);
const validMode = mode => ['classic', 'search', 'cube'].includes(mode) ? mode : 'classic';
const departureTimes = [
  { id: 'blocker', start: 2200, end: 3100 },
  { id: 'main', start: 3600, end: 4500 },
  { id: 'last', start: 5000, end: 5900 },
];

// A tiny separate puzzle teaches the real head-ray rule without touching a game.
export function createGuideScene(requestedMode) {
  const mode = validMode(requestedMode);
  const pieces = mode === 'classic' ? [
    { id: 'main', cells: [[1, 2], [2, 2]], dir: 'right', color: 0 },
    { id: 'blocker', cells: [[3, 3], [3, 2]], dir: 'up', color: 1 },
    { id: 'last', cells: [[1, 1], [0, 1]], dir: 'left', color: 2 },
  ] : [
    { id: 'main', cells: [[0, 3], [1, 3], [1, 2], [2, 2]], dir: 'right', color: 0 },
    { id: 'blocker', cells: [[4, 3], [3, 3], [3, 2]], dir: 'up', color: 1 },
    { id: 'last', cells: [[0, 1], [1, 1], [1, 0]], dir: 'up', color: 2 },
  ];
  if (mode !== 'cube') return { id: 0, name: '玩法演示', size: 5, pieces };
  const mainRoute = [
    ...[2, 1, 0].map(x => ({ face: 'right', x, y: 4 })),
    ...[4, 3, 2, 1].map(x => ({ face: 'front', x, y: 4 })),
    { face: 'front', x: 1, y: 3 }, { face: 'front', x: 1, y: 2 }, { face: 'front', x: 2, y: 2 },
  ];
  return {
    id: 0, name: '立体玩法演示', rules: 'surface',
    faces: ['front', 'right', 'back', 'left', 'top', 'bottom'].map(id => ({ id, size: 5 })),
    pieces: pieces.map(piece => ({
      id: piece.id, dir: piece.dir, color: piece.color,
      route: piece.id === 'main' ? mainRoute : piece.cells.map(([x, y]) => ({ face: 'front', x, y })),
    })),
  };
}

export function guideDemoFrame(requestedMode, elapsedMs = 0) {
  const mode = validMode(requestedMode), offset = mode === 'cube' ? 1600 : 0;
  const duration = offset + 6100;
  const elapsed = clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, duration);
  const time = elapsed - offset;
  const stages = [
    { start: 0, phase: 'look', caption: mode === 'classic' ? '轻点小块，它会顺着箭头走。' : '先看箭头前方，有没有别的线。' },
    { start: 700, phase: 'blocked', caption: '前面被挡住了，误点也没关系。' },
    { start: 1900, phase: 'blocker', caption: '先点这一条，把挡路的移走。' },
    { start: 3300, phase: 'main', caption: mode === 'cube' ? '出路空了，跨面的长线也能抽走。' : '出路空了，这一条就能走了。' },
    { start: 4700, phase: 'last', caption: '继续移走剩下的箭头。' },
    { start: 6100, phase: 'clear', caption: '全部清空就过关，不限尝试次数。' },
  ];
  let index = stages.findLastIndex(stage => time >= stage.start);
  const rotating = time < 0;
  if (index < 0) index = 0;
  const stage = rotating ? { phase: 'rotate', caption: '按住拖一拖，转到另一面看长线。' } : stages[index];
  const cursorId = stage.phase === 'blocker' ? 'blocker' : stage.phase === 'last' ? 'last' : 'main';
  return {
    mode, elapsed, duration, phase: stage.phase, step: rotating ? 0 : index + (mode === 'cube' ? 1 : 0),
    caption: stage.caption, done: elapsed >= duration,
    remainingIds: ['main', 'blocker', 'last'].filter(id => time < departureTimes.find(entry => entry.id === id).end),
    departures: departureTimes.filter(entry => time > entry.start && time < entry.end).map(entry => ({
      id: entry.id, progress: ease((time - entry.start) / (entry.end - entry.start)),
    })),
    blocked: stage.phase === 'blocked',
    shake: stage.phase === 'blocked' ? Math.sin((time - 700) / 48) * 3 * (1 - clamp((time - 700) / 650)) : 0,
    yaw: mode === 'cube' ? -12 - 28 * ease(clamp(elapsed / 1600)) : 0,
    pitch: -19,
    cursor: {
      id: cursorId, rotating,
      visible: rotating || !['clear'].includes(stage.phase) && (time - stages[index].start < 480),
      pressed: !rotating && time - stages[index].start > 130 && time - stages[index].start < 400,
      progress: clamp(elapsed / 1600),
    },
  };
}

// Time advances only while visible and playing; no interval or storage is owned here.
export function createGuidePlayback({ mode = 'classic', reducedMotion = false, now = () => performance.now() } = {}) {
  mode = validMode(mode);
  let elapsed = 0, anchor = now(), playing = !reducedMotion, suspended = false, destroyed = false, manualIndex = 0;
  const manualTimes = mode === 'cube' ? [0, 1600, 2700, 4800, 6200, 7800] : [0, 1100, 3200, 4600, 6200];
  function snapshot() {
    const current = now();
    if (playing && !suspended && !destroyed) elapsed += Math.max(0, current - anchor);
    anchor = current;
    const frame = guideDemoFrame(mode, elapsed);
    elapsed = frame.elapsed;
    if (frame.done) playing = false;
    return { ...frame, shake: reducedMotion ? 0 : frame.shake, playing, suspended, reducedMotion };
  }
  return {
    snapshot,
    setSuspended(value) { snapshot(); suspended = Boolean(value); anchor = now(); },
    toggle() {
      const frame = snapshot();
      if (!destroyed && !reducedMotion) {
        if (frame.done) { elapsed = 0; playing = true; }
        else playing = !playing;
      }
      return snapshot();
    },
    next() {
      if (!destroyed && reducedMotion) {
        manualIndex = (manualIndex + 1) % manualTimes.length;
        elapsed = manualTimes[manualIndex];
      }
      return snapshot();
    },
    destroy() { snapshot(); playing = false; destroyed = true; },
  };
}

const coordinate = value => Number(value.toFixed(2));
const pointString = point => point.map(coordinate).join(',');
const pathString = points => points.map((point, index) => `${index ? 'L' : 'M'}${pointString(point)}`).join(' ');
function pulledPoints(cells, dir, travel) {
  const points = cells.map(([x, y]) => [x + .5, y + .5]), vector = vectors[dir];
  const head = points.at(-1), bodyLength = points.length - 1;
  points.push(head.map((value, index) => value + vector[index] * (travel + bodyLength + 7)));
  const result = [];
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const from = Math.max(travel, distance), to = Math.min(travel + bodyLength, distance + length);
    if (to > from) {
      const interpolate = position => a.map((value, axis) => value + (b[axis] - value) * (position - distance) / length);
      if (!result.length) result.push(interpolate(from));
      result.push(interpolate(to));
    }
    distance += length;
  }
  return result;
}
function rotate(point, yaw, pitch) {
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  const x = point[0] * Math.cos(y) + point[2] * Math.sin(y);
  const z = -point[0] * Math.sin(y) + point[2] * Math.cos(y);
  return [x, point[1] * Math.cos(p) - z * Math.sin(p), point[1] * Math.sin(p) + z * Math.cos(p)];
}
function projected(point, frame) {
  const [x, y] = rotate(point, frame.yaw, frame.pitch);
  return [140 + x * 102, 82 + y * 102];
}
function arrowAt(head, vector, size, color) {
  const length = Math.hypot(...vector), direction = vector.map(value => value / length);
  const base = head.map((value, axis) => value - direction[axis] * size);
  const left = [base[0] - direction[1] * size * .55, base[1] + direction[0] * size * .55];
  const right = [base[0] + direction[1] * size * .55, base[1] - direction[0] * size * .55];
  return `<path d="${pathString([left, head, right])}Z" fill="${color}" stroke="${color}" stroke-width=".7"/>`;
}
function finger(point, pressed = false) {
  const [x, y] = point;
  return `<g class="guide-demo-finger" transform="translate(${coordinate(x)} ${coordinate(y)})"><circle r="${pressed ? 12 : 16}" fill="#fffdf6" fill-opacity=".5" stroke="#385741" stroke-opacity=".35" stroke-width="1"/><circle r="${pressed ? 4 : 2.5}" fill="#385741"/><path transform="translate(0 4) scale(.62)" d="M0 0V12L-4 9C-7 7-10 10-8 13L0 23Q3 27 8 27H11Q19 27 19 19V10Q19 7 16 7H8V0Q8-4 4-4Q0-4 0 0Z" fill="#fffdf6" stroke="#385741" stroke-width="2"/></g>`;
}
function drawScene(scene, frame) {
  const cube = frame.mode === 'cube', classic = frame.mode === 'classic';
  const drawPiece = (piece, points, direction, opacity = 1) => {
    const blocked = frame.blocked && piece.id === 'main';
    const stroke = blocked ? '#9b6335' : '#304b3b';
    const fill = blocked ? '#d3ad84' : ['#aebfa2', '#d7b99a', '#c7caa4'][piece.color];
    const nudge = blocked ? frame.shake : 0;
    const line = `<path d="${pathString(points)}" fill="none" stroke="${classic ? fill : stroke}" stroke-width="${classic ? 15 : cube ? 3.2 : 4}" stroke-linejoin="round" stroke-linecap="round"/>`;
    return `<g opacity="${coordinate(opacity)}" transform="translate(0 ${coordinate(nudge)})">${line}${arrowAt(points.at(-1), direction, classic ? 7 : cube ? 6.5 : 8, stroke)}</g>`;
  };
  let markup = '', cursorPoint;
  if (cube) {
    const faces = scene.faces.map(face => {
      const world = [[0, 0], [5, 0], [5, 5], [0, 5]].map(([x, y]) => worldPoint(scene, face.id, x, y));
      const a = world[0], b = world[1], d = world[3];
      const u = b.map((value, index) => value - a[index]), v = d.map((value, index) => value - a[index]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      return { ...face, world, visible: rotate(normal, frame.yaw, frame.pitch)[2] > .001, depth: world.reduce((sum, point) => sum + rotate(point, frame.yaw, frame.pitch)[2], 0) / 4 };
    }).filter(face => face.visible).sort((a, b) => a.depth - b.depth);
    for (const face of faces) {
      const fill = face.id === 'top' ? '#f8f7ef' : face.id === 'right' ? '#d7dfce' : '#eef0e4';
      markup += `<polygon points="${face.world.map(point => pointString(projected(point, frame))).join(' ')}" fill="${fill}" stroke="#bbc8b3" stroke-width="1.1"/>`;
      for (const piece of scene.pieces) {
        if (!frame.remainingIds.includes(piece.id)) continue;
        const flight = frame.departures.find(entry => entry.id === piece.id);
        const travel = (flight?.progress ?? 0) * (piece.route.length + 6);
        const fragments = routeSegments(scene, piece, travel);
        for (const fragment of fragments.filter(entry => entry.face === face.id)) {
          const points = fragment.points.map(([x, y]) => projected(worldPoint(scene, fragment.face, x, y), frame));
          const last = fragments.at(-1) === fragment;
          const direction = points.at(-1).map((value, index) => value - points.at(-2)[index]);
          if (last) markup += drawPiece(piece, points, direction, flight ? 1 - flight.progress * .65 : 1);
          else markup += `<path d="${pathString(points)}" transform="translate(0 ${coordinate(frame.blocked && piece.id === 'main' ? frame.shake : 0)})" fill="none" stroke="${frame.blocked && piece.id === 'main' ? '#9b6335' : '#304b3b'}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" opacity="${flight ? coordinate(1 - flight.progress * .65) : 1}"/>`;
        }
      }
    }
    const cursorPiece = scene.pieces.find(piece => piece.id === frame.cursor.id), head = cursorPiece.route.at(-1);
    cursorPoint = projected(worldPoint(scene, head.face, head.x + .5, head.y + .5), frame);
    if (frame.cursor.rotating) {
      const progress = ease(frame.cursor.progress);
      markup += '<path d="M174 121H106m5-4-5 4 5 4" fill="none" stroke="#71846b" stroke-width="1.5" stroke-dasharray="3 4"/>';
      cursorPoint = [174 - 68 * progress, 121];
    }
  } else {
    markup += '<rect x="70" y="12" width="140" height="140" rx="10" fill="#f5f5eb" stroke="#d8dfce" stroke-width="1"/>';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) markup += `<circle cx="${84 + x * 28}" cy="${26 + y * 28}" r="1.1" fill="#cfd9c5"/>`;
    if (frame.blocked) markup += '<path d="M148 82H160" fill="none" stroke="#9b6335" stroke-width="1.4" stroke-dasharray="2 3"/>';
    for (const piece of scene.pieces) {
      if (!frame.remainingIds.includes(piece.id)) continue;
      const flight = frame.departures.find(entry => entry.id === piece.id);
      const travel = (flight?.progress ?? 0) * (piece.cells.length + 6);
      const points = pulledPoints(piece.cells, piece.dir, travel).map(([x, y]) => [70 + x * 28, 12 + y * 28]);
      markup += drawPiece(piece, points, vectors[piece.dir], flight ? 1 - flight.progress * .65 : 1);
    }
    const piece = scene.pieces.find(entry => entry.id === frame.cursor.id), head = piece.cells.at(-1);
    cursorPoint = [84 + head[0] * 28, 26 + head[1] * 28];
  }
  if (frame.done) markup += `<circle cx="140" cy="82" r="24" fill="#f5f5eb" stroke="#b3c3a8" stroke-width="1"/><path d="M128 82l8 8 16-18" fill="none" stroke="#385741" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (frame.cursor.visible && !frame.done) markup += finger(cursorPoint, frame.cursor.pressed);
  return markup;
}

export function createGuideDemo(host, { mode = 'classic', reducedMotion = false } = {}) {
  const document = host.ownerDocument, window = document.defaultView;
  const scene = createGuideScene(mode), playback = createGuidePlayback({ mode, reducedMotion, now: () => window.performance.now() });
  const container = document.createElement('div'), stage = document.createElement('div'), footer = document.createElement('div');
  const badge = document.createElement('span'), caption = document.createElement('p'), control = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  container.className = 'guide-demo'; stage.className = 'guide-demo-stage'; footer.className = 'guide-demo-footer';
  badge.className = 'guide-demo-badge'; badge.textContent = reducedMotion ? '分步演示' : '动画演示';
  caption.className = 'guide-demo-caption'; caption.setAttribute('aria-live', 'polite'); caption.setAttribute('aria-atomic', 'true');
  control.className = 'guide-demo-control'; control.type = 'button';
  svg.setAttribute('viewBox', '0 0 280 164'); svg.setAttribute('aria-hidden', 'true');
  stage.append(badge, svg); footer.append(caption, control); container.append(stage, footer); host.replaceChildren(container);
  let raf = 0, destroyed = false, previousStep = -1;
  function render() {
    const frame = playback.snapshot();
    svg.innerHTML = drawScene(scene, frame);
    if (frame.step !== previousStep) { caption.textContent = frame.caption; previousStep = frame.step; }
    const label = reducedMotion ? frame.done ? '重看演示' : '下一步' : frame.done ? '重看演示' : frame.playing ? '暂停演示' : '继续演示';
    if (control.textContent !== label) control.textContent = label;
    container.dataset.phase = frame.phase;
    return frame;
  }
  function schedule(frame) {
    if (destroyed || raf) return;
    if (frame.playing && !frame.suspended) raf = window.requestAnimationFrame(() => { raf = 0; schedule(render()); });
  }
  function onControl() {
    if (reducedMotion) playback.next(); else playback.toggle();
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    schedule(render());
  }
  control.addEventListener('click', onControl);
  schedule(render());
  return {
    setSuspended(value) {
      if (destroyed) return;
      playback.setSuspended(value);
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
      if (!value) schedule(render());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; playback.destroy();
      if (raf) window.cancelAnimationFrame(raf);
      control.removeEventListener('click', onControl);
      if (container.parentNode === host) host.replaceChildren();
    },
  };
}
