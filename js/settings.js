// ============================================================
// js/settings.js — wires up settings.html
// ============================================================

import { getPrefs, setPrefs, showToast } from './utils.js';
import { speechController } from './speech.js';
import { client, requireAuth, getProfile } from './supabase.js';
import { deleteAllHistory } from './history.js';

export async function initSettingsPage() {
  const session = await requireAuth();
  if (!session) return;

  const prefs = getPrefs();
  const form = document.getElementById('settings-form');
  if (!form) return;

  // --- populate current values ---
  form.theme.value = prefs.theme;
  form.contrast.value = prefs.contrast;
  form.cameraQuality.value = prefs.cameraQuality;
  form.sensitivity.value = prefs.sensitivity;
  document.getElementById('sensitivity-value').textContent = `${Math.round(prefs.sensitivity * 100)}%`;
  form.speechRate.value = prefs.speechRate;
  document.getElementById('rate-value').textContent = `${prefs.speechRate}x`;
  form.muted.checked = prefs.muted;
  form.notifications.checked = prefs.notifications;
  form.language.value = prefs.language;
  form.twoHandMode.checked = prefs.twoHandMode;

  // --- populate voice list once available ---
  function populateVoices() {
    const voices = speechController.getEnglishVoices();
    form.voiceURI.innerHTML = voices
      .map((v) => `<option value="${v.voiceURI}" ${v.voiceURI === prefs.voiceURI ? 'selected' : ''}>${v.name}</option>`)
      .join('') || '<option value="">Default system voice</option>';
  }
  populateVoices();
  window.speechSynthesis?.addEventListener?.('voiceschanged', populateVoices);

  // --- live preview: theme/contrast apply instantly ---
  form.theme.addEventListener('change', () => {
    document.documentElement.setAttribute('data-theme', form.theme.value);
  });
  form.contrast.addEventListener('change', () => {
    document.documentElement.setAttribute('data-contrast', form.contrast.value);
  });
  form.sensitivity.addEventListener('input', () => {
    document.getElementById('sensitivity-value').textContent = `${Math.round(form.sensitivity.value * 100)}%`;
  });
  form.speechRate.addEventListener('input', () => {
    document.getElementById('rate-value').textContent = `${form.speechRate.value}x`;
  });

  // --- save ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setPrefs({
      theme: form.theme.value,
      contrast: form.contrast.value,
      cameraQuality: form.cameraQuality.value,
      sensitivity: Number(form.sensitivity.value),
      voiceURI: form.voiceURI.value,
      speechRate: Number(form.speechRate.value),
      muted: form.muted.checked,
      notifications: form.notifications.checked,
      language: form.language.value,
      twoHandMode: form.twoHandMode.checked,
    });
    showToast('Settings saved.', 'success');
  });

  // --- test voice button ---
  document.getElementById('test-voice-btn')?.addEventListener('click', () => {
    speechController.setVoice(form.voiceURI.value);
    speechController.setRate(form.speechRate.value);
    speechController.speak('Hello, this is SignSpeak AI.', { force: true });
  });

  // --- profile display ---
  const profile = await getProfile(session.user.id);
  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  if (nameEl) nameEl.textContent = profile?.full_name || 'SignSpeak User';
  if (emailEl) emailEl.textContent = profile?.email || session.user.email;

  // --- profile name update ---
  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.fullName.value = profile?.full_name || '';
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await client
        .from('profiles')
        .update({ full_name: profileForm.fullName.value.trim() })
        .eq('id', session.user.id);
      showToast(error ? 'Could not update profile.' : 'Profile updated.', error ? 'error' : 'success');
    });
  }

  // --- clear history ---
  document.getElementById('clear-history-btn')?.addEventListener('click', async () => {
    if (!confirm('This will permanently delete all your recognition history. Continue?')) return;
    const ok = await deleteAllHistory(session.user.id);
    showToast(ok ? 'History cleared.' : 'Could not clear history.', ok ? 'success' : 'error');
  });
}
