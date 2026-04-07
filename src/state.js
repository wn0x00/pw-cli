'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function getPwCliDir() {
  return path.join(os.homedir(), '.pw-cli');
}

function getStateFile() {
  return path.join(getPwCliDir(), 'browser.json');
}

function getProfileDir(profile = 'default') {
  const dir = path.join(getPwCliDir(), 'profiles', profile);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readState() {
  try {
    const raw = fs.readFileSync(getStateFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(state) {
  const dir = getPwCliDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = getStateFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function clearState() {
  try {
    fs.unlinkSync(getStateFile());
  } catch {
    // already gone
  }
}

module.exports = { getPwCliDir, getProfileDir, readState, writeState, clearState };
