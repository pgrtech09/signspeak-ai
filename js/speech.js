// ============================================================
// js/speech.js
// Thin wrapper around the browser SpeechSynthesis API.
// ============================================================

import { getPrefs, setPrefs } from './utils.js';

class SpeechController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this._lastSpokenText = null;
    this._lastSpokenAt = 0;

    if (this.synth) {
      // Voice list loads async in most browsers
      this.synth.addEventListener?.('voiceschanged', () => {
        this.voices = this.synth.getVoices();
      });
      this.voices = this.synth.getVoices();
    }
  }

  isSupported() {
    return !!this.synth;
  }

  getVoices() {
    return this.voices?.length ? this.voices : this.synth?.getVoices() || [];
  }

  getEnglishVoices() {
    return this.getVoices().filter((v) => v.lang.startsWith('en'));
  }

  /**
   * Speaks text using saved preferences (voice, rate, muted).
   * De-duplicates identical text spoken within 1.5s (avoids
   * spamming speech on every single video frame's prediction).
   */
  speak(text, { force = false } = {}) {
    if (!this.isSupported() || !text) return;
    const prefs = getPrefs();
    if (prefs.muted && !force) return;

    const now = Date.now();
    if (!force && text === this._lastSpokenText && now - this._lastSpokenAt < 1500) return;
    this._lastSpokenText = text;
    this._lastSpokenAt = now;

    this.synth.cancel(); // interrupt any in-flight utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = prefs.speechRate || 1;
    utterance.pitch = 1;

    const chosenVoice = this.getVoices().find((v) => v.voiceURI === prefs.voiceURI);
    if (chosenVoice) utterance.voice = chosenVoice;

    this.synth.speak(utterance);
  }

  stop() {
    this.synth?.cancel();
  }

  setMuted(muted) {
    setPrefs({ muted });
    if (muted) this.stop();
  }

  setRate(rate) {
    setPrefs({ speechRate: Number(rate) });
  }

  setVoice(voiceURI) {
    setPrefs({ voiceURI });
  }
}

// Singleton — shared across dashboard, learn, and settings pages
export const speechController = new SpeechController();
