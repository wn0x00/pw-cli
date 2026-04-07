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

function loadStateModule(tempHome) {
  setHome(tempHome);
  const modulePath = require.resolve('../src/state');
  delete require.cache[modulePath];
  return require('../src/state');
}

test('state helpers persist and clear browser metadata', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-state-'));
  const state = loadStateModule(tempHome);

  const profileDir = state.getProfileDir('work');
  assert.equal(fs.existsSync(profileDir), true);

  state.writeState({ port: 9223, cdpUrl: 'http://127.0.0.1:9223', profile: 'work' });
  assert.deepEqual(state.readState(), {
    port: 9223,
    cdpUrl: 'http://127.0.0.1:9223',
    profile: 'work',
  });

  state.clearState();
  assert.equal(state.readState(), null);
});
