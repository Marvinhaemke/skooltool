import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * A tiny atomic JSON document store. The data set (members of a single
 * community + a DM log) is small enough that a single JSON file is plenty,
 * and it keeps the project dependency-free and portable (no native modules,
 * runs anywhere including CI).
 */
class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
  }

  async load() {
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch (err) {
        logger.error({ err, file: this.file }, 'Failed to parse store; starting fresh');
        this.data = structuredClone(this.defaults);
      }
    }
    // Backfill any new top-level default keys added since the file was written.
    for (const [k, v] of Object.entries(this.defaults)) {
      if (!(k in this.data)) this.data[k] = structuredClone(v);
    }
    return this;
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file); // atomic on POSIX
  }
}

const DEFAULTS = {
  // handle -> member record (latest known snapshot)
  members: {},
  // ISO date string of the last successful sync
  lastSyncAt: null,
  // log of sent DMs: [{ handle, template, at, trigger }]
  dmLog: [],
  // per-day counter: { 'YYYY-MM-DD': count }
  dmDailyCount: {},
  // record of trigger events already fired, to guarantee at-most-once:
  // "<type>:<handle>:<key>" -> ISO timestamp
  firedTriggers: {},
};

let store;

export async function getStore() {
  if (!store) {
    store = await new JsonStore(path.join(config.dataDir, 'state.json'), DEFAULTS).load();
  }
  return store;
}

/** Today's date key in the configured timezone (good enough: server-local). */
export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
