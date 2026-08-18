/* ============================================================
   Orbit — backend
   Zero dependencies: static file server + a small REST API over
   a JSON file. Binds to localhost only.

     node server.js            → http://127.0.0.1:3000
     PORT=8080 node server.js
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ORBIT_DATA || join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'ideas.json');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const STATUSES = new Set(['spark', 'brewing', 'building', 'shipped', 'parked']);
const MAX_BODY = 4 * 1024 * 1024;

/* ------------------------------------------------------------
   Store — the whole collection lives in one JSON file.
   Writes go through a promise chain so they never interleave,
   and land via rename() so the file is never half-written.
   ------------------------------------------------------------ */

const store = {
  cache: null,
  queue: Promise.resolve(),

  async all() {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[orbit] could not read store:', err.message);
      this.cache = [];
    }
    return this.cache;
  },

  /** Replace the collection; returns the list that was written. */
  async commit(list) {
    this.cache = list;
    this.queue = this.queue.then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
      await rename(tmp, DATA_FILE);
    }).catch((err) => {
      console.error('[orbit] write failed:', err.message);
    });
    await this.queue;
    return list;
  },
};

/* ------------------------------------------------------------
   Shape — never trust what arrives on the wire
   ------------------------------------------------------------ */

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v, max) => String(v ?? '').slice(0, max);

function normalize(raw = {}) {
  const title = str(raw.title, 300).trim();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : randomUUID(),
    title: title || 'Untitled idea',
    note: str(raw.note, 4000),
    date: isDateKey(raw.date) ? raw.date : null,
    status: STATUSES.has(raw.status) ? raw.status : 'spark',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter(Boolean).map((t) => str(t, 40).replace(/^#/, '')).slice(0, 12)
      : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply only the fields a client is allowed to change. A field that
 * arrives malformed is ignored rather than reset — a bad `status` in a
 * rename request should not quietly wipe the real one.
 */
function merge(existing, patch) {
  const next = { ...existing };
  if ('title' in patch) next.title = patch.title;
  if ('note' in patch) next.note = patch.note;
  if ('tags' in patch && Array.isArray(patch.tags)) next.tags = patch.tags;
  if ('date' in patch) {
    if (isDateKey(patch.date)) next.date = patch.date;
    else if (patch.date === null || patch.date === '') next.date = null;
  }
  if ('status' in patch && STATUSES.has(patch.status)) next.status = patch.status;
  next.id = existing.id;
  next.createdAt = existing.createdAt;
  return normalize(next);
}

/* ------------------------------------------------------------
   HTTP plumbing
   ------------------------------------------------------------ */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = resolve(ROOT, rel);

  // stay inside the project, and never hand out the data directory
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, { error: 'Forbidden' });
  if (file.startsWith(resolve(DATA_DIR) + sep)) return send(res, 403, { error: 'Forbidden' });

  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return send(res, 404, { error: 'Not found' });

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

/* ------------------------------------------------------------
   API
     GET    /api/ideas       list
     POST   /api/ideas       create one
     PUT    /api/ideas       replace the whole collection
     DELETE /api/ideas       delete everything
     PATCH  /api/ideas/:id   update one
     DELETE /api/ideas/:id   delete one
   ------------------------------------------------------------ */

async function api(req, res, pathname) {
  const rest = pathname.slice('/api/ideas'.length);
  const id = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : '';
  const ideas = await store.all();

  if (!id) {
    if (req.method === 'GET') return send(res, 200, { ideas });

    if (req.method === 'POST') {
      const idea = normalize(await readBody(req));
      await store.commit([idea, ...ideas]);
      return send(res, 201, { idea });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const list = Array.isArray(body) ? body : body.ideas;
      if (!Array.isArray(list)) return send(res, 400, { error: 'Expected an array of ideas' });
      const next = list.slice(0, 5000).map(normalize);
      await store.commit(next);
      return send(res, 200, { ideas: next });
    }

    if (req.method === 'DELETE') {
      await store.commit([]);
      return send(res, 200, { deleted: ideas.length });
    }

    return send(res, 405, { error: 'Method not allowed' });
  }

  const index = ideas.findIndex((i) => i.id === id);
  if (index === -1) return send(res, 404, { error: 'No idea with that id' });

  if (req.method === 'GET') return send(res, 200, { idea: ideas[index] });

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const idea = merge(ideas[index], await readBody(req));
    const next = ideas.slice();
    next[index] = idea;
    await store.commit(next);
    return send(res, 200, { idea });
  }

  if (req.method === 'DELETE') {
    await store.commit(ideas.filter((i) => i.id !== id));
    return send(res, 200, { deleted: 1 });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

/* ------------------------------------------------------------
   Server
   ------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true, count: (await store.all()).length });
    if (pathname === '/api/ideas' || pathname.startsWith('/api/ideas/')) return await api(req, res, pathname);
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname);
    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[orbit]', err);
    if (!res.headersSent) send(res, status, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, HOST, async () => {
  const count = (await store.all()).length;
  console.log(`Orbit → http://${HOST}:${PORT}`);
  console.log(`Store → ${DATA_FILE} (${count} idea${count === 1 ? '' : 's'})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nOrbit stopped.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
