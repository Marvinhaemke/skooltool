import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Pluggable storage so the same code runs on a server (JSON file) and on
 * Vercel (Vercel KV / Upstash Redis — no persistent filesystem there).
 *
 * The interface is a small superset of what we need:
 *   getJSON(key) / setJSON(key, val) / del(key)
 *   hGetAll(key) / hSet(key, field, val) / hDel(key, field)   (member maps, counters)
 *
 * Backend selection:
 *   - If KV_REST_API_URL is present (Vercel KV is provisioned) -> KvStore.
 *   - Otherwise -> JsonFileStore (data/state.json), for local/VPS use.
 */

class JsonFileStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.loaded = false;
    this._writing = Promise.resolve();
  }

  async _load() {
    if (this.loaded) return;
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch (err) {
        logger.error({ err, file: this.file }, 'Corrupt store file; starting empty');
        this.data = {};
      }
    }
    this.loaded = true;
  }

  async _persist() {
    // Serialize writes so concurrent saves don't clobber each other.
    this._writing = this._writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2));
      await rename(tmp, this.file);
    });
    return this._writing;
  }

  async getJSON(key) {
    await this._load();
    return this.data[key] ?? null;
  }

  async setJSON(key, val) {
    await this._load();
    this.data[key] = val;
    await this._persist();
  }

  async del(key) {
    await this._load();
    delete this.data[key];
    await this._persist();
  }

  async hGetAll(key) {
    await this._load();
    return this.data[key] && typeof this.data[key] === 'object' ? this.data[key] : {};
  }

  async hSet(key, field, val) {
    await this._load();
    if (!this.data[key] || typeof this.data[key] !== 'object') this.data[key] = {};
    this.data[key][field] = val;
    await this._persist();
  }

  async hDel(key, field) {
    await this._load();
    if (this.data[key]) delete this.data[key][field];
    await this._persist();
  }
}

class RedisStore {
  // Backed by Upstash Redis (the store behind "Vercel KV" / the Vercel + Upstash
  // marketplace integration). @upstash/redis auto-serializes JSON values.
  constructor(redis) {
    this.redis = redis;
  }

  async getJSON(key) {
    return (await this.redis.get(key)) ?? null;
  }

  async setJSON(key, val) {
    await this.redis.set(key, val);
  }

  async del(key) {
    await this.redis.del(key);
  }

  async hGetAll(key) {
    return (await this.redis.hgetall(key)) ?? {};
  }

  async hSet(key, field, val) {
    await this.redis.hset(key, { [field]: val });
  }

  async hDel(key, field) {
    await this.redis.hdel(key, field);
  }
}

let storagePromise;

async function build() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    // Lazy import so local installs/dev without Redis still work.
    const { Redis } = await import('@upstash/redis');
    logger.info('Using Upstash Redis storage backend');
    return new RedisStore(new Redis({ url, token }));
  }
  logger.info('Using local JSON file storage backend');
  return new JsonFileStore(path.join(config.dataDir, 'state.json'));
}

export function getStorage() {
  if (!storagePromise) storagePromise = build();
  return storagePromise;
}
