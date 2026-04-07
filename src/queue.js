'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const HOME_DIR = os.homedir();
const PW_CLI_DIR = path.join(HOME_DIR, '.pw-cli');
const QUEUE_FILE = path.join(PW_CLI_DIR, 'queue.json');

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveQueue(items) {
  fs.mkdirSync(PW_CLI_DIR, { recursive: true });
  const tmp = QUEUE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tmp, QUEUE_FILE);
}

function addItem(command, args) {
  const queue = readQueue();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, command, args, addedAt: new Date().toISOString() };
  queue.push(item);
  saveQueue(queue);
  return item;
}

function removeItem(idPrefix) {
  const queue = readQueue();
  const idx = queue.findIndex(i => i.id === idPrefix || i.id.startsWith(idPrefix));
  if (idx === -1) return null;
  const [removed] = queue.splice(idx, 1);
  saveQueue(queue);
  return removed;
}

function clearQueue() {
  saveQueue([]);
}

module.exports = { readQueue, saveQueue, addItem, removeItem, clearQueue, QUEUE_FILE };
