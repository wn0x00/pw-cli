'use strict';

const http = require('http');
const net = require('net');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function die(msg, code = 1) {
  process.stderr.write(`pw-cli error: ${msg}\n`);
  process.exit(code);
}

function probeCDP(port, timeout = 3000) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findFreePort(preferred = 9222) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // preferred port busy, get a random free one
      const s2 = net.createServer();
      s2.listen(0, '127.0.0.1', () => {
        const { port } = s2.address();
        s2.close(() => resolve(port));
      });
      s2.on('error', reject);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch the URL of the most recently active page tab via Chrome's /json/list endpoint.
 * Chrome returns targets ordered by most-recently-activated first.
 * Returns the URL string, or null if no page target found.
 */
function fetchActivePageUrl(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, { timeout: 3000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const page = targets.find(t => t.type === 'page');
          resolve(page ? page.url : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { readStdin, die, probeCDP, findFreePort, sleep, fetchActivePageUrl };
