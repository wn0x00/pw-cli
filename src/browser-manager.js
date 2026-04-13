'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { readState, writeState, clearState, getProfileDir } = require('./state');
const { probeCDP, findFreePort, sleep, fetchActivePageUrl } = require('./utils');

function loadPlaywrightUtilsBundle() {
  // playwright-core's package.json "exports" blocks deep subpath requires, so
  // we locate the package root via require.resolve on package.json, then load
  // the internal module by absolute path.
  const searchPaths = [
    path.join(__dirname, '..'),                           // local dev
    path.join(__dirname, '..', 'node_modules', '@playwright', 'cli'),  // nested under pw-cli
  ];

  // Also search from the global npm root where @playwright/cli might live
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    searchPaths.push(path.join(globalRoot, '@playwright', 'cli'));
    searchPaths.push(globalRoot);
  } catch {}

  for (const searchPath of searchPaths) {
    try {
      const pkgJson = require.resolve('playwright-core/package.json', { paths: [searchPath] });
      const utilsBundle = path.join(path.dirname(pkgJson), 'lib', 'utilsBundleImpl');
      return require(utilsBundle);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
        throw error;
      }
    }
  }

  throw new Error('Unable to load playwright-core utilsBundleImpl. Reinstall @playwright/cli or playwright.');
}

const { ws, wsServer } = loadPlaywrightUtilsBundle();

const DAEMON_SCRIPT = path.join(__dirname, 'launch-daemon.js');

// ---------------------------------------------------------------------------
// playwright-cli session integration
// ---------------------------------------------------------------------------
const HOME_DIR = os.homedir();
const PW_CLI_DIR = path.join(HOME_DIR, '.pw-cli');
const WORKSPACE_HASH = crypto.createHash('sha1')
  .update(PW_CLI_DIR)
  .digest('hex')
  .substring(0, 16);

function getDaemonDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local'), 'ms-playwright', 'daemon');
  } else if (process.platform === 'darwin') {
    return path.join(HOME_DIR, 'Library', 'Caches', 'ms-playwright', 'daemon');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(HOME_DIR, '.cache'), 'ms-playwright', 'daemon');
}

function readPlaywrightCliSession(sessionName = 'default') {
  const sessionFile = path.join(getDaemonDir(), WORKSPACE_HASH, `${sessionName}.session`);
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  } catch {
    return null;
  }
}

function getPlaywrightCliCdpPort(sessionName = 'default') {
  const session = readPlaywrightCliSession(sessionName);
  return session?.resolvedConfig?.browser?.launchOptions?.cdpPort || null;
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {}

  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const cliPlaywrightPath = path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright');
    return require(cliPlaywrightPath);
  } catch {}

  throw new Error('playwright is not installed. Run: npm install -g playwright');
}

function normalizeExtensionBrowser(extension) {
  if (typeof extension === 'string' && extension.trim()) {
    return extension.trim();
  }
  return 'chrome';
}

function buildExtensionConnectHeaders(extension) {
  const browser = normalizeExtensionBrowser(extension);
  const browserType = 'chromium';
  const launchOptions = browser !== 'chromium' ? { channel: browser } : {};

  return {
    browserType,
    headers: {
      'x-playwright-browser': browserType,
      'x-playwright-launch-options': JSON.stringify(launchOptions),
    },
  };
}

function pickPage(pages, activeUrl) {
  if (!pages || pages.length === 0) return null;
  if (activeUrl) {
    const matchingPages = pages.filter(page => {
      try {
        return page.url() === activeUrl;
      } catch {
        return false;
      }
    });
    if (matchingPages.length > 0) {
      return matchingPages[matchingPages.length - 1];
    }
  }
  return pages[pages.length - 1];
}

async function resolveContextAndPage(browser, cdpPort) {
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const pages = context.pages();
  const activeUrl = cdpPort ? await fetchActivePageUrl(cdpPort) : null;
  const page = pickPage(pages, activeUrl) || await context.newPage();
  return { context, page };
}

function getBrowserExecutableCandidates(browser) {
  switch (browser) {
    case 'msedge':
      return process.platform === 'win32'
        ? [
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ]
        : [];
    case 'chromium':
    case 'chrome':
    default:
      return process.platform === 'win32'
        ? [
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ]
        : [];
  }
}

