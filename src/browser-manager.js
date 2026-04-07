'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { readState, writeState, clearState, getProfileDir } = require('./state');
const { probeCDP, findFreePort, sleep, fetchActivePageUrl } = require('./utils');

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
async function getConnection({ headless = false, profile = 'default', port: preferredPort = 9223 } = {}) {
  const playwright = loadPlaywright();

  // 1. Try to reuse playwright-cli's browser via its CDP port
  const cliCdpPort = getPlaywrightCliCdpPort();
  if (cliCdpPort) {
    const alive = await probeCDP(cliCdpPort, 2000);
    if (alive) {
      try {
        const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${cliCdpPort}`);
        const { context, page } = await resolveContextAndPage(browser, cliCdpPort);
        return { browser, context, page, playwright };
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

  return { browser, context, page, playwright };
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

module.exports = { getConnection, killBrowser, getPlaywrightCliCdpPort, pickPage };
