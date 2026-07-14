// ============================================================
// js/auth.js
// Wires up login.html, signup.html, forgot-password.html.
// Import the specific init function each page needs.
// ============================================================

import { client } from './supabase.js';
import { showToast } from './utils.js';

function setLoading(button, isLoading, loadingText = 'Please wait…') {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${loadingText}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function showBanner(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}
function hideBanner(el) {
  if (!el) return;
  el.classList.remove('visible');
}

function friendlyAuthError(error) {
  const msg = error?.message || 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/user already registered/i.test(msg)) return 'An account with this email already exists.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email before logging in — check your inbox.';
  if (/password should be at least/i.test(msg)) return msg;
  return msg;
}

// ------------------------------------------------------------
// SIGN UP
// ------------------------------------------------------------
export function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;
  const errorBanner = document.getElementById('auth-error');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner(errorBanner);

    const fullName = form.fullName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    if (password !== confirmPassword) {
      showBanner(errorBanner, 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      showBanner(errorBanner, 'Password must be at least 8 characters.');
      return;
    }

    setLoading(submitBtn, true, 'Creating account…');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}${window.location.pathname.replace('signup.html', 'login.html')}`,
      },
    });
    setLoading(submitBtn, false);

    if (error) {
      showBanner(errorBanner, friendlyAuthError(error));
      return;
    }

    // If email confirmations are ON in Supabase, there's no session yet.
    if (data.session) {
      showToast('Account created! Redirecting…', 'success');
      window.location.href = 'dashboard.html';
    } else {
      showToast('Check your email to confirm your account.', 'success', 6000);
      form.reset();
    }
  });
}

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------
export function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;
  const errorBanner = document.getElementById('auth-error');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner(errorBanner);

    const email = form.email.value.trim();
    const password = form.password.value;

    setLoading(submitBtn, true, 'Signing in…');
    const { error } = await client.auth.signInWithPassword({ email, password });
    setLoading(submitBtn, false);

    if (error) {
      showBanner(errorBanner, friendlyAuthError(error));
      return;
    }
    window.location.href = 'dashboard.html';
  });
}

// ------------------------------------------------------------
// FORGOT PASSWORD (request reset link)
// ------------------------------------------------------------
export function initForgotPasswordPage() {
  const requestForm = document.getElementById('forgot-form');
  const resetForm = document.getElementById('reset-form');
  const errorBanner = document.getElementById('auth-error');
  const successBanner = document.getElementById('auth-success');

  // Are we here because the user clicked the emailed reset link?
  // Supabase appends #access_token=...&type=recovery to the URL,
  // and detectSessionInUrl (set in supabase.js) turns that into
  // a real session automatically.
  const isRecoveryFlow = window.location.hash.includes('type=recovery');

  if (isRecoveryFlow && resetForm) {
    requestForm?.classList.add('visually-hidden');
    resetForm.classList.remove('visually-hidden');

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideBanner(errorBanner);
      const newPassword = resetForm.newPassword.value;
      const confirmPassword = resetForm.confirmPassword.value;

      if (newPassword !== confirmPassword) {
        showBanner(errorBanner, 'Passwords do not match.');
        return;
      }
      if (newPassword.length < 8) {
        showBanner(errorBanner, 'Password must be at least 8 characters.');
        return;
      }

      const submitBtn = resetForm.querySelector('button[type="submit"]');
      setLoading(submitBtn, true, 'Updating…');
      const { error } = await client.auth.updateUser({ password: newPassword });
      setLoading(submitBtn, false);

      if (error) {
        showBanner(errorBanner, friendlyAuthError(error));
        return;
      }
      showToast('Password updated. Please sign in.', 'success');
      window.location.href = 'login.html';
    });
    return;
  }

  if (requestForm) {
    requestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideBanner(errorBanner);
      hideBanner(successBanner);

      const email = requestForm.email.value.trim();
      const submitBtn = requestForm.querySelector('button[type="submit"]');
      setLoading(submitBtn, true, 'Sending…');

      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      });
      setLoading(submitBtn, false);

      if (error) {
        showBanner(errorBanner, friendlyAuthError(error));
        return;
      }
      showBanner(successBanner, 'If that email exists, a reset link is on its way. Check your inbox.');
      requestForm.reset();
    });
  }
}

// ------------------------------------------------------------
// LOGOUT — attach to any element with [data-action="logout"]
// ------------------------------------------------------------
export function wireLogoutButtons() {
  document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.href = 'login.html';
    });
  });
}

// ------------------------------------------------------------
// Password visibility toggle — attach to [data-toggle-password]
// ------------------------------------------------------------
export function wirePasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      btn.textContent = isHidden ? '🙈' : '👁️';
    });
  });
}
