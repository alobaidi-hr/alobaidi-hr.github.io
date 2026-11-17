/**
 * The portal's key-value store on the company's own server, in place of Netlify Blobs: one file per key under DATA_DIR,
 * written to a temporary name and renamed, so a crash never leaves half a value. Same calls the API makes on Blobs:
 * get (text or json), set, setJSON, delete, list({ prefix }).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.env.DATA_DIR || '/data/blobs');
// Keys are stored as base64url file names, so a key with "/" or ".." can never leave the folder.
const fileOf = (key) => path.join(ROOT, Buffer.from(String(key), 'utf8').toString('base64url'));
const keyOf = (name) => Buffer.from(name, 'base64url').toString('utf8');

async function write(key, text) {
  await fs.mkdir(ROOT, { recursive: true });
  const tmp = path.join(ROOT, '.tmp-' + crypto.randomBytes(8).toString('hex'));
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, fileOf(key));
}

export function getStore() {
  return {
    async get(key, opts = {}) {
      let text;
      try { text = await fs.readFile(fileOf(key), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      return opts.type === 'json' ? JSON.parse(text) : text;
    },
    async set(key, value) { await write(key, String(value)); },
    async setJSON(key, value) { await write(key, JSON.stringify(value)); },
    async delete(key) { await fs.rm(fileOf(key), { force: true }); },
    async list(opts = {}) {
      let names = [];
      try { names = await fs.readdir(ROOT); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const prefix = opts.prefix || '';
      return { blobs: names.filter((n) => !n.startsWith('.tmp-')).map(keyOf).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), directories: [] };
    },
  };
}
export function setEnvironmentContext() {}
