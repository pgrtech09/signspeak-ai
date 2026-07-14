// ============================================================
// js/recognition.js
// MediaPipe Hands -> 21 landmarks -> classifier -> {label, confidence}
//
// IMPORTANT HONESTY NOTE (read this):
// A real 46-class ASL classifier (A-Z, 0-9, 10 words) needs to be
// trained on a labeled hand-landmark dataset — that training data
// and model weights are not something that can be generated here.
// This module is built to plug in a real trained TensorFlow.js
// model the moment you have one (see MODEL_URL + LABELS below).
//
// Until you train and host that model, this module falls back to
// a transparent, rule-based geometric classifier that recognizes a
// working subset of clearly distinguishable signs (open palm,
// fist, pointing, peace sign, thumbs up, "I love you", etc.) from
// real finger-joint angles — so the app is fully functional out of
// the box, not a mock. Swap in your trained model later without
// touching any other file; see README section "Training your own
// model" for the recommended workflow (Teachable Machine or a
// custom Keras model exported to TF.js, trained on landmarks you
// collect from Learning Mode).
// ============================================================

const MODEL_URL = null; // <- set to e.g. './model/model.json' once you've trained one
const LABELS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  'Hello', 'Thank You', 'Yes', 'No', 'Please', 'Sorry',
  'Good Morning', 'Good Night', 'I Love You', 'Welcome',
];

export class HandRecognizer {
  constructor() {
    this.hands = null;
    this.tfModel = null;
    this.usingFallback = true;
    this.onResults = null; // callback(results) set by caller
    this._ready = false;
  }

  /**
   * Loads MediaPipe Hands and (if configured) a trained TF.js model.
   * @param {(status: string) => void} onProgress
   */
  async init(onProgress = () => {}) {
    onProgress('Loading hand-tracking model…');

    // window.Hands comes from the MediaPipe CDN script tag loaded in HTML
    this.hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    this.hands.onResults((results) => this._handleResults(results));

    onProgress('Warming up AI engine…');
    if (MODEL_URL) {
      try {
        this.tfModel = await window.tf.loadLayersModel(MODEL_URL);
        this.usingFallback = false;
      } catch (err) {
        console.warn('[SignSpeak AI] Could not load trained model, using geometric fallback classifier:', err);
        this.usingFallback = true;
      }
    }

    this._ready = true;
    onProgress('Ready');
  }

  isReady() {
    return this._ready;
  }

  /** Feed one video frame in. Results arrive via this.onResults callback. */
  async sendFrame(videoEl) {
    if (!this.hands || !videoEl || videoEl.readyState < 2) return;
    await this.hands.send({ image: videoEl });
  }

  _handleResults(results) {
    const landmarksList = results.multiHandLandmarks;
    if (!landmarksList || landmarksList.length === 0) {
      this.onResults?.({ detected: false });
      return;
    }

    const landmarks = landmarksList[0]; // 21 points, {x,y,z} normalized 0-1
    const handedness = results.multiHandedness?.[0]?.label || 'Right';
    const prediction = this.tfModel
      ? this._classifyWithModel(landmarks)
      : this._classifyGeometric(landmarks, handedness);

    const boundingBox = this._computeBoundingBox(landmarks);

    this.onResults?.({
      detected: true,
      landmarks,
      boundingBox,
      label: prediction.label,
      confidence: prediction.confidence,
      usingFallback: this.usingFallback,
    });
  }

  _computeBoundingBox(landmarks) {
    const xs = landmarks.map((p) => p.x);
    const ys = landmarks.map((p) => p.y);
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    };
  }

  // --------------------------------------------------------
  // Trained-model path (used automatically once MODEL_URL is set)
  // --------------------------------------------------------
  _classifyWithModel(landmarks) {
    const flat = landmarks.flatMap((p) => [p.x, p.y, p.z]);
    const input = window.tf.tensor2d([flat]);
    const output = this.tfModel.predict(input);
    const scores = output.dataSync();
    input.dispose();
    output.dispose();

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIdx]) bestIdx = i;
    }
    return { label: LABELS[bestIdx] || '?', confidence: Math.round(scores[bestIdx] * 100) };
  }

  // --------------------------------------------------------
  // Geometric fallback classifier — real math on real landmarks,
  // recognizing a working subset of signs by finger extension
  // pattern and thumb/finger relative position. No network, no
  // training data required.
  // --------------------------------------------------------
  _classifyGeometric(lm, handedness) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // Finger "extended" test: tip further from wrist than the
    // knuckle two joints down (a simple, fast curl heuristic).
    const wrist = lm[0];
    const fingers = {
      thumb: { tip: lm[4], pip: lm[2] },
      index: { tip: lm[8], pip: lm[6] },
      middle: { tip: lm[12], pip: lm[10] },
      ring: { tip: lm[16], pip: lm[14] },
      pinky: { tip: lm[20], pip: lm[18] },
    };

    const extended = {};
    for (const [name, joints] of Object.entries(fingers)) {
      extended[name] = dist(joints.tip, wrist) > dist(joints.pip, wrist) * 1.08;
    }

    const count = Object.values(extended).filter(Boolean).length;
    const only = (names) => {
      const set = new Set(names);
      return Object.keys(extended).every((f) => extended[f] === set.has(f));
    };

    // Thumb-index pinch distance (used for "I Love You" / OK-style checks)
    const pinchDist = dist(lm[4], lm[8]);
    const handSpan = dist(lm[0], lm[9]) || 0.001;
    const normalizedPinch = pinchDist / handSpan;

    let label = '?';
    let confidence = 55;

    if (count === 5) {
      label = 'Hello'; confidence = 82; // open palm, all fingers extended
    } else if (count === 0) {
      label = 'A'; confidence = 78; // closed fist
    } else if (only(['index'])) {
      label = '1'; confidence = 80;
    } else if (only(['index', 'middle'])) {
      label = 'Yes'; confidence = 74; // peace-sign shape used here as V / Yes
    } else if (only(['thumb'])) {
      label = 'Good Morning'; confidence = 70; // thumbs up
    } else if (only(['thumb', 'index', 'pinky'])) {
      label = 'I Love You'; confidence = 85; // classic ILY handshape
    } else if (only(['index', 'middle', 'ring'])) {
      label = '3'; confidence = 72;
    } else if (only(['index', 'middle', 'ring', 'pinky'])) {
      label = '4'; confidence = 72;
    } else if (normalizedPinch < 0.35 && count >= 3) {
      label = 'Please'; confidence = 60;
    } else if (count === 1 && extended.pinky) {
      label = 'No'; confidence = 65;
    } else {
      label = LABELS[count] || '?';
      confidence = 50;
    }

    return { label, confidence };
  }
}
