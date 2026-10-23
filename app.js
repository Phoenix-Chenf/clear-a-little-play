import { LEVEL_COUNT, SEARCH_LEVEL_COUNT, createLevel, createSearchLevel, availableMoves, tryMove } from './engine.js?v=8';
import { expireNudges } from './feedback.js?v=5';
import { restoreProgress, PROGRESS_REVISION } from './progress.js?v=5';
import { hitPieceAt, exitPath, updateGesture, isTapGesture } from './geometry.js?v=5';
import { restoreSearchProgress, SEARCH_PROGRESS_REVISION } from './search-progress.js?v=8';
import { CUBE_LEVEL_COUNT, createCubeLevel, availableCubeMoves, tryCubeMove } from './cube-engine.js?v=18';
import { restoreCubeProgress, CUBE_PROGRESS_REVISION } from './cube-progress.js?v=18';
import { createShapeView } from './shape-view.js?v=18';
import { restorePlayHistory, recordCompletion, formatDuration, createPlayTimer } from './play-history.js?v=1';
import { createGuideDemo } from './guide-demo.js?v=1';

const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d'), piecesEl = $('pieces');
const viewport = $('board-viewport'), surface = $('board-surface');
const storeKey = 'clear-a-little-v1';
const searchStoreKey = 'clear-a-little-search-v1', modeStoreKey = 'clear-a-little-mode';
const cubeStoreKey = 'clear-a-little-cube-v1';
const historyStoreKey = 'clear-a-little-play-history-v1';
const dirs = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const names = { up: '上', right: '右', down: '下', left: '左' };
const colors = [['#a3b9a0', '#34573c'], ['#d8b093', '#795035'], ['#c5c59b', '#596238'], ['#9bb5bb', '#365c68'], ['#c0aab7', '#715164']];
let board, initial, history = [], flights = [], nudges = new Map(), sparks = [], hintId = null, hintEnd = 0;
let screenSize = 350, layout, raf = 0, completed = new Set(), level = 1, zoom = 1, gesture = null;
let sound = false, audio, statusTimer, finishTimer, cubeHintTimer;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const readProgress = (key, restore) => {
  try { return restore(JSON.parse(localStorage.getItem(key))); } catch { return restore(null); }
};
let playHistory = readProgress(historyStoreKey, restorePlayHistory);
const playTimer = createPlayTimer();
let timerTick, guideDemo;
const guides = {
  classic: { name: '原版 100 关', title: '顺着箭头，慢慢清空。', steps: [
    ['轻点一下', '点小块或线路的任意一段。'],
    ['看箭头前方', '被挡住时，先移开挡路的线。'],
    ['清空就过关', '不限次数，可撤回、看提示和放大。'],
  ] },
  search: { name: '密线找箭头', title: '先找一条空着的出路。', steps: [
    ['先看前方', '箭头前方没有别的线，就能移走。'],
    ['点线路任意一段', '线太密时，放大后拖动查看。'],
    ['一条条清空', '不限次数，也能撤回、看提示。'],
  ] },
  cube: { name: '立体找箭头', title: '转一转，找到下一条出路。', steps: [
    ['拖动旋转', '看看背面和另一侧。'],
    ['点线路任意一段', '长线可能跨面，箭头前方空了才能抽走。'],
    ['慢慢清空整个造型', '不限次数，可放大、撤回或看提示。'],
  ] },
};
const modeProgress = {
  classic: readProgress(storeKey, saved => restoreProgress(saved, LEVEL_COUNT)),
  search: readProgress(searchStoreKey, restoreSearchProgress),
  cube: readProgress(cubeStoreKey, restoreCubeProgress),
};
let mode = 'cube';
try {
  const savedMode = localStorage.getItem(modeStoreKey);
  if (['classic', 'search', 'cube'].includes(savedMode)) mode = savedMode;
} catch {}
const requestedMode = new URLSearchParams(location.search).get('mode');
if (['classic', 'search', 'cube'].includes(requestedMode)) mode = requestedMode;
level = modeProgress[mode].level;
completed = new Set(modeProgress[mode].completed);
const isSearch = () => mode === 'search';
const isCube = () => mode === 'cube';
const isRound = () => isCube() && board?.rules === 'round';
const isTutorial = () => mode === 'classic' && level < 4;
const levelCount = () => isCube() ? CUBE_LEVEL_COUNT : isSearch() ? SEARCH_LEVEL_COUNT : LEVEL_COUNT;
const cubeView = createShapeView({
  host: $('cube-stage'), onMove: id => move(id),
  onPoseChange: pose => {
    if (!isCube()) return;
    zoom = pose.closeup ? 3 : 1;
    updateZoomControl();
  },
});

