import { getStorage } from './storage.js';

/**
 * Application state, persisted through the storage backend (JSON file locally,
 * Vercel KV in production). Kept as a handful of discrete JSON keys so a
 * serverless invocation can read/modify/write just the piece it needs.
 *
 * Keys:
 *   members        { handle: memberRecord }   latest snapshot
 *   meta           { lastSyncAt }
 *   firedTriggers  { dedupeKey: iso }          at-most-once trigger guard
 *   dmDailyCount   { 'YYYY-MM-DD': count }     per-day DM quota counter
 *   dmLog          [ { handle, trigger, at } ] bounded recent DM log
 */

const DM_LOG_MAX = 1000;

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function getMembers() {
  const store = await getStorage();
  return (await store.getJSON('members')) || {};
}

export async function setMembers(map) {
  const store = await getStorage();
  await store.setJSON('members', map);
}

export async function getLastSyncAt() {
  const store = await getStorage();
  const meta = (await store.getJSON('meta')) || {};
  return meta.lastSyncAt || null;
}

export async function setLastSyncAt(iso) {
  const store = await getStorage();
  await store.setJSON('meta', { lastSyncAt: iso });
}

export async function hasFired(key) {
  const store = await getStorage();
  const fired = (await store.getJSON('firedTriggers')) || {};
  return Boolean(fired[key]);
}

export async function markFired(key) {
  const store = await getStorage();
  const fired = (await store.getJSON('firedTriggers')) || {};
  fired[key] = new Date().toISOString();
  await store.setJSON('firedTriggers', fired);
}

export async function getDailyCount(date = todayKey()) {
  const store = await getStorage();
  const counts = (await store.getJSON('dmDailyCount')) || {};
  return counts[date] || 0;
}

export async function incDailyCount(date = todayKey()) {
  const store = await getStorage();
  const counts = (await store.getJSON('dmDailyCount')) || {};
  counts[date] = (counts[date] || 0) + 1;
  await store.setJSON('dmDailyCount', counts);
  return counts[date];
}

export async function appendDmLog(entry) {
  const store = await getStorage();
  const log = (await store.getJSON('dmLog')) || [];
  log.push({ ...entry, at: entry.at || new Date().toISOString() });
  // Keep the log bounded so large communities don't bloat the value.
  if (log.length > DM_LOG_MAX) log.splice(0, log.length - DM_LOG_MAX);
  await store.setJSON('dmLog', log);
}

export async function getDmLog() {
  const store = await getStorage();
  return (await store.getJSON('dmLog')) || [];
}

export async function getStatus() {
  const [members, lastSyncAt, dmToday, log] = await Promise.all([
    getMembers(),
    getLastSyncAt(),
    getDailyCount(),
    getDmLog(),
  ]);
  return {
    lastSyncAt,
    totalMembers: Object.keys(members).length,
    dmsToday: dmToday,
    dmLogSize: log.length,
  };
}