function resolveExtensionExecutablePath(browser) {
  if (process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH;
  }

  const candidates = getBrowserExecutableCandidates(browser);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to find executable for browser channel "${browser}". Set PLAYWRIGHT_MCP_EXECUTABLE_PATH or install ${browser}.`);
}

class ManualPromise {
  constructor() {
    this._settled = false;
    this.promise = new Promise((resolve, reject) => {
      this._resolve = value => {
        if (this._settled) return;
        this._settled = true;
        resolve(value);
      };
      this._reject = error => {
        if (this._settled) return;
        this._settled = true;
        reject(error);
      };
    });
  }

  resolve(value) {
    this._resolve(value);
  }

  reject(error) {
    this._reject(error);
  }
}

class ExtensionConnection {
  constructor(socket) {
    this._socket = socket;
    this._callbacks = new Map();
    this._lastId = 0;
    this._socket.on('message', this._onMessage.bind(this));
    this._socket.on('close', this._onClose.bind(this));
    this._socket.on('error', this._onError.bind(this));
  }

  send(method, params) {
    if (this._socket.readyState !== ws.OPEN) {
      throw new Error(`Unexpected WebSocket state: ${this._socket.readyState}`);
    }

    const id = ++this._lastId;
    this._socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      this._callbacks.set(id, {
        resolve,
        reject,
        error: new Error(`Protocol error: ${method}`),
      });
    });
  }

  close(reason) {
    if (this._socket.readyState === ws.OPEN) {
      this._socket.close(1000, reason);
    }
  }

  _onMessage(message) {
    const object = JSON.parse(message.toString());

    if (object.id && this._callbacks.has(object.id)) {
      const callback = this._callbacks.get(object.id);
      this._callbacks.delete(object.id);
      if (object.error) {
        callback.error.message = object.error;
        callback.reject(callback.error);
      } else {
        callback.resolve(object.result);
      }
      return;
    }

    if (!object.id) {
      this.onmessage?.(object.method, object.params);
    }
  }

  _onClose() {
    for (const callback of this._callbacks.values()) {
      callback.reject(new Error('WebSocket closed'));
    }
    this._callbacks.clear();
    this.onclose?.(this, 'WebSocket closed');
  }

  _onError() {
    for (const callback of this._callbacks.values()) {
      callback.reject(new Error('WebSocket error'));
    }
    this._callbacks.clear();
  }
}

class CDPRelayServer {
  constructor(server, browserChannel, userDataDir, executablePath, extensionToken) {
    this._playwrightConnection = null;
    this._extensionConnection = null;
    this._nextSessionId = 1;
    this._browserChannel = browserChannel;
    this._userDataDir = userDataDir;
    this._executablePath = executablePath;
    this._extensionToken = extensionToken || null;
    const uuid = crypto.randomUUID();
    const address = server.address();
    this._wsHost = `ws://127.0.0.1:${address.port}`;
    this._cdpPath = `/cdp/${uuid}`;
    this._extensionPath = `/extension/${uuid}`;
    this._resetExtensionConnection();
    this._wss = new wsServer({ server });
    this._wss.on('connection', this._onConnection.bind(this));
  }

  cdpEndpoint() {
    return `${this._wsHost}${this._cdpPath}`;
  }

  extensionEndpoint() {
    return `${this._wsHost}${this._extensionPath}`;
  }

  async ensureExtensionConnectionForMCPContext(clientName) {
    if (this._extensionConnection) return;
    this._connectBrowser(clientName);
    await Promise.race([
      this._extensionConnectionPromise.promise,
      new Promise((_, reject) => setTimeout(() => {
        reject(new Error('Extension connection timeout. Make sure the "Playwright MCP Bridge" extension is installed and enabled.'));
      }, 5000)),
    ]);
  }

  stop() {
    this.closeConnections('Server stopped');
    this._wss.close();
  }

  closeConnections(reason) {
    this._closePlaywrightConnection(reason);
    this._closeExtensionConnection(reason);
  }

  _connectBrowser(clientName) {
    const relayUrl = `${this._wsHost}${this._extensionPath}`;
    const url = new URL('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html');
    url.searchParams.set('mcpRelayUrl', relayUrl);
    url.searchParams.set('client', JSON.stringify({ name: clientName }));
    url.searchParams.set('protocolVersion', '1');
    if (this._extensionToken) {
      url.searchParams.set('token', this._extensionToken);
    }

    const executablePath = this._executablePath || resolveExtensionExecutablePath(this._browserChannel);
    const args = [];
    if (this._userDataDir) {
      args.push(`--user-data-dir=${this._userDataDir}`);
    }
    args.push(url.toString());

    const child = spawn(executablePath, args, {
      windowsHide: true,
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.unref();
  }

  _onConnection(socket, request) {
    const url = new URL(`http://localhost${request.url}`);
    if (url.pathname === this._cdpPath) {
      this._handlePlaywrightConnection(socket);
      return;
    }
    if (url.pathname === this._extensionPath) {
      if (this._extensionToken) {
        const token = url.searchParams.get('token');
        if (token !== this._extensionToken) {
          socket.close(4003, 'Invalid token');
          return;
        }
      }
      this._handleExtensionConnection(socket);
      return;
    }
    socket.close(4004, 'Invalid path');
  }

  _handlePlaywrightConnection(socket) {
    if (this._playwrightConnection) {
      socket.close(1000, 'Another CDP client already connected');
      return;
    }
    this._playwrightConnection = socket;
    socket.on('message', async data => {
      const message = JSON.parse(data.toString());
      try {
        const result = await this._handleCDPCommand(message.method, message.params, message.sessionId);
        this._sendToPlaywright({ id: message.id, sessionId: message.sessionId, result });
      } catch (error) {
        this._sendToPlaywright({
          id: message.id,
          sessionId: message.sessionId,
          error: { message: error.message },
        });
      }
    });
    socket.on('close', () => {
      if (this._playwrightConnection !== socket) return;
      this._playwrightConnection = null;
      this._closeExtensionConnection('Playwright client disconnected');
    });
  }

  _handleExtensionConnection(socket) {
    if (this._extensionConnection) {
      socket.close(1000, 'Another extension connection already established');
      return;
    }
    this._extensionConnection = new ExtensionConnection(socket);
    this._extensionConnection.onclose = current => {
      if (this._extensionConnection !== current) return;
      this._resetExtensionConnection();
      this._closePlaywrightConnection('Extension disconnected');
    };
    this._extensionConnection.onmessage = this._handleExtensionMessage.bind(this);
    this._extensionConnectionPromise.resolve();
  }

  _handleExtensionMessage(method, params) {
    if (method !== 'forwardCDPEvent') return;
    const sessionId = params.sessionId || this._connectedTabInfo?.sessionId;
    this._sendToPlaywright({
      sessionId,
      method: params.method,
      params: params.params,
    });
  }

  async _handleCDPCommand(method, params, sessionId) {
    switch (method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          userAgent: 'CDP-Bridge-Server/1.0.0',
        };
      case 'Browser.setDownloadBehavior':
        return {};
      case 'Target.setAutoAttach': {
        if (sessionId) break;
        const { targetInfo } = await this._extensionConnection.send('attachToTab', {});
        this._connectedTabInfo = {
          targetInfo,
          sessionId: `pw-tab-${this._nextSessionId++}`,
        };
        this._sendToPlaywright({
          method: 'Target.attachedToTarget',
          params: {
            sessionId: this._connectedTabInfo.sessionId,
            targetInfo: {
              ...this._connectedTabInfo.targetInfo,
              attached: true,
            },
            waitingForDebugger: false,
          },
        });
        return {};
      }
      case 'Target.getTargetInfo':
        return this._connectedTabInfo?.targetInfo;
      default:
        return this._forwardToExtension(method, params, sessionId);
    }
  }

  async _forwardToExtension(method, params, sessionId) {
    if (!this._extensionConnection) {
      throw new Error('Extension not connected');
    }
    if (this._connectedTabInfo?.sessionId === sessionId) {
      sessionId = undefined;
    }
    return this._extensionConnection.send('forwardCDPCommand', { sessionId, method, params });
  }

  _sendToPlaywright(message) {
    if (this._playwrightConnection?.readyState === ws.OPEN) {
      this._playwrightConnection.send(JSON.stringify(message));
    }
  }

  _closeExtensionConnection(reason) {
    this._extensionConnection?.close(reason);
    this._extensionConnectionPromise.reject(new Error(reason));
    this._resetExtensionConnection();
  }

  _resetExtensionConnection() {
    this._connectedTabInfo = undefined;
    this._extensionConnection = null;
    this._extensionConnectionPromise = new ManualPromise();
  }

  _closePlaywrightConnection(reason) {
    if (this._playwrightConnection?.readyState === ws.OPEN) {
      this._playwrightConnection.close(1000, reason);
    }
    this._playwrightConnection = null;
  }
}