function save() {
  const progress = { level, completed: [...completed], revision: isCube() ? CUBE_PROGRESS_REVISION : isSearch() ? SEARCH_PROGRESS_REVISION : PROGRESS_REVISION };
  modeProgress[mode] = progress;
  try {
    localStorage.setItem(isCube() ? cubeStoreKey : isSearch() ? searchStoreKey : storeKey, JSON.stringify(progress));
    localStorage.setItem(modeStoreKey, mode);
  } catch {}
}

function restingCopy() {
  if (isRound()) return '前方留出一小段空隙，线路就能抽走。';
  return isCube() ? (level >= 4 ? '线路会跨面，箭头前方空了才能移走。' : '沿本面出口离开，清空六面过关。') : isSearch() ? '找一条前方空着的箭头，不用着急。' : isTutorial() ? '顺着箭头，把小块移出去。' : '看清方向，一条一条清空。';
}

function savePlayHistory() {
  try { localStorage.setItem(historyStoreKey, JSON.stringify(playHistory)); }
  catch { $('record-note').textContent = '当前浏览器暂时无法保存记录，关闭页面后可能丢失。'; }
}

function renderTime() {
  const elapsed = playTimer.elapsed();
  $('attempt-time').textContent = `本关用时 ${formatDuration(playTimer.finished ? elapsed : Math.floor(elapsed / 1000) * 1000)}`;
  const record = playHistory.times[mode][level];
  $('best-time').hidden = !record;
  $('best-time').textContent = record ? `上次 ${formatDuration(record.latestMs)} · 最佳 ${formatDuration(record.bestMs)}` : '';
}

function syncTimer() {
  const paused = document.hidden || $('guide-dialog').open || $('level-dialog').open;
  playTimer.setPaused(paused);
  clearInterval(timerTick);
  renderTime();
  if (!paused && !playTimer.finished) timerTick = setInterval(renderTime, 1000);
  guideDemo?.setSuspended(document.hidden || !$('guide-dialog').open);
}

function mountGuideDemo() {
  guideDemo?.destroy();
  guideDemo = createGuideDemo($('guide-demo'), { mode, reducedMotion: reduced.matches });
}

function showGuide(firstVisit = false) {
  const guide = guides[mode], list = $('guide-steps');
  $('guide-mode').textContent = guide.name;
  $('guide-title').textContent = guide.title;
  $('guide-start').textContent = firstVisit ? '开始玩' : '继续玩';
  list.replaceChildren();
  for (const [title, copy] of guide.steps) {
    const item = document.createElement('li'), heading = document.createElement('strong'), text = document.createElement('span');
    heading.textContent = title; text.textContent = copy; item.append(heading, text); list.append(item);
  }
  $('guide-dialog').showModal();
  $('guide-title').focus({ preventScroll: true });
  $('guide-scroll').scrollTop = 0;
  mountGuideDemo();
  syncTimer();
}

function message(text, kind = '') {
  clearTimeout(statusTimer);
  $('feedback').textContent = text;
  $('feedback').dataset.kind = kind;
  if (kind) statusTimer = setTimeout(() => { if (board.pieces.length) message(restingCopy()); }, 2100);
}

