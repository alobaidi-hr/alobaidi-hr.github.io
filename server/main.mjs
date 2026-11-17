/**
 * L-O HR portal on the company's server (next to the ERP): the same API as the Netlify function and the same screens.
 *   POST /api        the API (handler from netlify/functions/api.mjs, store from ./store.mjs)
 *   GET  /*          the screens (site/), with config.js pointing at this server's /api
 *   POST /__import   one-off copy of the data from Netlify Blobs, only while IMPORT_KEY is set
 * Behind Caddy at https://<erp domain>/hr/ (the prefix is stripped before it reaches here).
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import api from './api.bundle.mjs';
import { getStore } from './store.mjs';

const PORT = Number(process.env.PORT || 8080);
const SITE = path.resolve(process.env.SITE_DIR || new URL('./site', import.meta.url).pathname);
const IMPORT_KEY = process.env.IMPORT_KEY || '';
const IMPORT_ORIGINS = (process.env.IMPORT_ORIGINS || 'https://app.netlify.com').split(',').map((s) => s.trim()).filter(Boolean);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css' };
const SECURITY = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const MAX_BODY = 12 * 1024 * 1024;

async function readBody(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 }); parts.push(chunk); }
  return Buffer.concat(parts).toString('utf8');
}
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SECURITY, ...headers }); res.end(body); };
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function importItems(req, res) {
  const origin = req.headers.origin || '';
  const cors = IMPORT_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Import-Key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {};
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);
  if (!IMPORT_KEY || !same(req.headers['x-import-key'] || '', IMPORT_KEY)) return send(res, 404, 'not found', cors);
  const { items } = JSON.parse(await readBody(req));
  if (!Array.isArray(items)) return send(res, 400, 'items', cors);
  const store = getStore();
  for (const it of items) {
    if (typeof it.key !== 'string' || !it.key || it.key.length > 400 || typeof it.value !== 'string') return send(res, 400, 'item', cors);
    await store.set(it.key, it.value);
  }
  console.log(new Date().toISOString(), 'import', items.length, items.map((i) => i.key).slice(0, 3).join(','));
  return send(res, 200, JSON.stringify({ ok: true, count: items.length }), { ...cors, 'Content-Type': 'application/json' });
}

async function serveApi(req, res) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const reply = await api(new Request('http://local/api', { method: req.method, body }));
  const headers = {}; reply.headers.forEach((v, k) => { headers[k] = v; });
  send(res, reply.status, Buffer.from(await reply.arrayBuffer()), headers);
}

async function serveFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (rel === '/config.js') return send(res, 200, "window.LO_CONFIG = { API_URL: 'api' };\n", { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
  const file = path.resolve(SITE, '.' + rel);
  if (!file.startsWith(SITE + path.sep) || path.basename(file).startsWith('_')) return send(res, 404, 'not found');
  try {
    const data = await fs.readFile(file);
    const cache = rel === '/index.html' ? 'no-cache' : 'public, max-age=300';
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  } catch { send(res, 404, 'not found'); }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/__import') return await importItems(req, res);
    if (url.pathname === '/api') return await serveApi(req, res);
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (req.method === 'GET' || req.method === 'HEAD') return await serveFile(req, res, url);
    send(res, 405, 'method');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, e.status === 413 ? 'too large' : 'error');
  }
}).listen(PORT, () => console.log('L-O HR portal on', PORT));
