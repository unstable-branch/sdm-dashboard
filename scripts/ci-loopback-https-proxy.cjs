'use strict';
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const required = ['SDM_CI_TLS_KEY', 'SDM_CI_TLS_CERT', 'SDM_CI_TLS_LISTEN', 'SDM_CI_TLS_UPSTREAM'];
for (const name of required) if (!process.env[name]) throw new Error(`missing ${name}`);
const listen = process.env.SDM_CI_TLS_LISTEN;
if (!/^127\.0\.0\.1:\d+$/.test(listen)) throw new Error('listener must be IPv4 loopback with explicit port');
const upstream = new URL(process.env.SDM_CI_TLS_UPSTREAM);
if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') throw new Error('upstream must be HTTP on IPv4 loopback');
const [host, port] = listen.split(':');
const upstreamRequests = new Set();
let shuttingDown = false;
const server = https.createServer({ key: fs.readFileSync(process.env.SDM_CI_TLS_KEY), cert: fs.readFileSync(process.env.SDM_CI_TLS_CERT) }, (req, res) => {
  const headers = { ...req.headers, host: upstream.host, 'x-forwarded-host': listen, 'x-forwarded-proto': 'https' };
  const options = { hostname: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url, headers };
  const upstreamRequest = http.request(options, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode, upstreamResponse.statusMessage, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstreamRequests.add(upstreamRequest);
  upstreamRequest.once('close', () => upstreamRequests.delete(upstreamRequest));
  upstreamRequest.on('error', (error) => {
    if (!res.headersSent && !shuttingDown) res.writeHead(502);
    res.end(shuttingDown ? undefined : 'loopback upstream error');
    if (!shuttingDown) console.error(`upstream request failed: ${error.code || 'error'}`);
  });
  req.pipe(upstreamRequest);
});
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
server.listen(Number(port), host, () => console.log(`CI loopback HTTPS proxy listening on ${listen}`));
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  server.closeAllConnections();
  for (const request of upstreamRequests) request.destroy();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
