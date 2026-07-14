// ============================================================
// js/history.js
// Reads/writes recognition_history in Supabase. Also implements
// an IndexedDB queue so writes made while offline aren't lost —
// they're flushed when sw.js's background sync fires.
// ============================================================

import { client } from './supabase.js';
import { csvEscape, downloadFile, formatDateTime } from './utils.js';

const DB_NAME = 'signspeak-offline';
const STORE_NAME = 'pending-history';

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'localId', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queuePendingWrite(row) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...row, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueuedWrites() {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearQueuedWrite(localId) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Logs one recognition event. Falls back to an offline queue and
 * registers a background sync if the network write fails.
 */
export async function logRecognition({ userId, text, confidence, category = 'unknown' }) {
  const row = {
    user_id: userId,
    recognized_text: text,
    confidence,
    category,
  };

  if (!navigator.onLine) {
    await queuePendingWrite(row);
    await registerBackgroundSync();
    return { queued: true };
  }

  const { error } = await client.from('recognition_history').insert(row);
  if (error) {
    await queuePendingWrite(row);
    await registerBackgroundSync();
    return { queued: true, error };
  }
  return { queued: false };
}

async function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-history');
    } catch {
      /* Background Sync not supported in this browser — queue will
         still flush next time flushPendingHistory() runs on load. */
    }
  }
}

/** Called on dashboard load, and when sw.js posts FLUSH_PENDING_HISTORY */
export async function flushPendingHistory() {
  const pending = await getQueuedWrites();
  for (const item of pending) {
    const { localId, queuedAt, ...row } = item;
    const { error } = await client.from('recognition_history').insert(row);
    if (!error) await clearQueuedWrite(localId);
  }
  return pending.length;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'FLUSH_PENDING_HISTORY') flushPendingHistory();
  });
}

/** Fetches recent history rows for the dashboard "Recent" widget */
export async function fetchRecentHistory(userId, limit = 5) {
  const { data, error } = await client
    .from('recognition_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[SignSpeak AI] fetchRecentHistory error:', error.message);
    return [];
  }
  return data;
}

/** Fetches all history rows for the History page, optionally filtered by search text */
export async function fetchHistory(userId, { search = '', limit = 200 } = {}) {
  let query = client
    .from('recognition_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search.trim()) {
    query = query.ilike('recognized_text', `%${search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[SignSpeak AI] fetchHistory error:', error.message);
    return [];
  }
  return data;
}

export async function deleteHistoryEntry(id) {
  const { error } = await client.from('recognition_history').delete().eq('id', id);
  return !error;
}

export async function deleteAllHistory(userId) {
  const { error } = await client.from('recognition_history').delete().eq('user_id', userId);
  return !error;
}

export function exportHistoryToCSV(rows) {
  const header = ['Date', 'Time', 'Recognized Text', 'Confidence (%)', 'Category'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const { date, time } = formatDateTime(row.created_at);
    lines.push(
      [date, time, csvEscape(row.recognized_text), row.confidence, row.category].map(csvEscape).join(',')
    );
  }
  downloadFile(`signspeak-history-${Date.now()}.csv`, lines.join('\n'));
}

/** Computes stats for the dashboard stat tiles from a set of history rows */
export function computeStats(rows) {
  const today = new Date().toDateString();
  const todayCount = rows.filter((r) => new Date(r.created_at).toDateString() === today).length;
  const avgConfidence = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + Number(r.confidence), 0) / rows.length)
    : 0;
  return {
    total: rows.length,
    today: todayCount,
    avgConfidence,
    lastAt: rows[0]?.created_at || null,
  };
}

// ------------------------------------------------------------
// SAVED PHRASES
// ------------------------------------------------------------
export async function fetchSavedPhrases(userId) {
  const { data, error } = await client
    .from('saved_phrases')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

export async function savePhrase(userId, phrase) {
  const { error } = await client.from('saved_phrases').insert({ user_id: userId, phrase });
  return !error;
}

export async function deleteSavedPhrase(id) {
  const { error } = await client.from('saved_phrases').delete().eq('id', id);
  return !error;
}
