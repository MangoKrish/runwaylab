// The local server. It serves the site, and runs api/<name>.mjs the same way Vercel does in production.
// Run with: npm run dev. It only listens on this computer, and the camera is allowed on localhost.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.onnx': 'application/octet-stream', '.task': 'application/octet-stream', '.ogg': 'audio/ogg',
};
const PRIVATE = /^\/(\.env|\.git|node_modules|test-output|recordings)/;

function loadEnvFile() {
  const file = path.join(ROOT, '.env.local');
  // RUNWAYLAB_NO_ENV_FILE keeps automated tests away from real keys and real databases.
  if (process.env.RUNWAYLAB_NO_ENV_FILE || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/); // A blank value means "not set".
    if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

async function runFunction(req, res, name) {
  const file = path.join(ROOT, 'api', `${path.basename(name)}.mjs`);
  if (!fs.existsSync(file) || name.startsWith('_')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"no such function"}');
  }
  loadEnvFile();
  process.env.RUNWAYLAB_DEV = '1';
  const mod = await import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);
  const handler = mod[req.method];
  if (!handler) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end('{"error":"method not allowed"}');
  }
  const headers = { ...req.headers };
  for (const k of ['connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade']) delete headers[k];
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const out = await handler(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined }));
  const outHeaders = Object.fromEntries(out.headers);
  const cookies = out.headers.getSetCookie(); // Several cookies must stay separate headers, not one joined line.
  if (cookies.length) outHeaders['set-cookie'] = cookies;
  res.writeHead(out.status, outHeaders);
  if (!out.body) return res.end();
  // Passed on as it arrives, so a streamed answer (the judge's progress) reaches the page live, as on Vercel.
  const reader = out.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  return res.end();
}

function serveFile(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const full = path.resolve(ROOT, `.${path.posix.normalize(decodeURIComponent(rel))}`);
  if (PRIVATE.test(rel) || !full.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  return sendFile(req, res, full);
}

function sendFile(req, res, full) {
  const { size } = fs.statSync(full);
  const type = TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  // Video seeking needs range requests.
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  return fs.createReadStream(full).pipe(res);
}

const RECORDINGS = path.join(ROOT, 'recordings');

/** Writes a recording the page sends into recordings/. Only npm run dev turns this on; it never exists on Vercel. */
async function keepRecording(req, res, url) {
  const name = path.basename(url.searchParams.get('name') || '');
  const fromThisComputer = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (req.method !== 'POST' || !fromThisComputer || !/^[\w-]+\.(mp4|mov|webm|json)$/.test(name)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end('{"error":"bad request"}');
  }
  const body = await readBody(req);
  fs.mkdirSync(RECORDINGS, { recursive: true });
  fs.writeFileSync(path.join(RECORDINGS, name), body);
  console.log(`[keep] recordings/${name} (${(body.length / 1048576).toFixed(1)} MB)`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end('{"ok":true}');
}

export function startDevServer({ port = 4700, quiet = false, extraFiles = null, keepRecordings = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (keepRecordings && url.pathname === '/dev/recordings') return await keepRecording(req, res, url);
      const fn = url.pathname.match(/^\/api\/([^/]+)$/);
      if (fn) return await runFunction(req, res, fn[1]);
      if (extraFiles?.[url.pathname]) return sendFile(req, res, extraFiles[url.pathname]);
      return serveFile(req, res, url.pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end('{"error":"server error"}');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is busy. Is RunwayLab already running?`) : e));
    server.listen(port, '127.0.0.1', () => {
      if (!quiet) console.log(`RunwayLab is running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDevServer({ port: Number(process.env.PORT) || 4700, keepRecordings: true }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
