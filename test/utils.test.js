'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { findFreePort, probeCDP } = require('../src/utils');

test('findFreePort returns an available port', async () => {
  const port = await findFreePort(0);
  assert.equal(Number.isInteger(port), true);
  assert.ok(port > 0);
});

test('probeCDP detects a reachable devtools endpoint', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'test' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    assert.equal(await probeCDP(port, 1000), true);
    assert.equal(await probeCDP(port + 1, 100), false);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
