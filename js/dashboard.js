// ============================================================
// js/dashboard.js — wires dashboard.html together
// ============================================================

import { requireAuth, getProfile } from './supabase.js';
import { CameraController } from './camera.js';
import { HandRecognizer } from './recognition.js';
import { speechController } from './speech.js';
import { logRecognition, fetchRecentHistory, computeStats, flushPendingHistory } from './history.js';
import { getPrefs, showToast, formatDateTime, watchConnectivity } from './utils.js';

export async function initDashboard() {
  const session = await requireAuth();
  if (!session) return;
  const userId = session.user.id;

  // ---------- profile header ----------
  const profile = await getProfile(userId);
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = profile?.full_name || 'there';

  // ---------- elements ----------
  const videoEl = document.getElementById('dashboard-video');
  const canvasEl = document.getElementById('dashboard-canvas');
  const overlayEl = document.getElementById('camera-overlay');
  const startBtn = document.getElementById('start-camera-btn');
  const switchBtn = document.getElementById('switch-camera-btn');
  const aiStatusBadge = document.getElementById('ai-status-badge');
  const recognitionBadge = document.getElementById('recognition-badge');
  const resultWord = document.getElementById('result-word');
  const resultConfidence = document.getElementById('result-confidence');
  const muteBtn = document.getElementById('mute-btn');
  const historyListEl = document.getElementById('recent-history-list');
  const statTotalEl = document.getElementById('stat-total');
  const statTodayEl = document.getElementById('stat-today');
  const statConfidenceEl = document.getElementById('stat-confidence');
  const statStreakEl = document.getElementById('stat-streak');
  const connectivityBadge = document.getElementById('connectivity-badge');

  const camera = new CameraController(videoEl);
  const recognizer = new HandRecognizer();
  let loopActive = false;
  let lastLoggedLabel = null;
  let lastLoggedAt = 0;

  // ---------- connectivity ----------
  watchConnectivity((isOnline) => {
    if (!connectivityBadge) return;
    connectivityBadge.textContent = isOnline ? 'Online' : 'Offline';
    connectivityBadge.className = `badge ${isOnline ? 'badge--live' : 'badge--warn'}`;
    if (isOnline) flushPendingHistory();
  });

  // ---------- mute button ----------
  function syncMuteButton() {
    const prefs = getPrefs();
    muteBtn.textContent = prefs.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', prefs.muted ? 'Unmute speech' : 'Mute speech');
  }
  muteBtn?.addEventListener('click', () => {
    const prefs = getPrefs();
    speechController.setMuted(!prefs.muted);
    syncMuteButton();
  });
  syncMuteButton();

  // ---------- stats + recent history ----------
  async function refreshHistoryPanel() {
    const rows = await fetchRecentHistory(userId, 200);
    const recent = rows.slice(0, 6);
    const stats = computeStats(rows);

    statTotalEl.textContent = stats.total;
    statTodayEl.textContent = stats.today;
    statConfidenceEl.textContent = `${stats.avgConfidence}%`;
    statStreakEl.textContent = stats.today > 0 ? '🔥' : '—';

    historyListEl.innerHTML = recent.length
      ? recent
          .map((row) => {
            const { date, time } = formatDateTime(row.created_at);
            return `<li class="card card--tight" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong>${row.recognized_text}</strong>
                <div class="field-hint">${date} · ${time}</div>
              </div>
              <span class="badge badge--idle">${row.confidence}%</span>
            </li>`;
          })
          .join('')
      : `<li class="empty-state">No recognitions yet — start the camera to begin.</li>`;
  }
  await refreshHistoryPanel();

  // ---------- start/stop camera ----------
  startBtn.addEventListener('click', async () => {
    if (camera.isRunning()) {
      stopEverything();
      return;
    }

    overlayEl.classList.remove('visually-hidden');
    overlayEl.querySelector('.overlay-text').textContent = 'Starting camera…';
    startBtn.disabled = true;

    try {
      await camera.start({ quality: getPrefs().cameraQuality });
    } catch (err) {
      showToast(err.message, 'error');
      overlayEl.querySelector('.overlay-text').textContent = err.message;
      startBtn.disabled = false;
      return;
    }

    startBtn.disabled = false;
    startBtn.textContent = 'Stop Camera';
    aiStatusBadge.textContent = 'Loading AI…';
    aiStatusBadge.className = 'badge badge--warn';

    if (!recognizer.isReady()) {
      await recognizer.init(
        (status) => { overlayEl.querySelector('.overlay-text').textContent = status; },
        { maxHands: getPrefs().twoHandMode ? 2 : 1 }
      );
    }
    overlayEl.classList.add('visually-hidden');
    aiStatusBadge.textContent = recognizer.usingFallback ? 'AI Ready (demo model)' : 'AI Ready';
    aiStatusBadge.className = 'badge badge--live';

    recognizer.onResults = handleResults;
    loopActive = true;
    runLoop();
  });

  switchBtn?.addEventListener('click', async () => {
    if (!camera.isRunning()) return;
    try {
      await camera.switchCamera();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  function stopEverything() {
    loopActive = false;
    camera.stop();
    startBtn.textContent = 'Start Camera';
    aiStatusBadge.textContent = 'Idle';
    aiStatusBadge.className = 'badge badge--idle';
    recognitionBadge.textContent = 'No hand detected';
    recognitionBadge.className = 'badge badge--idle';
    resultWord.textContent = '—';
    resultConfidence.textContent = '';
    overlayEl.classList.remove('visually-hidden');
    overlayEl.querySelector('.overlay-text').textContent = 'Camera is off';
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }

  const sensitivityThreshold = () => Math.round(getPrefs().sensitivity * 100);

  async function handleResults(result) {
    canvasEl.width = camera.videoWidth;
    canvasEl.height = camera.videoHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (!result.detected) {
      recognitionBadge.textContent = 'No hand detected';
      recognitionBadge.className = 'badge badge--idle';
      return;
    }

    drawOverlay(ctx, result, canvasEl.width, canvasEl.height);

    recognitionBadge.textContent = result.hands.length === 2 ? 'Two hands detected' : 'Hand detected';
    recognitionBadge.className = 'badge badge--live';

    if (result.confidence < sensitivityThreshold()) return; // below user's sensitivity setting

    resultWord.textContent = result.label;
    resultConfidence.textContent = result.twoHandMatch
      ? `${result.confidence}% confidence · two-hand gesture`
      : `${result.confidence}% confidence`;

    speechController.speak(result.label);

    // Log to Supabase, debounced: only log a new entry when the
    // label changes, or 3s have passed on a sustained same sign.
    const now = Date.now();
    if (result.label !== lastLoggedLabel || now - lastLoggedAt > 3000) {
      lastLoggedLabel = result.label;
      lastLoggedAt = now;
      const category = /^[A-Z]$/.test(result.label) ? 'alphabet' : /^[0-9]$/.test(result.label) ? 'number' : 'word';
      const { queued } = await logRecognition({ userId, text: result.label, confidence: result.confidence, category });
      if (!queued) refreshHistoryPanel();
    }
  }

  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
  ];
  const HAND_COLORS = [
    { box: '#5EEAD4', line: 'rgba(94,234,212,0.6)', dot: '#818CF8' },  // hand 1
    { box: '#FBBF24', line: 'rgba(251,191,36,0.6)', dot: '#F87171' },  // hand 2
  ];

  function drawOverlay(ctx, result, w, h) {
    result.hands.forEach((hand, i) => {
      const colors = HAND_COLORS[i] || HAND_COLORS[0];
      const { xMin, xMax, yMin, yMax } = hand.boundingBox;

      ctx.strokeStyle = colors.box;
      ctx.lineWidth = 2;
      ctx.strokeRect(xMin * w, yMin * h, (xMax - xMin) * w, (yMax - yMin) * h);

      // per-hand mini label above its box
      ctx.fillStyle = colors.box;
      ctx.font = '600 13px sans-serif';
      ctx.fillText(`${hand.handedness}: ${hand.label} (${hand.confidence}%)`, xMin * w, Math.max(14, yMin * h - 6));

      ctx.fillStyle = colors.dot;
      ctx.strokeStyle = colors.line;
      CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(hand.landmarks[a].x * w, hand.landmarks[a].y * h);
        ctx.lineTo(hand.landmarks[b].x * w, hand.landmarks[b].y * h);
        ctx.stroke();
      });
      hand.landmarks.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  async function runLoop() {
    if (!loopActive) return;
    await recognizer.sendFrame(videoEl);
    requestAnimationFrame(runLoop);
  }

  // Flush any recognition rows queued while offline
  flushPendingHistory();
}
