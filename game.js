/**
 * PingPong Online — game.js
 * P2P multiplayer via PeerJS (no server required).
 *
 * Architecture:
 *   HOST  → runs the authoritative game simulation, sends full game state each frame.
 *   GUEST → sends only paddle input (key state) to host; renders the state it receives.
 *
 * Room ID = Host's PeerJS ID (4-digit alphanumeric, shown in lobby).
 */

/* ═══════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════ */
const CANVAS_W   = 800;
const CANVAS_H   = 500;
const PADDLE_W   = 14;
const PADDLE_H   = 90;
const BALL_R     = 9;
const PADDLE_SPD = 6.5;
const BALL_SPD_0 = 5.5;   // initial ball speed
const MAX_SPD    = 16;     // ball speed cap
const WIN_SCORE  = 7;      // first to 7 wins

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let peer     = null;   // PeerJS instance
let conn     = null;   // active DataConnection
let isHost   = false;
let gameRunning = false;
let animFrame   = null;

// Game objects (all coordinates in canvas units)
const state = {
  ball:   { x: CANVAS_W/2, y: CANVAS_H/2, vx: 0, vy: 0 },
  left:   { y: CANVAS_H/2 - PADDLE_H/2, score: 0 },   // host paddle
  right:  { y: CANVAS_H/2 - PADDLE_H/2, score: 0 },   // guest paddle
  round:  1,
};

// Pressed keys (host tracks both sides; guest only tracks own)
const keys = { up: false, down: false };

/* ═══════════════════════════════════════
   CANVAS SETUP
═══════════════════════════════════════ */
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  const wrapper = document.querySelector('.canvas-wrapper');
  const maxW = Math.min(wrapper.clientWidth  - 32, CANVAS_W);
  const maxH = Math.min(wrapper.clientHeight - 16, CANVAS_H);
  const scale = Math.min(maxW / CANVAS_W, maxH / CANVAS_H);
  canvas.style.width  = (CANVAS_W * scale) + 'px';
  canvas.style.height = (CANVAS_H * scale) + 'px';
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
}

/* ═══════════════════════════════════════
   LOBBY HELPERS
═══════════════════════════════════════ */
function switchTab(tab) {
  document.getElementById('tab-host').classList.toggle('active', tab === 'host');
  document.getElementById('tab-join').classList.toggle('active', tab === 'join');
  document.getElementById('panel-host').classList.toggle('active', tab === 'host');
  document.getElementById('panel-join').classList.toggle('active', tab === 'join');
}

function setHostStatus(msg, cls = '') {
  const el = document.getElementById('host-status');
  el.textContent = msg;
  el.className = 'status-line ' + cls;
}

function setJoinStatus(msg, cls = '') {
  const el = document.getElementById('join-status');
  el.textContent = msg;
  el.className = 'status-line ' + cls;
}

function copyRoomId() {
  const id = document.getElementById('my-room-id').textContent;
  if (!id || id === 'Generating...') return;
  navigator.clipboard.writeText(id).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    }, 2000);
  });
}

/* ═══════════════════════════════════════
   PEER SETUP — HOST
═══════════════════════════════════════ */
function initHost() {
  // Generate a short room ID
  const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
  peer = new Peer(roomId, { debug: 0 });

  peer.on('open', (id) => {
    document.getElementById('my-room-id').textContent = id;
    setHostStatus('🔵 Waiting for your friend to join...');
  });

  peer.on('connection', (c) => {
    if (conn) { c.close(); return; } // only one guest
    conn = c;
    setupConnection(true);
  });

  peer.on('error', (err) => {
    console.error(err);
    setHostStatus('❌ ' + err.type, 'error');
  });
}