function tone(clear = false, blocked = false) {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const time = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(blocked ? 180 : clear ? 523 : 440 + (initial.pieces.length - board.pieces.length) % 5 * 55, time);
    if (!blocked) osc.frequency.exponentialRampToValueAtTime(clear ? 784 : 620, time + .09);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(.055, time + .009);
    gain.gain.exponentialRampToValueAtTime(.001, time + (clear ? .3 : .12));
    osc.connect(gain); gain.connect(audio.destination); osc.start(time); osc.stop(time + .34);
  } catch {}
}

function updateZoomControl() {
  $('zoom').setAttribute('aria-pressed', String(zoom > 1));
  $('zoom-label').textContent = isCube() ? (zoom > 1 ? '还原立体' : isRound() ? '细看曲面' : '细看这一面') : zoom > 1 ? '还原棋盘' : '放大棋盘';
  $('board-guide').textContent = isCube() ? (zoom > 1 ? isRound() ? '近看曲面，轻点线路。' : '正对这一面，轻点线路。' : '拖动旋转，轻点线路。') : zoom > 1 ? '拖动棋盘，看四周。' : '点箭头任意一段。';
  viewport.classList.toggle('zoomed', !isCube() && zoom > 1);
}

function setBoard(n) {
  clearTimeout(finishTimer); clearTimeout(statusTimer); clearTimeout(cubeHintTimer);
  level = n; initial = isCube() ? createCubeLevel(n) : isSearch() ? createSearchLevel(n) : createLevel(n); board = initial;
  history = []; flights = []; sparks = []; nudges.clear(); hintId = null; gesture = null; zoom = 1;
  $('finish').hidden = true;
  $('level-label').textContent = isCube() ? `立体 ${String(n).padStart(2, '0')} / ${String(CUBE_LEVEL_COUNT).padStart(2, '0')} 关` : isSearch() ? `密线 ${String(n).padStart(2, '0')} / ${String(SEARCH_LEVEL_COUNT).padStart(2, '0')} 关` : `第 ${String(n).padStart(2, '0')} 关`;
  $('level-name').textContent = initial.name;
  document.body.dataset.mode = mode;
  $('mode-search').setAttribute('aria-pressed', String(isSearch()));
  $('mode-cube').setAttribute('aria-pressed', String(isCube()));
  $('mode-classic').setAttribute('aria-pressed', String(mode === 'classic'));
  $('intro').textContent = isCube() ? (n >= 9 ? '沿着更长的线，找一条出路。' : n >= 6 ? '换个形状，把线路慢慢理清。' : n >= 4 ? '跟着线路，转过一个弯。' : '转一转，让每一面都空出来。') : isSearch() ? '找一条出路，慢慢清空。' : '点一下，让拥挤慢慢散开。';
  if (isRound()) $('intro').textContent = initial.shape.type === 'sphere' ? '绕到背面，找一条出路。' : '沿着圆柱，把长线慢慢抽出。';
  $('pace-note').textContent = isCube() || isSearch() ? '不限次数，误点没关系。' : '慢慢来，没有倒计时。';
  viewport.hidden = isCube();
  $('cube-controls').hidden = !isCube();
  $('cube-stage').setAttribute('aria-label', n >= 6 ? '可旋转的立体箭头造型' : '可旋转的六面箭头立方体');
  if (isRound()) $('cube-stage').setAttribute('aria-label', initial.shape.type === 'sphere' ? '可旋转的球面箭头' : '可旋转的圆柱箭头');
  for (const [id, label, description] of [
    ['cube-prev', isRound() ? '向左转' : '上一面', isRound() ? '向左转一转' : '查看上一面'],
    ['cube-next', isRound() ? '向右转' : '下一面', isRound() ? '向右转一转' : '查看下一面'],
  ]) {
    const button = $(id);
    button.setAttribute('aria-label', description);
    for (const node of button.childNodes) if (node.nodeType === 3) node.textContent = label;
  }
  $('zoom').setAttribute('aria-controls', isCube() ? 'cube-stage' : 'board-viewport');
  cubeView.setActive(isCube());
  if (isCube()) cubeView.reset();
  updateZoomControl();
  message(restingCopy());
  resize(); viewport.scrollLeft = 0; viewport.scrollTop = 0;
  refresh(); save(); requestDraw();
  playTimer.setPaused(true); playTimer.reset();
  if (!playHistory.guides[mode]) showGuide(true);
  syncTimer();
}

