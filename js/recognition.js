// ============================================================
// js/recognition.js
// MediaPipe Hands -> up to 2 hands x 21 landmarks -> classifier
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
// working subset of clearly distinguishable signs from real
// finger-joint angles — so the app is fully functional out of the
// box, not a mock. Swap in your trained model later without
// touching any other file.
//
// TWO-HAND SUPPORT: MediaPipe Hands tracks up to 2 hands natively.
// Each hand is classified individually (so e.g. one hand can show
// "1" while the other shows "Hello" at the same time), and a small
// set of *combined* two-hand shapes is also checked (both palms
// open facing the camera, hands clasped together, etc.) so you can
// build genuinely two-handed signs on top of this. Note: most of
// the 10 demo words in this project are one-handed in real ASL —
// the combined-shape entries below are clearly-labeled demo
// mappings, not claims about official two-handed ASL grammar.
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
    this.maxHands = 2;
  }

  /**
   * Loads MediaPipe Hands and (if configured) a trained TF.js model.
   * @param {(status: string) => void} onProgress
   * @param {{maxHands?: number}} options
   */
  async init(onProgress = () => {}, options = {}) {
    this.maxHands = options.maxHands ?? 2;
    onProgress('Loading hand-tracking model…');

    // window.Hands comes from the MediaPipe CDN script tag loaded in HTML
    this.hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: this.maxHands,
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
      this.onResults?.({ detected: false, hands: [] });
      return;
    }

    // Classify every detected hand (1 or 2) independently.
    const hands = landmarksList.map((landmarks, i) => {
      const handedness = results.multiHandedness?.[i]?.label || 'Right';
      const prediction = this.tfModel
        ? this._classifyWithModel(landmarks)
        : this._classifyGeometric(landmarks, handedness);
      return {
        landmarks,
        handedness,
        boundingBox: this._computeBoundingBox(landmarks),
        label: prediction.label,
        confidence: prediction.confidence,
      };
    });

    // If both hands are present, also check for a combined
    // two-hand shape — this can override the single-hand guess
    // when it matches, since two-hand shapes are more specific.
    let combined = null;
    if (hands.length === 2 && !this.tfModel) {
      combined = this._classifyTwoHands(hands[0], hands[1]);
    }

    // "Primary" result = combined match if found, else the
    // higher-confidence of the individual hands (kept for
    // backward-compatible single-label UI elements).
    const best = combined || hands.reduce((a, b) => (b.confidence > a.confidence ? b : a));

    this.onResults?.({
      detected: true,
      hands,
      twoHandMatch: !!combined,
      label: best.label,
      confidence: best.confidence,
      // legacy single-hand fields, mapped from the best-scoring hand
      landmarks: hands[0].landmarks,
      boundingBox: hands[0].boundingBox,
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
    const { extended, count } = this._fingerExtension(lm);
    const only = (names) => {
      const set = new Set(names);
      return Object.keys(extended).every((f) => extended[f] === set.has(f));
    };

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
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

  /** Shared finger-extension helper, reused by single- and two-hand classifiers. */
  _fingerExtension(lm) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
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
    return { extended, count };
  }

  // --------------------------------------------------------
  // Two-hand geometric classifier — checks the RELATIONSHIP
  // between both hands (distance apart, relative shape, whether
  // they're touching) in addition to each hand's own shape.
  // These are demo mappings to make two-hand gestures usable,
  // not a claim about official ASL two-hand grammar.
  // --------------------------------------------------------
  _classifyTwoHands(handA, handB) {
    const centerA = handA.landmarks[9]; // middle-finger knuckle ~= palm center
    const centerB = handB.landmarks[9];
    const handSpanA = Math.hypot(
      handA.landmarks[0].x - handA.landmarks[9].x,
      handA.landmarks[0].y - handA.landmarks[9].y
    ) || 0.001;

    const handsDist = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y) / handSpanA;
    const { count: countA } = this._fingerExtension(handA.landmarks);
    const { count: countB } = this._fingerExtension(handB.landmarks);

    // Both palms wide open, hands apart -> "Welcome" (demo: open, welcoming gesture)
    if (countA === 5 && countB === 5 && handsDist > 1.4) {
      return { label: 'Welcome', confidence: 84 };
    }

    // Both palms open and close together / touching -> "Thank You" (demo mapping)
    if (countA === 5 && countB === 5 && handsDist <= 1.4) {
      return { label: 'Thank You', confidence: 80 };
    }

    // Both closed fists, hands close together -> "Sorry" (demo: circular fist-on-chest motion, static approximation)
    if (countA === 0 && countB === 0 && handsDist <= 1.6) {
      return { label: 'Sorry', confidence: 72 };
    }

    // Both hands showing "I Love You" handshape simultaneously -> reinforced "I Love You"
    if (this._isIlyShape(handA.landmarks) && this._isIlyShape(handB.landmarks)) {
      return { label: 'I Love You', confidence: 90 };
    }

    // Both hands showing digit shapes -> read as a two-digit number, e.g. "1" + "0" = "10"
    if (countA >= 0 && countB >= 0 && countA <= 5 && countB <= 5) {
      const digitA = this._fingerCountToDigit(countA);
      const digitB = this._fingerCountToDigit(countB);
      if (digitA !== null && digitB !== null && handsDist > 1.2) {
        return { label: `${digitA}${digitB}`, confidence: 68 };
      }
    }

    return null; // no combined match — caller falls back to best single-hand guess
  }

  _isIlyShape(lm) {
    const { extended } = this._fingerExtension(lm);
    return extended.thumb && extended.index && extended.pinky && !extended.middle && !extended.ring;
  }

  _fingerCountToDigit(count) {
    // Only 0-5 are representable with one hand's finger count;
    // treat count 0 as "0" here since a fist commonly reads as A/0 in ASL contexts.
    if (count >= 0 && count <= 5) return String(count);
    return null;
  }
}
