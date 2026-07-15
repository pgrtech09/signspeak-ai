// ============================================================
// js/learn.js — Practice Mode
// Shows an expected sign, watches the camera, scores the user's
// attempt against the live recognizer output, and tracks progress
// in localStorage (per-device; not synced to Supabase by design,
// since it's session practice data rather than a recognition log).
// ============================================================

import { requireAuth } from './supabase.js';
import { CameraController } from './camera.js';
import { HandRecognizer } from './recognition.js';
import { showToast, setPrefs, getPrefs } from './utils.js';

const PRACTICE_SET = [
  'A', 'B', 'C', '1', '2', '3', 'Hello', 'Yes', 'No', 'I Love You',
];
const PROGRESS_KEY = 'signspeak-practice-progress';

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveProgress(progress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export async function initLearnPage() {
  const session = await requireAuth();
  if (!session) return;

  const videoEl = document.getElementById('learn-video');
  const canvasEl = document.getElementById('learn-canvas');
  const startBtn = document.getElementById('learn-start-btn');
  const nextBtn = document.getElementById('learn-next-btn');
  const expectedEl = document.getElementById('learn-expected-sign');
  const scoreEl = document.getElementById('learn-score');
  const overlayEl = document.getElementById('learn-overlay');
  const progressListEl = document.getElementById('learn-progress-list');

  let progress = loadProgress();
  let currentIndex = 0;
  let camera = null;
  let recognizer = null;
  let holdFrames = 0;
  const HOLD_FRAMES_REQUIRED = 15; // ~ half a second at 30fps of a correct match

  function renderProgress() {
    progressListEl.innerHTML = PRACTICE_SET.map((sign) => {
      const best = progress[sign] || 0;
      return `<li class="badge ${best >= 70 ? 'badge--live' : 'badge--idle'}">${sign}: ${best}%</li>`;
    }).join('');
  }

  function setExpected(index) {
    currentIndex = index;
    expectedEl.textContent = PRACTICE_SET[index];
    scoreEl.textContent = '';
    holdFrames = 0;
  }

  nextBtn.addEventListener('click', () => {
    setExpected((currentIndex + 1) % PRACTICE_SET.length);
  });

  startBtn.addEventListener('click', async () => {
    if (camera?.isRunning()) {
      camera.stop();
      recognizer = null;
      startBtn.textContent = 'Start Practice Camera';
      overlayEl.classList.remove('visually-hidden');
      return;
    }

    overlayEl.textContent = 'Starting camera…';
    camera = camera || new CameraController(videoEl);
    try {
      await camera.start({ quality: getPrefs().cameraQuality });
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    overlayEl.classList.add('visually-hidden');
    startBtn.textContent = 'Stop Practice Camera';

    recognizer = new HandRecognizer();
    await recognizer.init(
      (status) => (overlayEl.textContent = status),
      { maxHands: getPrefs().twoHandMode ? 2 : 1 }
    );

    const ctx = canvasEl.getContext('2d');
    recognizer.onResults = (result) => {
      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      if (!result.detected) {
        scoreEl.textContent = 'Show your hand(s) to the camera';
        holdFrames = 0;
        return;
      }

      result.hands.forEach((hand) => drawLandmarks(ctx, hand.landmarks, canvasEl.width, canvasEl.height));

      const expected = PRACTICE_SET[currentIndex];
      const isMatch = result.label === expected;

      if (isMatch) {
        holdFrames++;
        const liveScore = Math.min(100, Math.round((holdFrames / HOLD_FRAMES_REQUIRED) * result.confidence));
        scoreEl.textContent = `Matching "${expected}"… ${liveScore}%`;

        if (holdFrames >= HOLD_FRAMES_REQUIRED) {
          const finalScore = result.confidence;
          progress[expected] = Math.max(progress[expected] || 0, finalScore);
          saveProgress(progress);
          renderProgress();
          scoreEl.textContent = `Nailed it! Score: ${finalScore}%`;
          holdFrames = 0;
          setTimeout(() => setExpected((currentIndex + 1) % PRACTICE_SET.length), 1200);
        }
      } else {
        holdFrames = 0;
        scoreEl.textContent = `Detected "${result.label}" — try to match "${expected}"`;
      }
    };

    async function loop() {
      if (!camera?.isRunning()) return;
      await recognizer.sendFrame(videoEl);
      requestAnimationFrame(loop);
    }
    loop();
  });

  function drawLandmarks(ctx, landmarks, w, h) {
    ctx.fillStyle = '#5EEAD4';
    ctx.strokeStyle = 'rgba(129,140,248,0.7)';
    ctx.lineWidth = 2;
    const connections = [
      [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
    ];
    connections.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
      ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
      ctx.stroke();
    });
    landmarks.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  renderProgress();
  setExpected(0);
}
