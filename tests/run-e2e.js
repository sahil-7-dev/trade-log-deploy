#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Runs tests/e2e/smoke.js against the real app in headless Chrome (or Edge).
// No dependencies: serves public/ from a tiny local web server (pages load
// their HTML with fetch, which browsers block on file://), injects the test
// script, and reads the result the test prints to the browser console.
//   npm run test:e2e          (set CHROME_PATH to use a specific browser)
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) {
  console.error('No Chrome/Edge found — set CHROME_PATH to your browser executable.');
  process.exit(2);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
// Which scenario: node tests/run-e2e.js [file in tests/e2e/]  (default smoke.js)
const testFile = process.argv[2] || 'smoke.js';
const smoke = fs.readFileSync(path.join(__dirname, 'e2e', testFile), 'utf8');

// Serves public/, with three test-only twists: config.js comes from the
// example file, /js/smoke.js is the test, and index.html loads it first.
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const send = (body, type) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url === '/js/smoke.js') return send(smoke, TYPES['.js']);
  if (url === '/js/config.js') return send(fs.readFileSync(path.join(publicDir, 'js', 'config.example.js')), TYPES['.js']);
  let file = path.join(publicDir, url === '/' ? 'index.html' : url);
  if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html'; // like Vercel's cleanUrls
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    body = body.toString().replace('<script src="js/core/ui.js"></script>', '<script src="js/smoke.js"></script>\n<script src="js/core/ui.js"></script>');
  }
  send(body, TYPES[path.extname(file)] || 'application/octet-stream');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tradelog-e2e-'));
  let stderr = '';
  let finished = false;
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`,
    '--enable-logging=stderr', '--v=0', '--no-first-run',
    '--virtual-time-budget=20000', '--dump-dom', `http://127.0.0.1:${port}/index.html`,
  ]);
  child.stderr.on('data', d => {
    stderr += d;
    if (!finished && /SMOKE RESULT [A-Za-z0-9+/=]+/.test(stderr)) finish();
  });
  child.stdout.on('data', () => {}); // drain the dumped DOM
  const timer = setTimeout(() => finish(), 90000);
  child.on('exit', () => finish());

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { child.kill(); } catch (e) { /* already gone */ }
    server.close();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
    report(stderr);
  }
});

function report(log) {
  // The test prints its result base64-encoded, immune to the log's quoting
  const m = log.match(/SMOKE RESULT ([A-Za-z0-9+/=]+)/);
  if (!m) {
    const errs = log.split('\n').filter(l => /Uncaught|ERROR:CONSOLE|Failed to load/.test(l)).slice(0, 10);
    console.error('No test result found — the page may have failed to load.\n' + errs.join('\n'));
    process.exit(1);
  }
  let result;
  try { result = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch (e) {
    console.error('Could not read the test result:', e.message);
    process.exit(1);
  }
  console.log(`── ${testFile}`);
  result.checks.forEach(c => console.log(c));
  const failed = result.checks.filter(c => c.startsWith('FAIL')).length;
  if (result.errors.length) console.log('\nJavaScript errors:\n  ' + result.errors.join('\n  '));
  console.log(`\n${result.checks.length - failed} passed, ${failed} failed, ${result.errors.length} JS errors`);
  process.exit(failed || result.errors.length ? 1 : 0);
}