function selectMode(nextMode) {
  if (mode === nextMode) return;
  save(); mode = nextMode;
  const url = new URL(location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState(null, '', url);
  completed = new Set(modeProgress[mode].completed);
  setBoard(modeProgress[mode].level);
}

function bounds(points) {
  const xs = points.map(c => c[0]), ys = points.map(c => c[1]);
  return {
    x: layout.pad + Math.min(...xs) * layout.cell + layout.inset,
    y: layout.pad + Math.min(...ys) * layout.cell + layout.inset,
    w: (Math.max(...xs) - Math.min(...xs) + 1) * layout.cell - layout.inset * 2,
    h: (Math.max(...ys) - Math.min(...ys) + 1) * layout.cell - layout.inset * 2,
  };
}

function refresh() {
  $('count').textContent = `已移走 ${initial.pieces.length - board.pieces.length} / ${initial.pieces.length}`;
  $('undo').disabled = !history.length;
  $('hint').disabled = !board.pieces.length;
  renderHits();
}

function keepHeadVisible(button) {
  if (zoom === 1) return;
  const edge = layout.cell * .4;
  const left = parseFloat(button.style.left), top = parseFloat(button.style.top);
  const right = left + layout.cell, bottom = top + layout.cell;
  if (left < viewport.scrollLeft + edge) viewport.scrollLeft = left - edge;
  else if (right > viewport.scrollLeft + viewport.clientWidth - edge) viewport.scrollLeft = right - viewport.clientWidth + edge;
  if (top < viewport.scrollTop + edge) viewport.scrollTop = top - edge;
  else if (bottom > viewport.scrollTop + viewport.clientHeight - edge) viewport.scrollTop = bottom - viewport.clientHeight + edge;
}

function renderHits() {
  if (isCube()) { piecesEl.replaceChildren(); cubeView.render(board, { hintId }); return; }
  if (!layout || !board) return;
  const active = document.activeElement;
  const focused = active?.matches('.piece-hit:focus-visible') ? active.dataset.piece : null;
  piecesEl.replaceChildren();
  board.pieces.forEach((piece, index) => {
    const head = piece.cells[piece.cells.length - 1], button = document.createElement('button');
    button.className = 'piece-hit'; button.dataset.piece = piece.id;
    button.setAttribute('aria-label', `向${names[piece.dir]}的箭头 ${index + 1}`);
    Object.assign(button.style, {
      left: `${layout.pad + head[0] * layout.cell}px`, top: `${layout.pad + head[1] * layout.cell}px`,
      width: `${layout.cell}px`, height: `${layout.cell}px`,
    });
    // Pointer taps resolve against the occupied cells along the entire path.
    // The head button provides native keyboard and assistive-technology activation.
    button.addEventListener('click', event => { if (event.detail === 0) move(piece.id); });
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) keepHeadVisible(button); });
    piecesEl.append(button);
  });
  if (focused) {
    const remaining = [...piecesEl.children];
    (remaining.find(el => el.dataset.piece === focused) || remaining[0])?.focus({ preventScroll: true });
  }
}

