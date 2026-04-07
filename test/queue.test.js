'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setHome(tempHome) {
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = path.parse(tempHome).root.replace(/\\$/, '');
  process.env.HOMEPATH = tempHome.slice(process.env.HOMEDRIVE.length) || '\\';
}

function loadQueueModule(tempHome) {
  setHome(tempHome);
  const modulePath = require.resolve('../src/queue');
  delete require.cache[modulePath];
  return require('../src/queue');
}

test('queue add, read, remove, and clear work against isolated home directory', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-queue-'));
  const queue = loadQueueModule(tempHome);

  const first = queue.addItem('run-code', ['console.log(1)']);
  const second = queue.addItem('status', []);

  const items = queue.readQueue();
  assert.equal(items.length, 2);
  assert.equal(items[0].id, first.id);
  assert.equal(items[1].id, second.id);

  const removed = queue.removeItem(first.id.slice(0, 6));
  assert.equal(removed.id, first.id);
  assert.equal(queue.readQueue().length, 1);

  queue.clearQueue();
  assert.deepEqual(queue.readQueue(), []);
});
