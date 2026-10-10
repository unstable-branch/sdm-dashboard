#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const proxyPath = path.join(__dirname, 'ci-loopback-https-proxy.cjs');
const Module = require('node:module');
const transportOnly = process.env.SDM_CI_TRANSPORT_ONLY === '1';
let NextRequest;
let frontendProxy;
if (!transportOnly) {
  const frontendRequire = Module.createRequire(path.join(root, 'frontend/package.json'));
  const ts = frontendRequire('typescript');
  ({ NextRequest } = frontendRequire('next/server'));
  const frontendProxyPath = path.join(root, 'frontend/src/proxy.ts');
  const frontendProxyModule = new Module(frontendProxyPath, module);
  frontendProxyModule.filename = frontendProxyPath;
  frontendProxyModule.paths = Module._nodeModulePaths(path.dirname(frontendProxyPath));
  frontendProxyModule._compile(ts.transpileModule(fs.readFileSync(frontendProxyPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, frontendProxyPath);
  frontendProxy = frontendProxyModule.exports.proxy;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}

test('CI HTTPS loopback proxy streams status/body and preserves multiple cookies', async (t) => {
  const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sdm-ci-tls-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const key = path.join(temp, 'key.pem');
  const cert = path.join(temp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });

  let received = Buffer.alloc(0);
  let receivedProxyHeaders;
  const upstream = http.createServer((req, res) => {
    receivedProxyHeaders = req.headers;
    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
    if (requestPath === '/upstream-error') { req.socket.destroy(); return; }
    if (requestPath === '/private') {
      assert.ok(frontendProxy && NextRequest, 'Next redirect fixture requires frontend dependencies');
      const publicOrigin = `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`;
      const nextRequest = new NextRequest(new URL(req.url, publicOrigin), { headers: req.headers });
      const redirect = frontendProxy(nextRequest);
      res.writeHead(redirect.status, Object.fromEntries(redirect.headers));
      return res.end();
    }
    req.on('data', (chunk) => { received = Buffer.concat([received, chunk]); });
    req.on('end', () => {
      res.writeHead(207, { 'Set-Cookie': ['first=one; Path=/; HttpOnly', 'second=two; Path=/; Secure'], 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from('upstream:').length ? Buffer.concat([Buffer.from('upstream:'), received]) : received);
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const proxyPort = 30000 + Math.floor(Math.random() * 20000);
  const proxy = spawn(process.execPath, [proxyPath], {
    env: { ...process.env, SDM_CI_TLS_KEY: key, SDM_CI_TLS_CERT: cert, SDM_CI_TLS_LISTEN: `127.0.0.1:${proxyPort}`, SDM_CI_TLS_UPSTREAM: `http://127.0.0.1:${upstreamPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (proxy.exitCode === null && proxy.signalCode === null) {
      proxy.kill('SIGTERM');
      if (!(await waitForExit(proxy, 1000))) {
        proxy.kill('SIGKILL');
        await waitForExit(proxy, 1000);
      }
    }
  });
  let output = '';
  proxy.stdout.on('data', (b) => { output += b; });
  proxy.stderr.on('data', (b) => { output += b; });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`proxy did not report ready: ${output}`)), 5000);
    proxy.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(deadline); resolve(); } });
    proxy.once('error', (error) => { clearTimeout(deadline); reject(error); });
    proxy.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`proxy exited ${code}: ${output}`)); });
  });

  const payload = Buffer.from('stream-check');
  const response = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: proxyPort, path: '/fixture?mode=body', method: 'POST', rejectUnauthorized: false, headers: { host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http', 'content-length': payload.length } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), cookies: res.headers['set-cookie'] }));
    });
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(response.status, 207);
  assert.deepEqual(response.body, Buffer.concat([Buffer.from('upstream:'), payload]));
  assert.equal(response.cookies.length, 2);
  assert.equal(receivedProxyHeaders.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(receivedProxyHeaders['x-forwarded-host'], `127.0.0.1:${proxyPort}`);
  assert.equal(receivedProxyHeaders['x-forwarded-proto'], 'https');

  if (!transportOnly) {
    const redirect = await new Promise((resolve, reject) => {
      const req = https.get({ hostname: '127.0.0.1', port: proxyPort, path: '/private?tab=projects', rejectUnauthorized: false, headers: { host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http' } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
      });
      req.on('error', reject);
    });
    assert.equal(redirect.status, 307);
    assert.equal(redirect.location, `https://localhost:${proxyPort}/login?redirect=%2Fprivate%3Ftab%3Dprojects`);

    const upstreamError = await new Promise((resolve, reject) => {
      const req = https.get({ hostname: '127.0.0.1', port: proxyPort, path: '/upstream-error', rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
    });
    assert.deepEqual(upstreamError, { status: 502, body: 'loopback upstream error' });
  }
});

test('SIGTERM exits promptly and closes an active SSE upstream stream', async (t) => {
  const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sdm-ci-tls-sse-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const key = path.join(temp, 'key.pem');
  const cert = path.join(temp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });

  let upstreamClosed = false;
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: connected\\n\\n');
    res.on('close', () => { upstreamClosed = true; });
  });
  const upstreamPort = await listen(upstream);
  t.after(async () => {
    upstream.closeAllConnections();
    await close(upstream);
  });

  const proxyPort = 30000 + Math.floor(Math.random() * 20000);
  const proxy = spawn(process.execPath, [proxyPath], {
    env: { ...process.env, SDM_CI_TLS_KEY: key, SDM_CI_TLS_CERT: cert, SDM_CI_TLS_LISTEN: `127.0.0.1:${proxyPort}`, SDM_CI_TLS_UPSTREAM: `http://127.0.0.1:${upstreamPort}` },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(async () => {
    if (proxy.exitCode === null && proxy.signalCode === null) {
      proxy.kill('SIGKILL');
      await waitForExit(proxy, 1000);
    }
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('SSE proxy did not report ready')), 5000);
    proxy.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) { clearTimeout(deadline); resolve(); }
    });
    proxy.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`SSE proxy exited ${code} before ready`)); });
  });

  const client = https.get({ hostname: '127.0.0.1', port: proxyPort, path: '/events', rejectUnauthorized: false });
  t.after(() => client.destroy());
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('SSE stream did not open')), 3000);
    client.once('response', (res) => {
      res.once('data', () => { clearTimeout(deadline); resolve(); });
      res.once('error', reject);
    });
    client.once('error', reject);
  });

  proxy.kill('SIGTERM');
  assert.equal(await waitForExit(proxy, 1500), true, 'proxy process must exit within 1.5 seconds');
  const upstreamDeadline = Date.now() + 1500;
  while (!upstreamClosed && Date.now() < upstreamDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(upstreamClosed, true, 'SIGTERM must close the active upstream SSE response');
});

test('Playwright ignores TLS errors only for explicitly enabled CI loopback HTTPS', () => {
  const config = fs.readFileSync(path.join(root, 'frontend/playwright.config.ts'), 'utf8');
  assert.match(config, /const loopbackHttps = process\.env\.SDM_CI_LOOPBACK_HTTPS === "1"/);
  assert.match(config, /ignoreHTTPSErrors:\s*loopbackHttps/);
  assert.match(config, /loopbackHttps &&[\s\S]*process\.env\.E2E_BASE_URL/);
  assert.ok(config.includes("https:\\/\\/127\\.0\\.0\\.1"));
});

test('docker CI serves browser traffic through HTTPS while health remains upstream HTTP', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/platform-ci.yml'), 'utf8');
  assert.match(workflow, /FRONTEND_URL:\s*https:\/\/127\.0\.0\.1:3443/);
  assert.match(workflow, /E2E_BASE_URL:\s*https:\/\/127\.0\.0\.1:3443/);
  assert.match(workflow, /wait_for Frontend http:\/\/localhost:3000\//);
  assert.match(workflow, /SDM_CI_LOOPBACK_HTTPS:\s*"1"/);
});
