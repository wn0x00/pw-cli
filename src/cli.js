'use strict';

const { getConnection, killBrowser } = require('./browser-manager');
const { execCode, execScript } = require('./executor');
const { readState } = require('./state');
const { readStdin, die, probeCDP } = require('./utils');

function parseArgs(argv) {
  const global = { headless: false, profile: 'default', port: 9222 };
  const rest = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--headless') {
      global.headless = true;
    } else if (arg === '--profile' && argv[i + 1]) {
      global.profile = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      global.port = parseInt(argv[++i], 10);
    } else {
      rest.push(arg);
    }
    i++;
  }

  return { global, rest };
}

async function cmdRunCode(rest, opts) {
  let code;

  if (rest.length > 0) {
    code = rest.join(' ');
  } else if (!process.stdin.isTTY) {
    code = await readStdin();
  } else {
    die('No code provided. Pass inline or pipe via stdin.\n\nExamples:\n  pw-cli run-code "await page.goto(\'https://example.com\')"\n  cat script.js | pw-cli run-code');
  }

  if (!code) die('Empty code provided.');

  const conn = await getConnection(opts);
  try {
    const result = await execCode(code, conn);
    if (result !== undefined) {
      console.log(result);
    }
  } finally {
    await conn.browser.close(); // disconnect only, browser keeps running
  }
}

function getRunScriptHelp() {
  return `Usage:
  pw-cli run-script <file.js> [args...]

What the script receives:
  - Playwright globals: page, context, browser, playwright
  - Script args array: args
  - CommonJS globals: require, module, exports, __filename, __dirname

Example:
  pw-cli run-script ./scripts/extract-links.js --url https://example.com --output links.json`;
}

async function cmdRunScript(rest, opts) {
  const [scriptPath, ...scriptArgs] = rest;
  if (!scriptPath) {
    die(`No script path provided.\n\n${getRunScriptHelp()}`);
  }

  const conn = await getConnection(opts);
  try {
    const result = await execScript(scriptPath, scriptArgs, conn);
    if (result !== undefined) {
      console.log(result);
    }
  } finally {
    await conn.browser.close();
  }
}

async function cmdKill() {
  const killed = await killBrowser();
  console.log(killed ? 'Browser stopped.' : 'No browser running.');
}

async function cmdStatus() {
  const state = readState();
  if (!state) {
    console.log('Status: stopped');
    return;
  }
  const alive = await probeCDP(state.port, 2000);
  if (alive) {
    console.log(`Status: running`);
    console.log(`  CDP:     ${state.cdpUrl}`);
    console.log(`  Profile: ${state.profile || 'default'}`);
  } else {
    console.log('Status: stopped (stale state file cleared)');
    const { clearState } = require('./state');
    clearState();
  }
}

function printHelp() {
  console.log(`
pw-cli — Persistent Playwright browser CLI

USAGE
  pw-cli [--headless] [--profile <name>] [--port <number>] <command> [...]

GLOBAL OPTIONS
  --headless          Run browser headlessly (default: headed)
  --profile <name>    Named profile to use (default: "default")
  --port <number>     CDP port (default: 9222)

COMMANDS
  run-code [code]          Execute inline JS (reads stdin if omitted)
  run-script <file> [...]  Execute a local .js file with Playwright globals and script args
  kill                     Stop the running browser
  status                   Show browser status

SCRIPT GLOBALS
  page, context, browser, playwright, args
  require, module, exports, __filename, __dirname

EXAMPLES
  pw-cli run-code "await page.goto('https://example.com'); console.log(await page.title())"
  echo "await page.screenshot({ path: 'out.png' })" | pw-cli run-code
  pw-cli run-script ./scrape.js --url https://example.com
  pw-cli run-script ./scripts/extract-links.js --url https://example.com --output links.json
  pw-cli --headless run-code "await page.goto('https://example.com')"
  pw-cli --profile work status
  pw-cli kill

RUN-SCRIPT EXAMPLE
  // scripts/extract-links.js
  const fs = require('fs');
  const url = args[args.indexOf('--url') + 1] || 'https://example.com';
  const output = args[args.indexOf('--output') + 1] || 'links.json';
  await page.goto(url, { waitUntil: 'networkidle' });
  const links = await page.locator('a').evaluateAll(nodes =>
    nodes.map(a => ({ text: a.textContent.trim(), href: a.href })).filter(x => x.href)
  );
  fs.writeFileSync(output, JSON.stringify({ url, count: links.length, links }, null, 2));
  return \`saved \${links.length} links to \${output}\`;
`.trim());
}

async function run(argv) {
  const { global: opts, rest } = parseArgs(argv);
  const [command, ...cmdArgs] = rest;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'run-scirpt') {
    console.error('Unknown command: run-scirpt');
    console.error('Did you mean: run-script?\n');
    console.log(getRunScriptHelp());
    process.exit(1);
  }

  try {
    switch (command) {
      case 'run-code':
        await cmdRunCode(cmdArgs, opts);
        break;
      case 'run-script':
        await cmdRunScript(cmdArgs, opts);
        break;
      case 'kill':
        await cmdKill();
        break;
      case 'status':
        await cmdStatus();
        break;
      default:
        die(`Unknown command: ${command}\nRun "pw-cli help" for usage.`);
    }
  } catch (err) {
    if (err.code === 'ENOENT' && err.message.includes('Script not found')) {
      process.exit(3);
    }
    if (err.message && (err.message.includes('Target closed') || err.message.includes('Connection closed') || err.message.includes('Protocol error'))) {
      const { clearState } = require('./state');
      clearState();
      process.stderr.write(`pw-cli error: Browser disconnected unexpectedly. Run the command again to relaunch.\n\nDetails: ${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`pw-cli error: ${err.message || err}\n`);
    process.exit(1);
  }
  // Force exit: playwright CDP connections keep the event loop alive
  process.exit(0);
}

module.exports = { run };
