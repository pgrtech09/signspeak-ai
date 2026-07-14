// ============================================================
// js/utils.js — small shared helpers used across every page
// ============================================================

/**
 * Shows a toast notification. Auto-creates the toast region if
 * it doesn't exist yet on the page.
 */
export function showToast(message, type = 'info', duration = 4000) {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease-out';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/** Debounce helper */
export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Formats an ISO date string for history tables */
export function formatDateTime(isoString) {
  const d = new Date(isoString);
  return {
    date: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

/** Escapes text for safe CSV cell insertion */
export function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Downloads a string as a file via a temporary <a> click */
export function downloadFile(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// THEME + PREFERENCES (persisted to localStorage, read by
// every page on load — see applySavedPreferences below)
// ------------------------------------------------------------
const PREFS_KEY = 'signspeak-prefs';

export function getPrefs() {
  try {
    return {
      theme: 'dark',
      contrast: 'normal',
      cameraQuality: '720p',
      sensitivity: 0.75,
      voiceURI: '',
      speechRate: 1,
      muted: false,
      language: 'en',
      notifications: true,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'),
    };
  } catch {
    return { theme: 'dark', contrast: 'normal', cameraQuality: '720p', sensitivity: 0.75, voiceURI: '', speechRate: 1, muted: false, language: 'en', notifications: true };
  }
}

export function setPrefs(partial) {
  const next = { ...getPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

/** Call at the top of every page's script to apply saved theme/contrast instantly */
export function applySavedPreferences() {
  const prefs = getPrefs();
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.setAttribute('data-contrast', prefs.contrast);
  return prefs;
}

/** Registers the service worker (call once per page) */
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[SignSpeak AI] Service worker registration failed:', err);
      });
    });
  }
}

/** Simple online/offline badge updater — pass an element to update */
export function watchConnectivity(onChange) {
  const update = () => onChange(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
