// ============================================================
// js/camera.js
// Wraps getUserMedia: start/stop/switch camera, quality presets.
// Exposes a small class so dashboard.js and learn.js can both use it.
// ============================================================

const QUALITY_PRESETS = {
  '480p': { width: { ideal: 640 }, height: { ideal: 480 } },
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
};

export class CameraController {
  /**
   * @param {HTMLVideoElement} videoEl
   */
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.facingMode = 'user'; // 'user' = front, 'environment' = rear
    this.quality = '720p';
    this.devices = [];
  }

  async listVideoDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'videoinput');
      return this.devices;
    } catch {
      return [];
    }
  }

  /**
   * Starts the camera. Throws with a descriptive message on failure
   * so the caller can show it in the UI.
   */
  async start({ facingMode, quality } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not supported in this browser.');
    }
    this.facingMode = facingMode || this.facingMode;
    this.quality = quality || this.quality;

    this.stop(); // ensure any previous stream is closed first

    const constraints = {
      audio: false,
      video: {
        facingMode: this.facingMode,
        ...QUALITY_PRESETS[this.quality],
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Camera permission was denied. Allow camera access in your browser settings.');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No camera was found on this device.');
      }
      if (err.name === 'NotReadableError') {
        throw new Error('The camera is already in use by another app.');
      }
      throw new Error('Could not start the camera: ' + err.message);
    }

    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    await this.listVideoDevices();
    return this.stream;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
  }

  /** Toggles between front and rear camera (mobile) */
  async switchCamera() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    return this.start({ facingMode: this.facingMode });
  }

  isRunning() {
    return !!this.stream && this.stream.active;
  }

  get videoWidth() {
    return this.videoEl?.videoWidth || 0;
  }
  get videoHeight() {
    return this.videoEl?.videoHeight || 0;
  }
}
