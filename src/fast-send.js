'use strict';

const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOME_DIR = os.homedir();
const PW_CLI_DIR = path.join(HOME_DIR, '.pw-cli');
const WORKSPACE_HASH = crypto.createHash('sha1')
  .update(PW_CLI_DIR)
  .digest('hex')
  .substring(0, 16);

function getSocketPath(sessionName = 'default') {
  const socketName = `${sessionName}.sock`;
  if (os.platform() === 'win32')
    return `\\\\.\\pipe\\${WORKSPACE_HASH}-${socketName}`;
  const socketsDir = process.env.PLAYWRIGHT_DAEMON_SOCKETS_DIR || path.join(os.tmpdir(), 'playwright-cli');
  return path.join(socketsDir, WORKSPACE_HASH, socketName);
}

function getVersion() {
  // Read version from session file (already written by playwright-cli daemon)
  const sessionFile = path.join(
    os.platform() === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local'), 'ms-playwright', 'daemon')
      : os.platform() === 'darwin'
        ? path.join(HOME_DIR, 'Library', 'Caches', 'ms-playwright', 'daemon')
        : path.join(process.env.XDG_CACHE_HOME || path.join(HOME_DIR, '.cache'), 'ms-playwright', 'daemon'),
    WORKSPACE_HASH,
    'default.session'
  );
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    return session.version;
  } catch {
    return null;
  }
}

/**
 * Convert a string array to minimist-style object.
 * The daemon expects { _: [cmd, arg1, ...], flagName: value, ... }.
 */
function toMinimistArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

/**
 * Send a command directly to the playwright-cli daemon socket.
 * Returns { text, isError } or null (daemon not running).
 */
function sendCommand(args, sessionName = 'default') {
  const socketPath = getSocketPath(sessionName);
  const version = getVersion();
  if (!version) return Promise.resolve(null);

  const minimistArgs = toMinimistArgs(args);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      const message = JSON.stringify({
        id: 1,
        method: 'run',
        params: { args: minimistArgs, cwd: process.cwd() },
        version,
      }) + '\n';
      socket.write(message);
    });

    let buf = '';
    socket.on('data', chunk => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf('\n');
      if (nlIdx === -1) return;
      const line = buf.slice(0, nlIdx);
      clearTimeout(timer);
      socket.destroy();
      try {
        const resp = JSON.parse(line);
        if (resp.error) {
          reject(new Error(resp.error));
        } else {
          resolve(resp.result);
        }
      } catch (e) {
        reject(new Error('Invalid daemon response'));
      }
    });

    socket.on('error', () => { clearTimeout(timer); resolve(null); }); // connection failed = daemon not running
    const timer = setTimeout(() => { socket.destroy(); resolve(null); }, 3000);
  });
}

module.exports = { sendCommand, getSocketPath, getVersion };