function move(id) {
  if (!board.pieces.length || !$('finish').hidden || $('guide-dialog').open || $('level-dialog').open) return;
  const result = isCube() ? tryCubeMove(board, id) : tryMove(board, id), piece = board.pieces.find(p => p.id === id);
  if (!piece) return;
  const now = performance.now();
  if (!result.moved) {
    nudges.set(id, now);
    if (isCube()) cubeView.feedback(id);
    message(isSearch() || isCube() ? '前方还有线，再找找。可以一直试。' : isTutorial() ? '前面还有小块，慢慢找一找。' : '这条路还没空，慢慢找一找。', 'blocked');
    tone(false, true); requestDraw(); return;
  }
  history.push(board); board = result.board; hintId = null;
  clearTimeout(cubeHintTimer);
  message('又空出一点。', 'success');
  if (isCube()) cubeView.playExit(piece);
  else {
    flights.push({ piece, start: now, duration: reduced.matches ? 100 : 360 + piece.cells.length * 10 });
    const head = piece.cells[piece.cells.length - 1];
    const center = { x: layout.pad + (head[0] + .5) * layout.cell, y: layout.pad + (head[1] + .5) * layout.cell };
    if (!reduced.matches) for (let i = 0; i < 4; i++) sparks.push({ ...center, angle: i * Math.PI / 2 + .3, start: now, color: isSearch() ? '#2c4237' : colors[piece.color % 5][1] });
  }
  tone(); refresh(); requestDraw();
  if (!board.pieces.length) {
    playHistory = recordCompletion(playHistory, mode, level, playTimer.complete());
    savePlayHistory(); syncTimer();
    completed.add(level); save();
    finishTimer = setTimeout(finish, reduced.matches ? 120 : 530);
  }
}

function finish() {
  if (board.pieces.length) return;
  const last = level === levelCount();
  $('finish-title').textContent = last ? '都空出来了。' : '空出来了。';
  $('finish-copy').textContent = last && isCube() ? `${CUBE_LEVEL_COUNT}关立体，都慢慢理清了。` : last && isSearch() ? `${SEARCH_LEVEL_COUNT}关密线，都慢慢理清了。` : last ? '谢谢你慢慢玩到这里。' : '留一点空，刚刚好。';
  $('next').firstChild.textContent = last ? '从头再玩' : '再来一关';
  $('finish').hidden = false;
  const record = playHistory.times[mode][level];
  $('finish-time').textContent = `本次用时 ${formatDuration(playTimer.elapsed())}`;
  $('finish-best').textContent = record ? `最佳用时 ${formatDuration(record.bestMs)}` : '';
  message(last ? '也可以选一关，换个顺序再玩。' : '可以歇一下，也可以再来一关。', 'success');
  tone(true);
}

