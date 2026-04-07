'use strict';

// This script is spawned as a detached child process.
// It launches a persistent Chromium browser and holds it open.
// It signals readiness by writing "READY:<port>\n" to stdout.
// Args: --profile-dir <dir> --port <port> [--headless]

const args = process.argv.slice(2);
const path = require('path');
const { execSync } = require('child_process');

function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const profileDir = getArg('--profile-dir');
const port = parseInt(getArg('--port') || '9222', 10);
const headless = args.includes('--headless');

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

  throw new Error('playwright not found - run: npm install -g playwright');
}

function formatLaunchError(error) {
  const message = error && error.message ? error.message : String(error);
  if (message.includes("Executable doesn't exist")) {
    return [
      'Playwright browser executable is not installed for the selected engine.',
      'pw-cli now prefers your local Chrome install for fallback launches.',
      'Run one of the following commands first:',
      '  pw-cli open',
      '  pw-cli install-browser',
      '  npx playwright install chromium',
    ].join('\n');
  }
  return message;
}

if (!profileDir) {
  process.stderr.write('ERROR:missing --profile-dir\n');
  process.exit(1);
}

(async () => {
  try {
    const playwright = loadPlaywright();
    const context = await playwright.chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      args: [`--remote-debugging-port=${port}`],
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
    });

    // Wait briefly for CDP to be ready, then signal
    const { probeCDP, sleep } = require('./utils');
    let ready = false;
    for (let i = 0; i < 20; i++) {
      if (await probeCDP(port, 1000)) { ready = true; break; }
      await sleep(300);
    }

    if (!ready) {
      process.stdout.write(`ERROR:CDP not available on port ${port} after launch\n`);
      await context.close();
      process.exit(1);
    }

    process.stdout.write(`READY:${port}\n`);

    // Keep process alive until browser closes
    context.on('close', () => process.exit(0));

    // Prevent premature exit
    process.stdin.resume();
  } catch (e) {
    process.stdout.write(`ERROR:${formatLaunchError(e)}\n`);
    process.exit(1);
  }
})();