/* ═══════════════════════════════════════
   PEER SETUP — GUEST
═══════════════════════════════════════ */
function joinGame() {
  const roomId = document.getElementById('join-room-input').value.trim().toUpperCase();
  if (!roomId) { setJoinStatus('⚠ Enter a Room ID first', 'error'); return; }

  document.getElementById('join-btn').disabled = true;
  setJoinStatus('🔵 Connecting...');

  peer = new Peer(undefined, { debug: 0 });

  peer.on('open', () => {
    conn = peer.connect(roomId, { reliable: false, serialization: 'json' });
    setupConnection(false);
  });

  peer.on('error', (err) => {
    console.error(err);
    setJoinStatus('❌ ' + err.type + ' — check the Room ID', 'error');
    document.getElementById('join-btn').disabled = false;
  });
}

/* ═══════════════════════════════════════
   CONNECTION WIRING (shared)
═══════════════════════════════════════ */
function setupConnection(hosting) {
  isHost = hosting;

  conn.on('open', () => {
    if (hosting) {
      setHostStatus('✅ Friend connected! Starting...', 'ok');
    } else {
      setJoinStatus('✅ Connected! Waiting for host...', 'ok');
    }
    setTimeout(startGame, 800);
  });

  conn.on('data', (data) => {
    if (isHost) {
      // Receive guest's key state
      if (data.type === 'keys') {
        state.right.vy = data.vy; // pre-computed velocity from guest
      }
    } else {
      // Receive authoritative game state from host
      if (data.type === 'state') applyHostState(data);
      if (data.type === 'score') handleScoreEvent(data);
      if (data.type === 'gameover') handleGameOver(data);
    }
  });

  conn.on('close', () => handleDisconnect());
  conn.on('error', () => handleDisconnect());
}

/* ═══════════════════════════════════════
   GAME INIT
═══════════════════════════════════════ */
function startGame() {
  showScreen('game-screen');
  resizeCanvas();
  resetBall();
  gameRunning = true;

  document.getElementById('label-left').textContent  = isHost ? 'YOU' : 'FRIEND';
  document.getElementById('label-right').textContent = isHost ? 'FRIEND' : 'YOU';

  setConnStatus(true);
  showOverlay('GET READY', '3…');
  setTimeout(() => { showOverlay('GET READY', '2…'); }, 1000);
  setTimeout(() => { showOverlay('GET READY', '1…'); }, 2000);
  setTimeout(() => {
    hideOverlay();
    loop();
  }, 3000);
}

function resetBall(scoredLeft = null) {
  state.ball.x = CANVAS_W / 2;
  state.ball.y = CANVAS_H / 2;
  const angle = (Math.random() * 60 - 30) * (Math.PI / 180);
  // If someone just scored, serve toward the one who lost
  let dir = (scoredLeft === null) ? (Math.random() < 0.5 ? 1 : -1)
                                  : (scoredLeft ? 1 : -1);
  state.ball.vx = BALL_SPD_0 * dir * Math.cos(angle);
  state.ball.vy = BALL_SPD_0 * Math.sin(angle);
}

/* ═══════════════════════════════════════
   MAIN LOOP (HOST only runs physics)
═══════════════════════════════════════ */
function loop() {
  if (!gameRunning) return;
  animFrame = requestAnimationFrame(loop);

  if (isHost) {
    updatePhysics();
    sendState();
  }
  render();
}