function requestDraw() { if (!isCube() && !raf) raf = requestAnimationFrame(draw); }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function pixelPoints(points) { return points.map(([x, y]) => [layout.pad + (x + .5) * layout.cell, layout.pad + (y + .5) * layout.cell]); }
function trace(points) {
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
}
function arrowHead(head, direction, size, filled = false) {
  const [dx, dy] = direction;
  const tip = [head[0] + dx * size * .55, head[1] + dy * size * .55];
  ctx.beginPath();
  ctx.moveTo(tip[0] - dx * size - dy * size * .7, tip[1] - dy * size + dx * size * .7);
  ctx.lineTo(...tip);
  ctx.lineTo(tip[0] - dx * size + dy * size * .7, tip[1] - dy * size - dx * size * .7);
  if (filled) { ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
  else ctx.stroke();
}

function drawPiece(piece, points, alpha = 1, time = 0, moving = false) {
  const palette = isSearch() ? ['#e8ecdf', '#2c4237'] : colors[piece.color % 5], direction = dirs[piece.dir];
  const pixels = pixelPoints(points), head = pixels[pixels.length - 1];
  const hinting = !moving && piece.id === hintId && time < hintEnd;
  let nudge = 0;
  const start = nudges.get(piece.id);
  if (!reduced.matches && !moving && start !== undefined) {
    const age = time - start;
    if (age < 300) nudge = Math.sin(age / 300 * Math.PI * 4) * (1 - age / 300) * Math.min(3, layout.cell * .15);
  }
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(direction[0] * nudge, direction[1] * nudge);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (isTutorial()) {
    const b = bounds(points);
    ctx.shadowColor = '#2e453118'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
    roundRect(b.x, b.y, b.w, b.h, Math.min(9, layout.cell * .2));
    ctx.fillStyle = palette[0]; ctx.fill(); ctx.shadowColor = 'transparent';
    const arrow = layout.cell * .17, tail = pixels[0];
    ctx.strokeStyle = palette[1]; ctx.lineWidth = Math.max(2, layout.cell * .055);
    ctx.beginPath();
    ctx.moveTo(tail[0] - direction[0] * arrow * .5, tail[1] - direction[1] * arrow * .5);
    ctx.lineTo(head[0] + direction[0] * arrow * .55, head[1] + direction[1] * arrow * .55);
    ctx.stroke(); arrowHead(head, direction, arrow);
    if (hinting) {
      roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, 10);
      ctx.strokeStyle = '#244b34'; ctx.lineWidth = 2.2; ctx.stroke();
    }
  } else {
    const width = Math.max(isSearch() ? 1.5 : 1.35, layout.cell * .125), arrow = layout.cell * (isSearch() ? .43 : .29);
    if (hinting) {
      ctx.globalAlpha = alpha * (reduced.matches ? .8 : .5 + .25 * Math.sin(time / 140));
      ctx.strokeStyle = '#adc49c'; ctx.lineWidth = width + Math.max(3, layout.cell * .2);
      trace(pixels); ctx.stroke(); arrowHead(head, direction, arrow);
      ctx.globalAlpha = alpha;
    }
    ctx.strokeStyle = palette[1]; ctx.lineWidth = width;
    trace(pixels);
    ctx.lineTo(head[0] + direction[0] * arrow * .55, head[1] + direction[1] * arrow * .55);
    ctx.stroke(); arrowHead(head, direction, arrow, isSearch());
    if (start !== undefined && reduced.matches && !moving) {
      ctx.strokeStyle = '#a2633d'; ctx.lineWidth = width + 1;
      trace(pixels); ctx.stroke(); arrowHead(head, direction, arrow);
    }
  }
  ctx.restore();
}

function draw(time) {
  raf = 0; expireNudges(nudges, time);
  if (isCube()) return;
  if (!board || !layout) return;
  ctx.clearRect(0, 0, screenSize, screenSize);
  ctx.fillStyle = '#52684919';
  if (!isSearch()) for (let y = 0; y < board.size; y++) for (let x = 0; x < board.size; x++) {
    ctx.beginPath();
    ctx.arc(layout.pad + (x + .5) * layout.cell, layout.pad + (y + .5) * layout.cell, isTutorial() ? 1.1 : Math.max(.6, Math.min(1, layout.cell * .035)), 0, Math.PI * 2);
    ctx.fill();
  }
  board.pieces.forEach(piece => drawPiece(piece, piece.cells, 1, time));
  flights = flights.filter(flight => {
    const t = Math.min(1, (time - flight.start) / flight.duration), ease = 1 - (1 - t) ** 2;
    const travel = (flight.piece.cells.length - 1 + board.size + 2) * ease;
    drawPiece(flight.piece, reduced.matches ? flight.piece.cells : exitPath(flight.piece, travel), reduced.matches ? 1 - t : 1 - t * .25, time, true);
    return t < 1;
  });
  sparks = sparks.filter(spark => {
    const t = (time - spark.start) / 360;
    if (t >= 1) return false;
    ctx.globalAlpha = (1 - t) * .35; ctx.fillStyle = spark.color; ctx.beginPath();
    ctx.arc(spark.x + Math.cos(spark.angle) * t * 18, spark.y + Math.sin(spark.angle) * t * 18, 2 * (1 - t), 0, Math.PI * 2);
    ctx.fill(); ctx.globalAlpha = 1; return true;
  });
  if (flights.length || sparks.length || nudges.size || (hintId && time < hintEnd)) requestDraw();
}