async function startExtensionRelay(extension) {
  const browser = normalizeExtensionBrowser(extension);
  if (!['chrome', 'chromium', 'msedge'].includes(browser)) {
    throw new Error(`--extension currently supports Chromium-based channels only (received "${browser}")`);
  }

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const extensionToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || null;
  const relay = new CDPRelayServer(server, browser, null, null, extensionToken);
  await relay.ensureExtensionConnectionForMCPContext('pw-cli');
  return { relay, server };
}

async function getExtensionConnection(extension) {
  const playwright = loadPlaywright();
  const { relay, server } = await startExtensionRelay(extension);

  try {
    const browser = await playwright.chromium.connectOverCDP(relay.cdpEndpoint());
    const { context, page } = await resolveContextAndPage(browser, null);
    return {
      browser,
      context,
      page,
      playwright,
      close: async () => {
        relay.stop();
        await new Promise(resolve => server.close(resolve));
        await browser.close();
      },
    };
  } catch (error) {
    relay.stop();
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Our own CDP-based browser launcher (fallback when playwright-cli not running)
// ---------------------------------------------------------------------------
async function launchBrowser({ headless = false, profile = 'default', port: preferredPort = 9223 } = {}) {
  const profileDir = getProfileDir(profile);
  const port = await findFreePort(preferredPort);

  const daemonArgs = [
    DAEMON_SCRIPT,
    '--profile-dir', profileDir,
    '--port', String(port),
  ];
  if (headless) daemonArgs.push('--headless');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, daemonArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let output = '';
    const timer = setTimeout(() => {
      child.stdout.destroy();
      reject(new Error('Browser launch timed out (15s)'));
    }, 15000);

    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const readyMatch = output.match(/READY:(\d+)/);
      const errorMatch = output.match(/ERROR:(.*)/);

      if (readyMatch) {
        clearTimeout(timer);
        const actualPort = parseInt(readyMatch[1], 10);
        writeState({ port: actualPort, cdpUrl: `http://127.0.0.1:${actualPort}`, profile });
        child.unref();
        resolve(actualPort);
      } else if (errorMatch) {
        clearTimeout(timer);
        reject(new Error(`Browser launch failed: ${errorMatch[1]}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Daemon exited with code ${code}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// getConnection — tries playwright-cli browser first, then our own
// ---------------------------------------------------------------------------
async function getConnection({ headless = false, profile = 'default', port: preferredPort = 9223, extension = false } = {}) {
  if (extension) {
    return getExtensionConnection(extension);
  }

  const playwright = loadPlaywright();

  // 1. Try to reuse playwright-cli's browser via its CDP port
  const cliCdpPort = getPlaywrightCliCdpPort();
  if (cliCdpPort) {
    const alive = await probeCDP(cliCdpPort, 2000);
    if (alive) {
      try {
        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${cliCdpPort}`);
        const { context, page } = await resolveContextAndPage(browser, cliCdpPort);
        return {
          browser,
          context,
          page,
          playwright,
          close: async () => {
            await browser.close();
          },
        };
      } catch {
        // fall through to own browser
      }
    }
  }

  // 2. Try our own CDP browser (state file)
  let state = readState();
  let cdpUrl;

  if (state) {
    const alive = await probeCDP(state.port, 2000);
    if (alive) {
      cdpUrl = state.cdpUrl;
    } else {
      clearState();
      state = null;
    }
  }

  if (!state) {
    const port = await launchBrowser({ headless, profile, port: preferredPort });
    cdpUrl = `http://127.0.0.1:${port}`;
    await sleep(200);
  }

  const browser = await playwright.chromium.connectOverCDP(cdpUrl);
  const { context, page } = await resolveContextAndPage(browser, state ? state.port : null);

  return {
    browser,
    context,
    page,
    playwright,
    close: async () => {
      await browser.close();
    },
  };
}

async function killBrowser() {
  const state = readState();
  if (!state) return false;

  const alive = await probeCDP(state.port, 1000);
  if (alive) {
    try {
      const playwright = require('playwright');
      const browser = await playwright.chromium.connectOverCDP(state.cdpUrl);
      await browser.close();
    } catch { /* ignore */ }
  }

  clearState();
  return true;
}

module.exports = {
  getConnection,
  killBrowser,
  getPlaywrightCliCdpPort,
  pickPage,
  buildExtensionConnectHeaders,
  normalizeExtensionBrowser,
};