/* ═══════════════════════════════════════
   PHYSICS (HOST)
═══════════════════════════════════════ */
function updatePhysics() {
  const b = state.ball;
  const L = state.left;
  const R = state.right;

  // Move host (left) paddle from keys
  if (keys.up)   L.y = Math.max(0, L.y - PADDLE_SPD);
  if (keys.down) L.y = Math.min(CANVAS_H - PADDLE_H, L.y + PADDLE_SPD);

  // Move right paddle from guest input (vy already set by incoming data)
  if (state.right.vy !== undefined) {
    R.y = Math.max(0, Math.min(CANVAS_H - PADDLE_H, R.y + state.right.vy));
  }

  // Move ball
  b.x += b.vx;
  b.y += b.vy;

  // Top / bottom walls
  if (b.y - BALL_R < 0)            { b.y = BALL_R;            b.vy = Math.abs(b.vy); }
  if (b.y + BALL_R > CANVAS_H)     { b.y = CANVAS_H - BALL_R; b.vy = -Math.abs(b.vy); }

  // Left paddle collision
  if (b.vx < 0 && b.x - BALL_R < PADDLE_W + 20 && b.x - BALL_R > 10) {
    if (b.y > L.y - BALL_R && b.y < L.y + PADDLE_H + BALL_R) {
      bouncePaddle(b, L, true);
    }
  }

  // Right paddle collision
  if (b.vx > 0 && b.x + BALL_R > CANVAS_W - PADDLE_W - 20 && b.x + BALL_R < CANVAS_W - 10) {
    if (b.y > R.y - BALL_R && b.y < R.y + PADDLE_H + BALL_R) {
      bouncePaddle(b, R, false);
    }
  }

  // Scoring
  if (b.x + BALL_R < 0) {
    R.score++;
    sendScore();
    checkWin();
    if (gameRunning) { showOverlay('Point!', 'Friend scores 🎉'); resetBall(false); setTimeout(hideOverlay, 1200); }
  }
  if (b.x - BALL_R > CANVAS_W) {
    L.score++;
    sendScore();
    checkWin();
    if (gameRunning) { showOverlay('Point!', 'You score 🎉'); resetBall(true); setTimeout(hideOverlay, 1200); }
  }

  updateScoreUI();
}

function bouncePaddle(b, paddle, isLeft) {
  // Relative hit position (-1 top … +1 bottom)
  const rel = ((b.y - paddle.y) / PADDLE_H) * 2 - 1;
  const maxAngle = 65 * (Math.PI / 180);
  const angle    = rel * maxAngle;
  const spd      = Math.min(Math.hypot(b.vx, b.vy) * 1.055, MAX_SPD);

  b.vx = (isLeft ? 1 : -1) * spd * Math.cos(angle);
  b.vy = spd * Math.sin(angle);

  // Push ball out of paddle zone
  b.x = isLeft ? PADDLE_W + 21 + BALL_R : CANVAS_W - PADDLE_W - 21 - BALL_R;
}

function checkWin() {
  const L = state.left;
  const R = state.right;
  if (L.score >= WIN_SCORE || R.score >= WIN_SCORE) {
    const hostWon = L.score >= WIN_SCORE;
    gameRunning = false;
    sendGameOver(hostWon);
    const youWon = isHost ? hostWon : !hostWon;
    showOverlay(youWon ? '🏆 You Win!' : '😔 You Lose', `Final: ${L.score} – ${R.score}`);
  }
}

/* ═══════════════════════════════════════
   NETWORK MESSAGES
═══════════════════════════════════════ */
function sendState() {
  if (!conn || !conn.open) return;
  conn.send({
    type: 'state',
    bx: state.ball.x,  by: state.ball.y,
    bvx: state.ball.vx, bvy: state.ball.vy,
    ly: state.left.y,
    ry: state.right.y,
  });
}

function sendScore() {
  if (!conn || !conn.open) return;
  conn.send({ type: 'score', ls: state.left.score, rs: state.right.score, round: state.round });
}

function sendGameOver(hostWon) {
  if (!conn || !conn.open) return;
  conn.send({ type: 'gameover', hostWon, ls: state.left.score, rs: state.right.score });
}

function applyHostState(d) {
  state.ball.x   = d.bx;  state.ball.y   = d.by;
  state.ball.vx  = d.bvx; state.ball.vy  = d.bvy;
  state.left.y   = d.ly;
  state.right.y  = d.ry;
}

function handleScoreEvent(d) {
  state.left.score  = d.ls;
  state.right.score = d.rs;
  state.round       = d.round;
  updateScoreUI();
}

function handleGameOver(d) {
  gameRunning = false;
  const youWon = !d.hostWon; // guest perspective
  showOverlay(youWon ? '🏆 You Win!' : '😔 You Lose', `Final: ${d.ls} – ${d.rs}`);
}