function resize() {
  if (isCube()) { if (board) cubeView.render(board, { hintId }); return; }
  const width = $('board-wrap').getBoundingClientRect().width;
  if (!width || !board) return;
  screenSize = width * zoom;
  surface.style.width = `${screenSize}px`; surface.style.height = `${screenSize}px`;
  const ratio = Math.min(window.devicePixelRatio || 1, zoom > 1 ? 2 : 3);
  canvas.width = Math.round(screenSize * ratio); canvas.height = Math.round(screenSize * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const pad = screenSize * (isTutorial() ? .065 : .045), cell = (screenSize - pad * 2) / board.size;
  layout = { pad, cell, inset: Math.max(3, cell * .105) };
  renderHits(); requestDraw();
}

function pieceAtEvent(event) {
  const rect = surface.getBoundingClientRect();
  return hitPieceAt(board.pieces, { x: (event.clientX - rect.left - layout.pad) / layout.cell, y: (event.clientY - rect.top - layout.pad) / layout.cell });
}

surface.addEventListener('pointerdown', event => {
  if (!event.isPrimary) { gesture = null; return; }
  if (event.button !== 0 || !$('finish').hidden) return;
  gesture = {
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, maxDistance: 0,
    scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, piece: pieceAtEvent(event),
  };
  surface.setPointerCapture(event.pointerId);
});
surface.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gesture = updateGesture(gesture, { x: event.clientX, y: event.clientY });
  if (zoom > 1 && !isTapGesture(gesture)) {
    viewport.scrollLeft = gesture.scrollLeft + gesture.startX - event.clientX;
    viewport.scrollTop = gesture.scrollTop + gesture.startY - event.clientY;
    event.preventDefault();
  }
});
surface.addEventListener('pointerup', event => {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const finished = updateGesture(gesture, { x: event.clientX, y: event.clientY });
  gesture = null;
  if (isTapGesture(finished) && finished.piece && pieceAtEvent(event) === finished.piece) move(finished.piece);
});
surface.addEventListener('pointercancel', () => { gesture = null; });
surface.addEventListener('lostpointercapture', () => { gesture = null; });

$('zoom').addEventListener('click', () => {
  if (isCube()) {
    zoom = zoom === 1 ? 3 : 1; cubeView.setCloseup(zoom > 1); updateZoomControl();
    message(zoom > 1 ? '这一面放近了，轻点线路。拖动可继续转。' : restingCopy());
    return;
  }
  const center = { x: (viewport.scrollLeft + viewport.clientWidth / 2) / screenSize, y: (viewport.scrollTop + viewport.clientHeight / 2) / screenSize };
  zoom = zoom === 1 ? 3 : 1; gesture = null; updateZoomControl(); resize();
  viewport.scrollLeft = center.x * screenSize - viewport.clientWidth / 2;
  viewport.scrollTop = center.y * screenSize - viewport.clientHeight / 2;
  message(zoom > 1 ? '已放大，拖动棋盘看四周。' : restingCopy());
});
$('undo').addEventListener('click', () => {
  if (!history.length) return;
  clearTimeout(finishTimer); clearTimeout(cubeHintTimer); board = history.pop(); $('finish').hidden = true;
  playTimer.resumeAfterUndo(); syncTimer();
  flights = []; sparks = []; hintId = null; nudges.clear();
  message('退一步也很好。'); refresh(); requestDraw();
});
$('restart').addEventListener('click', () => setBoard(level));
$('hint').addEventListener('click', () => {
  const moves = isCube() ? availableCubeMoves(board) : availableMoves(board);
  if (!moves.length) return;
  hintId = moves[0]; hintEnd = performance.now() + 2400;
  clearTimeout(cubeHintTimer);
  if (isCube()) {
    cubeView.focusPiece(hintId); cubeView.render(board, { hintId });
    const currentHint = hintId;
    cubeHintTimer = setTimeout(() => {
      if (isCube() && hintId === currentHint) { hintId = null; cubeView.render(board, { hintId }); }
    }, 2400);
    message('已转到这一面，这一条可以先出去。');
    return;
  }
  const head = [...piecesEl.children].find(button => button.dataset.piece === hintId);
  if (head) keepHeadVisible(head);
  message(isTutorial() ? '这一块，可以先出去。' : '这一条，可以先出去。'); requestDraw();
});
$('next').addEventListener('click', () => setBoard(level === levelCount() ? 1 : level + 1));
$('mode-search').addEventListener('click', () => selectMode('search'));
$('mode-cube').addEventListener('click', () => selectMode('cube'));
$('mode-classic').addEventListener('click', () => selectMode('classic'));
$('cube-prev').addEventListener('click', () => cubeView.turn(-1));
$('cube-next').addEventListener('click', () => cubeView.turn(1));
$('cube-reset').addEventListener('click', () => cubeView.reset());
$('sound').addEventListener('click', () => {
  sound = !sound; $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? '关闭声音' : '开启声音'); if (sound) tone();
});
$('level-open').addEventListener('click', () => {
  const grid = $('level-grid'); grid.replaceChildren();
  $('level-dialog-title').textContent = isCube() ? '选一关，转转看。' : isSearch() ? `${SEARCH_LEVEL_COUNT}关密线，选一关慢慢玩。` : '选一关，慢慢玩。';
  for (let n = 1; n <= levelCount(); n++) {
    const button = document.createElement('button');
    const number = document.createElement('span'), time = document.createElement('small');
    const record = playHistory.times[mode][n];
    number.textContent = String(n).padStart(2, '0');
    time.textContent = record ? `最佳 ${formatDuration(record.bestMs)}` : completed.has(n) ? '已通关' : '';
    button.append(number, time);
    button.className = [n === level ? 'current' : '', completed.has(n) ? 'complete' : ''].join(' ');
    button.setAttribute('aria-label', `第 ${n} 关${completed.has(n) ? '，已完成' : ''}${record ? `，最佳用时 ${formatDuration(record.bestMs)}，上次用时 ${formatDuration(record.latestMs)}` : ''}`);
    if (n === level) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => { $('level-dialog').close(); setBoard(n); }); grid.append(button);
  }
  $('level-dialog').showModal(); syncTimer(); grid.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
});
$('help-open').addEventListener('click', () => showGuide());
$('guide-start').addEventListener('click', () => $('guide-dialog').close());
$('guide-dialog').addEventListener('close', () => {
  guideDemo?.destroy(); guideDemo = null;
  if (!playHistory.guides[mode]) {
    playHistory.guides[mode] = true; savePlayHistory();
  }
  syncTimer();
});
$('level-dialog').addEventListener('close', syncTimer);
document.addEventListener('visibilitychange', syncTimer);
window.addEventListener('pagehide', () => { playTimer.setPaused(true); clearInterval(timerTick); guideDemo?.setSuspended(true); });
window.addEventListener('pageshow', syncTimer);
reduced.addEventListener('change', () => {
  if ($('guide-dialog').open) { mountGuideDemo(); syncTimer(); }
});
$('level-close').addEventListener('click', () => $('level-dialog').close());
$('level-dialog').addEventListener('click', event => {
  if (event.target !== $('level-dialog')) return;
  const rect = $('level-dialog').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('level-dialog').close();
});
setBoard(level); new ResizeObserver(resize).observe($('board-wrap'));