/* ═══════════════════════════════════════
   INPUT
═══════════════════════════════════════ */
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') keys.up   = true;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = true;
  if (['ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
  if (!isHost) sendGuestInput();
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') keys.up   = false;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
  if (!isHost) sendGuestInput();
});

function sendGuestInput() {
  if (!conn || !conn.open) return;
  let vy = 0;
  if (keys.up)   vy -= PADDLE_SPD;
  if (keys.down) vy += PADDLE_SPD;
  conn.send({ type: 'keys', vy });
}

/* ═══════════════════════════════════════
   RENDER
═══════════════════════════════════════ */
function render() {
  const b = state.ball;
  const L = state.left;
  const R = state.right;

  // Background
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Center dashed line
  ctx.save();
  ctx.setLineDash([12, 14]);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2, 0);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H);
  ctx.stroke();
  ctx.restore();

  // Left paddle (host = YOU)
  drawPaddle(20, L.y, isHost ? '#7c6bff' : '#ff6b9d');

  // Right paddle (guest = opponent)
  drawPaddle(CANVAS_W - PADDLE_W - 20, R.y, isHost ? '#ff6b9d' : '#7c6bff');

  // Ball glow
  const grad = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, BALL_R * 2.8);
  grad.addColorStop(0, 'rgba(200,200,255,0.55)');
  grad.addColorStop(1, 'rgba(124,107,255,0)');
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R * 2.8, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Ball
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#a99fff';
  ctx.shadowBlur  = 18;
  ctx.fill();
  ctx.shadowBlur  = 0;
}

function drawPaddle(x, y, color) {
  const radius = PADDLE_W / 2;

  // Glow behind paddle
  ctx.shadowColor = color;
  ctx.shadowBlur  = 22;

  ctx.beginPath();
  ctx.roundRect(x, y, PADDLE_W, PADDLE_H, radius);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.shadowBlur = 0;
}

/* ═══════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'game-screen') resizeCanvas();
}

function showOverlay(msg, sub = '') {
  document.getElementById('overlay-msg').textContent = msg;
  document.getElementById('overlay-sub').textContent = sub;
  document.getElementById('overlay').classList.remove('hidden');
}

function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
}

function updateScoreUI() {
  // From each player's perspective: left = YOU, right = FRIEND
  const myScore   = isHost ? state.left.score  : state.right.score;
  const oppScore  = isHost ? state.right.score : state.left.score;

  const elL = document.getElementById('score-left');
  const elR = document.getElementById('score-right');

  const prevL = parseInt(elL.textContent) || 0;
  const prevR = parseInt(elR.textContent) || 0;

  elL.textContent = myScore;
  elR.textContent = oppScore;

  if (myScore  !== prevL) animatePop(elL);
  if (oppScore !== prevR) animatePop(elR);

  document.getElementById('round-badge').textContent = 'ROUND ' + state.round;
}

function animatePop(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // reflow
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 200);
}

function setConnStatus(connected) {
  const el = document.getElementById('conn-status');
  el.textContent = connected ? '● Connected' : '● Disconnected';
  el.className = 'conn-dot ' + (connected ? 'connected' : 'disconnected');
}

function handleDisconnect() {
  gameRunning = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  setConnStatus(false);
  showOverlay('Disconnected', 'Your friend left the game');
}

function leaveGame() {
  gameRunning = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (conn)  { conn.close();  conn  = null; }
  if (peer)  { peer.destroy(); peer = null; }

  // Reset state
  state.left.score  = 0;
  state.right.score = 0;
  state.round = 1;

  document.getElementById('join-btn').disabled = false;
  setJoinStatus('');
  showScreen('lobby');

  // Re-init host peer so the Room ID refreshes
  setTimeout(initHost, 300);
}

/* ═══════════════════════════════════════
   STARTUP
═══════════════════════════════════════ */
window.addEventListener('resize', () => {
  if (document.getElementById('game-screen').classList.contains('active')) resizeCanvas();
});

// Bootstrap the host peer immediately so Room ID is ready
initHost();
