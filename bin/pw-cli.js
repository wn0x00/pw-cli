#!/usr/bin/env node
'use strict';

process.on('uncaughtException', err => {
  process.stderr.write(`pw-cli fatal: ${err.message}\n`);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  process.stderr.write(`pw-cli fatal: ${err && err.message || err}\n`);
  process.exit(1);
});

const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Global session setup — makes playwright-cli always find the same session
// regardless of which directory pw-cli is run from.
// ---------------------------------------------------------------------------
const HOME_DIR = os.homedir();
const PW_CLI_DIR = path.join(HOME_DIR, '.pw-cli');
const DEFAULT_PROFILE = path.join(PW_CLI_DIR, 'profiles', 'default');
const PLAYWRIGHT_MARKER = path.join(PW_CLI_DIR, '.playwright'); // makes cwd a "workspace"

fs.mkdirSync(DEFAULT_PROFILE, { recursive: true });
fs.mkdirSync(PLAYWRIGHT_MARKER, { recursive: true });

// Compute session hash the same way playwright-cli does:
// sha1(workspaceDir).hex[:16]  where workspaceDir = PW_CLI_DIR
const WORKSPACE_HASH = crypto.createHash('sha1')
  .update(PW_CLI_DIR)
  .digest('hex')
  .substring(0, 16);

// Locate @playwright/cli via npm global root
function findPlaywrightCli() {
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const cliEntry = path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright', 'lib', 'cli', 'client', 'program.js');
    if (fs.existsSync(cliEntry)) return cliEntry;
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Daemon session file location  (Windows / macOS / Linux)
// ---------------------------------------------------------------------------
function getDaemonDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local'), 'ms-playwright', 'daemon');
  } else if (process.platform === 'darwin') {
    return path.join(HOME_DIR, 'Library', 'Caches', 'ms-playwright', 'daemon');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(HOME_DIR, '.cache'), 'ms-playwright', 'daemon');
}

function isSessionFilePresent(sessionName = 'default') {
  const sessionFile = path.join(getDaemonDir(), WORKSPACE_HASH, `${sessionName}.session`);
  return fs.existsSync(sessionFile);
}

async function isSessionAlive(sessionName = 'default') {
  if (!isSessionFilePresent(sessionName)) return false;
  // probe the named pipe / socket
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\${WORKSPACE_HASH}-${sessionName}.sock`
    : path.join(process.env.PLAYWRIGHT_DAEMON_SOCKETS_DIR || path.join(os.tmpdir(), 'playwright-cli'), WORKSPACE_HASH, `${sessionName}.sock`);
  return new Promise(resolve => {
    const s = net.connect(socketPath);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1500);
  });
}

// ---------------------------------------------------------------------------
// Argv helpers
// ---------------------------------------------------------------------------
function hasFlag(argv, ...flags) {
  return flags.some(f => argv.includes(f));
}

function injectOpenDefaults(argv) {
  const result = [...argv];
  // inject --headed unless explicitly suppressed
  if (!hasFlag(result, '--headed', '--no-headed')) {
    result.push('--headed');
  }
  // inject persistent + default profile unless user specified their own
  if (!hasFlag(result, '--persistent', '--no-persistent', '--profile')) {
    result.push('--persistent', '--profile', DEFAULT_PROFILE);
  } else if (hasFlag(result, '--profile') && !hasFlag(result, '--persistent', '--no-persistent')) {
    result.push('--persistent');
  }
  return result;
}

function getCommandAndSession(argv) {
  // find session flag
  let session = 'default';
  const sIdx = argv.findIndex(a => a === '-s' || a === '--session');
  if (sIdx !== -1 && argv[sIdx + 1]) session = argv[sIdx + 1];
  const sEq = argv.find(a => a.startsWith('-s=') || a.startsWith('--session='));
  if (sEq) session = sEq.split('=')[1];

  // first non-flag positional is the command
  const command = argv.find(a => !a.startsWith('-') && !/^\d/.test(a));
  return { command, session };
}

function parsePwCliGlobalOptions(argv) {
  const options = { headless: false, profile: 'default', port: 9223, extension: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--extension') {
      options.extension = true;
    } else if (arg.startsWith('--extension=')) {
      options.extension = arg.split('=')[1] || true;
    } else if (arg === '--profile' && argv[i + 1]) {
      options.profile = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      options.port = parseInt(argv[++i], 10);
    }
  }

  return options;
}

function printMainHelp() {
  process.stdout.write(`pw-cli - run Playwright terminal commands with pw-cli enhancements

Usage: pw-cli <command> [args] [options]
Usage: pw-cli -s=<session> <command> [args] [options]

pw-cli wraps @playwright/cli and keeps its command model. It also adds:
  - headed + persistent defaults for browser open flows
  - auto-open when a browser-backed command needs a session
  - run-code from stdin or inline JavaScript
  - run-script for local .js files
  - queue subcommands for batching commands
  - XPath support for click/dblclick/hover/fill/check/uncheck/select/drag

Core:
  open [url]                  open the browser
                              pw-cli: injects headed + persistent defaults
                              pw-cli: if url is provided, opens first and then navigates
  close                       close the browser
  goto <url>                  navigate to a url
  type <text>                 type text into editable element
  click <ref> [button]        perform click on a web page
                              pw-cli: accepts XPath ref
  dblclick <ref> [button]     perform double click on a web page
                              pw-cli: accepts XPath ref
  fill <ref> <text>           fill text into editable element
                              pw-cli: accepts XPath ref
  drag <startRef> <endRef>    perform drag and drop between two elements
                              pw-cli: accepts XPath refs
  hover <ref>                 hover over element on page
                              pw-cli: accepts XPath ref
  select <ref> <val>          select an option in a dropdown
                              pw-cli: accepts XPath ref
  upload <file>               upload one or multiple files
  check <ref>                 check a checkbox or radio button
                              pw-cli: accepts XPath ref
  uncheck <ref>               uncheck a checkbox or radio button
                              pw-cli: accepts XPath ref
  snapshot                    capture page snapshot to obtain element ref
  eval <func> [ref]           evaluate javascript expression on page or element
  dialog-accept [prompt]      accept a dialog
  dialog-dismiss              dismiss a dialog
  resize <w> <h>              resize the browser window
  delete-data                 delete session data

Navigation:
  go-back                     go back to the previous page
  go-forward                  go forward to the next page
  reload                      reload the current page

Keyboard:
  press <key>                 press a key on the keyboard, \`a\`, \`arrowleft\`
  keydown <key>               press a key down on the keyboard
  keyup <key>                 press a key up on the keyboard

Mouse:
  mousemove <x> <y>           move mouse to a given position
  mousedown [button]          press mouse down
  mouseup [button]            press mouse up
  mousewheel <dx> <dy>        scroll mouse wheel

Save as:
  screenshot [ref]            screenshot of the current page or element
  pdf                         save page as pdf

Tabs:
  tab-list                    list all tabs
  tab-new [url]               create a new tab
  tab-close [index]           close a browser tab
  tab-select <index>          select a browser tab

Storage:
  state-load <filename>       loads browser storage (authentication) state from a file
  state-save [filename]       saves the current storage (authentication) state to a file
  cookie-list                 list all cookies (optionally filtered by domain/path)
  cookie-get <name>           get a specific cookie by name
  cookie-set <name> <value>   set a cookie with optional flags
  cookie-delete <name>        delete a specific cookie
  cookie-clear                clear all cookies
  localstorage-list           list all localstorage key-value pairs
  localstorage-get <key>      get a localstorage item by key
  localstorage-set <key> <value> set a localstorage item
  localstorage-delete <key>   delete a localstorage item
  localstorage-clear          clear all localstorage
  sessionstorage-list         list all sessionstorage key-value pairs
  sessionstorage-get <key>    get a sessionstorage item by key
  sessionstorage-set <key> <value> set a sessionstorage item
  sessionstorage-delete <key> delete a sessionstorage item
  sessionstorage-clear        clear all sessionstorage

Network:
  route <pattern>             mock network requests matching a url pattern
  route-list                  list all active network routes
  unroute [pattern]           remove routes matching a pattern (or all routes)

DevTools:
  console [min-level]         list console messages
  run-code <code>             run playwright code snippet
                              pw-cli: reads code from stdin when <code> is omitted
                              pw-cli: wraps plain statements in an async function
  run-script <file> [...]     run a local JavaScript file with Playwright globals and script args
  network                     list all network requests since loading the page
  tracing-start               start trace recording
  tracing-stop                stop trace recording
  video-start                 start video recording
  video-stop                  stop video recording
  show                        show browser devtools
  devtools-start              show browser devtools

Install:
  install                     initialize workspace
  install-browser             install browser

Browser sessions:
  list                        list browser sessions
  close-all                   close all browser sessions
  kill-all                    forcefully kill all browser sessions (for stale/zombie processes)

pw-cli queue:
  queue add <command> [args...]   add a command to the queue
  queue list                      show queued commands
  queue run [--fail-fast]         execute queued commands in order
  queue remove <id>               remove a queued command by id prefix
  queue clear                     clear the queue

Global options:
  --help [command]            print help
  -h                          print help
  --version                   print version
  -s, --session <name>        choose browser session
  --headless                  used by pw-cli-managed browser launches
  --extension[=browser]       run scripts/code through Playwright MCP Bridge (default browser: chrome)

Requirements:
  Node.js 18+
  playwright
  @playwright/cli

Examples:
  pw-cli open https://example.com
  pw-cli run-code "await page.goto('https://example.com'); return await page.title()"
  echo "return await page.url()" | pw-cli run-code
  pw-cli run-script .\\scripts\\smoke.js --env prod
  pw-cli run-script .\\scripts\\extract-links.js --url https://example.com --output links.json
  pw-cli click "//button[contains(., 'Submit')]"
  pw-cli queue add goto https://example.com
  pw-cli queue add snapshot
  pw-cli queue run

run-script example:
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
`.trim() + '\n');
}

function getRunScriptHelpText() {
  return `Usage:
  pw-cli run-script <file.js> [args...]

What the script receives:
  - Playwright globals: page, context, browser, playwright
  - Script args array: args
  - CommonJS globals: require, module, exports, __filename, __dirname

Example:
  pw-cli run-script ./scripts/extract-links.js --url https://example.com --output links.json
  pw-cli run-script --extension ./scripts/extract-links.js --url https://example.com
`;
}

const REQUIRED_POSITIONAL_ARGS = new Map([
  ['goto', { count: 1, usage: 'pw-cli goto <url>' }],
  ['type', { count: 1, usage: 'pw-cli type <text>' }],
  ['click', { count: 1, usage: 'pw-cli click <ref> [button]' }],
  ['dblclick', { count: 1, usage: 'pw-cli dblclick <ref> [button]' }],
  ['fill', { count: 2, usage: 'pw-cli fill <ref> <text>' }],
  ['drag', { count: 2, usage: 'pw-cli drag <startRef> <endRef>' }],
  ['hover', { count: 1, usage: 'pw-cli hover <ref>' }],
  ['select', { count: 2, usage: 'pw-cli select <ref> <value>' }],
  ['upload', { count: 1, usage: 'pw-cli upload <file>' }],
  ['check', { count: 1, usage: 'pw-cli check <ref>' }],
  ['uncheck', { count: 1, usage: 'pw-cli uncheck <ref>' }],
  ['eval', { count: 1, usage: 'pw-cli eval <func> [ref]' }],
  ['resize', { count: 2, usage: 'pw-cli resize <width> <height>' }],
  ['press', { count: 1, usage: 'pw-cli press <key>' }],
  ['keydown', { count: 1, usage: 'pw-cli keydown <key>' }],
  ['keyup', { count: 1, usage: 'pw-cli keyup <key>' }],
  ['mousemove', { count: 2, usage: 'pw-cli mousemove <x> <y>' }],
  ['mousewheel', { count: 2, usage: 'pw-cli mousewheel <dx> <dy>' }],
  ['tab-select', { count: 1, usage: 'pw-cli tab-select <index>' }],
  ['cookie-get', { count: 1, usage: 'pw-cli cookie-get <name>' }],
  ['cookie-set', { count: 2, usage: 'pw-cli cookie-set <name> <value>' }],
  ['cookie-delete', { count: 1, usage: 'pw-cli cookie-delete <name>' }],
  ['localstorage-get', { count: 1, usage: 'pw-cli localstorage-get <key>' }],
  ['localstorage-set', { count: 2, usage: 'pw-cli localstorage-set <key> <value>' }],
  ['localstorage-delete', { count: 1, usage: 'pw-cli localstorage-delete <key>' }],
  ['sessionstorage-get', { count: 1, usage: 'pw-cli sessionstorage-get <key>' }],
  ['sessionstorage-set', { count: 2, usage: 'pw-cli sessionstorage-set <key> <value>' }],
  ['sessionstorage-delete', { count: 1, usage: 'pw-cli sessionstorage-delete <key>' }],
  ['route', { count: 1, usage: 'pw-cli route <pattern>' }],
]);

function getPositionalsAfterCommand(argv, command) {
  const commandIdx = argv.indexOf(command);
  if (commandIdx === -1) return [];

  const positionals = [];
  for (let i = commandIdx + 1; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== 'string' || arg.length === 0) continue;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1).filter(Boolean));
      break;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }
  return positionals;
}

function validateRequiredArgs(argv, command) {
  const rule = REQUIRED_POSITIONAL_ARGS.get(command);
  if (!rule) return;

  const positionals = getPositionalsAfterCommand(argv, command);
  if (positionals.length >= rule.count) return;

  process.stderr.write(`pw-cli: ${command} requires ${rule.count === 1 ? 'an argument' : `${rule.count} arguments`}\n\nUsage: ${rule.usage}\n`);
  process.exit(1);
}

// Management commands that don't need a running browser
const MGMT_COMMANDS = new Set([
  'open', 'close', 'list', 'kill-all', 'close-all', 'delete-data',
  'install', 'install-browser', 'show', 'config-print', 'tray',
  'queue',
]);

// ---------------------------------------------------------------------------
// Auto-open: launches playwright-cli open with defaults if no session running
// ---------------------------------------------------------------------------
function autoOpen(session) {
  const { spawnSync } = require('child_process');
  const cliPath = findPlaywrightCli();
  if (!cliPath) {
    process.stderr.write('pw-cli: @playwright/cli not found. Install with: npm install -g @playwright/cli\n');
    process.exit(1);
  }
  const openArgv = [
    'node', 'pw-cli',
    ...(session !== 'default' ? ['-s', session] : []),
    'open',
    '--headed', '--persistent', '--profile', DEFAULT_PROFILE,
  ];
  process.chdir(PW_CLI_DIR);
  const prog = require(cliPath); // runs synchronously until browser ready
  // playwright-cli's program() is async and calls process.exit when done,
  // but "open" detaches the daemon – so we need to wait a beat.
  // Instead, spawn a separate node process synchronously.
  // Reset and re-approach: spawn as a child.
  // (Require approach won't work cleanly for open — see delegation below)
  void prog; // unused, actual open is done via spawnSync below
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

// Wrap raw code in async function if not already a function expression
function wrapCodeIfNeeded(code) {
  const t = code.trim();
  // Match: async (page) => ..., async function, (async ..., function, async page => ...
  if (/^async\s*[\w(]|^async\s+function|^\(async|^function/.test(t)) return t;
  return `async (page) => {\n${code}\n}`;
}

// ---------------------------------------------------------------------------
// XPath support
// ---------------------------------------------------------------------------

// 检测是否为 XPath 表达式
function isXPath(str) {
  if (!str || typeof str !== 'string') return false;
  const t = str.trim();
  return t.startsWith('//') || t.startsWith('(//') || t.startsWith('xpath=');
}

// 标准化为 xpath=... 格式
function toXPathLocator(str) {
  const t = str.trim();
  if (t.startsWith('xpath=')) return t;
  return `xpath=${t}`;
}

// 用单引号包裹字符串（单引号本身用 \' 转义），避免双引号与 minimist 解析冲突
function jsStr(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// locator 表达式片段
function xpathLocator(ref) {
  return `page.locator(${jsStr(toXPathLocator(ref))})`;
}

// 各命令转 run-code 代码的映射
// 返回 JS 代码字符串，或 null 表示无需转换
function buildXPathCode(command, positionals, flags) {
  const buttonFlag = flags['--button'] || flags['-b'];
  const forceFlag  = flags['--force']  || flags['-f'];

  switch (command) {
    case 'click':
    case 'dblclick': {
      const [ref] = positionals;
      if (!isXPath(ref) && !forceFlag) return null;
      const method = command === 'dblclick' ? 'dblclick' : 'click';
      const locator = isXPath(ref)
        ? xpathLocator(ref)
        : `page.locator(${jsStr('aria-ref=' + ref)})`;
      const opts = [];
      if (buttonFlag) opts.push(`button: ${jsStr(buttonFlag)}`);
      if (forceFlag)  opts.push('force: true');
      const optsStr = opts.length ? `{ ${opts.join(', ')} }` : '';
      return `await ${locator}.${method}(${optsStr})`;
    }
    case 'hover': {
      const [ref] = positionals;
      if (!isXPath(ref)) return null;
      return `await ${xpathLocator(ref)}.hover()`;
    }
    case 'fill': {
      const [ref, text] = positionals;
      if (!isXPath(ref)) return null;
      return `await ${xpathLocator(ref)}.fill(${jsStr(text || '')})`;
    }
    case 'check': {
      const [ref] = positionals;
      if (!isXPath(ref)) return null;
      return `await ${xpathLocator(ref)}.check()`;
    }
    case 'uncheck': {
      const [ref] = positionals;
      if (!isXPath(ref)) return null;
      return `await ${xpathLocator(ref)}.uncheck()`;
    }
    case 'select': {
      const [ref, value] = positionals;
      if (!isXPath(ref)) return null;
      return `await ${xpathLocator(ref)}.selectOption(${jsStr(value || '')})`;
    }
    case 'drag': {
      const [startRef, endRef] = positionals;
      if (!isXPath(startRef) && !isXPath(endRef)) return null;
      // 任意一端是 XPath 就整条转换；非 XPath 端保持 aria-ref 格式
      const srcLocator = isXPath(startRef)
        ? xpathLocator(startRef)
        : `page.locator(${jsStr(`aria-ref=${startRef}`)})`;
      const dstLocator = isXPath(endRef)
        ? xpathLocator(endRef)
        : `page.locator(${jsStr(`aria-ref=${endRef}`)})`;
      return `await ${srcLocator}.dragTo(${dstLocator})`;
    }
    default:
      return null;
  }
}

const XPATH_COMMANDS = new Set(['click', 'dblclick', 'hover', 'fill', 'check', 'uncheck', 'select', 'drag']);

// 主入口：检测 argv 中是否有 XPath ref，有则整条命令转为 run-code
function convertXPathCommand(argv) {
  const cmdIdx = argv.findIndex(a => XPATH_COMMANDS.has(a));
  if (cmdIdx === -1) return argv;

  const command = argv[cmdIdx];
  const afterCmd = argv.slice(cmdIdx + 1);

  // 分离 positionals 和 flags
  const positionals = [];
  const flags = {};
  for (let i = 0; i < afterCmd.length; i++) {
    const arg  = afterCmd[i];
    const next = afterCmd[i + 1];
    if (arg.startsWith('--') && next && !next.startsWith('-')) {
      flags[arg] = next;
      i++;
    } else if (arg.startsWith('-') && arg.length === 2 && next && !next.startsWith('-')) {
      flags[arg] = next;
      i++;
    } else if (arg.startsWith('-')) {
      flags[arg] = true; // 布尔标志，如 --force
    } else {
      positionals.push(arg);
    }
  }

  const code = buildXPathCode(command, positionals, flags);
  if (!code) return argv; // 没有 XPath，原样返回

  // 保留命令前的全局参数（session 等），替换为 run-code
  const beforeCmd = argv.slice(0, cmdIdx);
  const wrappedCode = `async (page) => { ${code} }`;
  return [...beforeCmd, 'run-code', wrappedCode];
}

// ---------------------------------------------------------------------------
// queue — batch multiple actions and run them together
// ---------------------------------------------------------------------------
async function handleQueue(rawArgv) {
  const { readQueue, addItem, removeItem, clearQueue } = require('../src/queue');
  const { spawnSync } = require('child_process');

  const queueIdx = rawArgv.indexOf('queue');
  const globalArgs = rawArgv.slice(0, queueIdx);   // e.g. ['-s', 'work']
  const subCmd = rawArgv[queueIdx + 1];
  const rest = rawArgv.slice(queueIdx + 2);

  switch (subCmd) {
    case 'add': {
      if (!rest.length) {
        process.stderr.write('pw-cli: queue add requires a command\n\nUsage: pw-cli queue add <command> [args...]\n');
        process.exit(1);
      }
      const [command, ...args] = rest;
      const item = addItem(command, args);
      console.log(`queued [${item.id}] ${command}${args.length ? ' ' + args.join(' ') : ''}`);
      break;
    }

    case 'list': {
      const queue = readQueue();
      if (!queue.length) {
        console.log('Queue is empty.');
        break;
      }
      console.log(`Queue (${queue.length} item${queue.length === 1 ? '' : 's'}):`);
      queue.forEach((item, i) => {
        const argStr = item.args && item.args.length ? ' ' + item.args.join(' ') : '';
        console.log(`  #${i + 1} [${item.id.slice(0, 7)}] ${item.command}${argStr}`);
      });
      break;
    }

    case 'remove': {
      const [idPrefix] = rest;
      if (!idPrefix) {
        process.stderr.write('pw-cli: queue remove requires an id\n\nUsage: pw-cli queue remove <id>\n');
        process.exit(1);
      }
      const removed = removeItem(idPrefix);
      if (!removed) {
        process.stderr.write(`pw-cli: no queue item matching "${idPrefix}"\n`);
        process.exit(1);
      }
      console.log(`removed [${removed.id}] ${removed.command}`);
      break;
    }

    case 'clear': {
      clearQueue();
      console.log('Queue cleared.');
      break;
    }

    case 'run': {
      const queue = readQueue();
      if (!queue.length) {
        console.log('Queue is empty, nothing to run.');
        break;
      }

      const failFast = rest.includes('--fail-fast');
      const scriptPath = process.argv[1]; // absolute path to pw-cli.js

      console.log(`Running ${queue.length} queued item${queue.length === 1 ? '' : 's'}...`);
      let failed = 0;

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const argStr = item.args && item.args.length ? ' ' + item.args.join(' ') : '';
        process.stdout.write(`  [${i + 1}/${queue.length}] ${item.command}${argStr} ... `);

        const itemArgv = [item.command, ...(item.args || [])];
        const res = spawnSync(process.execPath, [scriptPath, ...globalArgs, ...itemArgv], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
        });

        if (res.status === 0) {
          process.stdout.write('ok\n');
          if (res.stdout && res.stdout.trim()) console.log(res.stdout.trimEnd());
        } else {
          process.stdout.write('FAILED\n');
          if (res.stderr && res.stderr.trim()) process.stderr.write(res.stderr.trimEnd() + '\n');
          failed++;
          if (failFast) {
            process.stderr.write(`pw-cli: queue run aborted at item ${i + 1} (--fail-fast)\n`);
            break;
          }
        }
      }

      if (failed === 0) {
        console.log('All items completed successfully.');
      } else {
        console.log(`Done. ${failed} item${failed === 1 ? '' : 's'} failed.`);
        process.exit(1);
      }
      break;
    }

    default: {
      process.stdout.write(`pw-cli queue — batch actions and run them together

USAGE
  pw-cli queue <subcommand> [args...]

SUBCOMMANDS
  add <command> [args...]   Add an action to the queue
  list                      Show all queued actions
  run [--fail-fast]         Execute all queued actions in order
  remove <id>               Remove a specific item by id prefix
  clear                     Empty the queue

EXAMPLES
  pw-cli queue add goto https://example.com
  pw-cli queue add click e12
  pw-cli queue add fill e5 "hello world"
  pw-cli queue add run-code "return await page.title()"
  pw-cli queue list
  pw-cli queue run
  pw-cli queue run --fail-fast
  pw-cli queue clear
`);
      if (subCmd && subCmd !== 'help' && subCmd !== '--help' && subCmd !== '-h') {
        process.stderr.write(`pw-cli: unknown queue subcommand: ${subCmd}\n`);
        process.exit(1);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// run-script — delegates to our CDP-based executor
// ---------------------------------------------------------------------------
async function handleRunScript(rawArgv) {
  const { getConnection } = require('../src/browser-manager');
  const { execScript } = require('../src/executor');

  // parse: pw-cli [global-opts] run-script <file> [script-args...]
  const rsIdx = rawArgv.indexOf('run-script');
  const afterRs = rawArgv.slice(rsIdx + 1);
  const globalBefore = rawArgv.slice(0, rsIdx);
  const options = parsePwCliGlobalOptions(globalBefore);

  // Separate flags (before script path) from script path + script args
  const flags = [];
  let restIdx = 0;
  for (let i = 0; i < afterRs.length; i++) {
    if (afterRs[i].startsWith('-')) {
      flags.push(afterRs[i]);
    } else {
      restIdx = i;
      break;
    }
  }
  // Merge only explicitly specified flags after run-script into options
  // (avoid overwriting earlier options with defaults from parsePwCliGlobalOptions)
  if (flags.length > 0) {
    const defaults = parsePwCliGlobalOptions([]);
    const afterOptions = parsePwCliGlobalOptions(flags);
    for (const [key, value] of Object.entries(afterOptions)) {
      if (value !== defaults[key]) {
        options[key] = value;
      }
    }
  }

  const positionals = afterRs.slice(restIdx);
  const [scriptPath, ...scriptArgs] = positionals;

  if (!scriptPath) {
    process.stderr.write(`pw-cli: run-script requires a script path\n\n${getRunScriptHelpText()}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(scriptPath))) {
    process.stderr.write(`pw-cli: script not found: ${path.resolve(scriptPath)}\n`);
    process.exit(3);
  }

  const conn = await getConnection(options);
  try {
    const result = await execScript(scriptPath, scriptArgs, conn);
    if (result !== undefined) console.log(result);
  } catch (err) {
    process.stderr.write(`pw-cli: ${err.message || err}\n`);
    process.exit(1);
  } finally {
    await (conn.close ? conn.close() : conn.browser.close());
  }
  process.exit(0);
}

async function handleRunCode(rawArgv) {
  const { getConnection } = require('../src/browser-manager');
  const { execCode } = require('../src/executor');

  const rcIdx = rawArgv.indexOf('run-code');
  const beforeRc = rawArgv.slice(0, rcIdx);
  const afterRc = rawArgv.slice(rcIdx + 1);
  const options = parsePwCliGlobalOptions(beforeRc);

  let code = afterRc.join(' ').trim();

  if (!code) {
    if (process.stdin.isTTY) {
      process.stderr.write(
        'pw-cli: no code provided.\n\n' +
        'Usage:\n' +
        '  pw-cli run-code "await page.goto(\'https://example.com\')"\n' +
        '  pw-cli run-code "async (page) => { await page.goto(\'https://example.com\') }"\n' +
        '  @\'\n' +
        '  await page.goto(\'https://example.com\')\n' +
        '  \'@ | pw-cli run-code\n'
      );
      process.exit(1);
    }

    code = (await readStdin()).trim();
    if (!code) {
      process.stderr.write('pw-cli: empty code from stdin\n');
      process.exit(1);
    }
  }

  const conn = await getConnection(options);
  try {
    const result = await execCode(code, conn);
    if (result !== undefined) {
      console.log(result);
    }
  } catch (err) {
    process.stderr.write(`pw-cli: ${err.message || err}\n`);
    process.exit(1);
  } finally {
    await (conn.close ? conn.close() : conn.browser.close());
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const ORIGINAL_CWD = process.cwd();
  const rawArgv = process.argv.slice(2);
  const { command, session } = getCommandAndSession(rawArgv);

  if (hasFlag(rawArgv, '--version', '-V')) {
    const pkg = require('../package.json');
    console.log(`${pkg.name}@${pkg.version}`);
    return;
  }

  if (!command || command === 'help' || (rawArgv.length === 1 && hasFlag(rawArgv, '--help', '-h'))) {
    printMainHelp();
    return;
  }

  if (command === 'run-scirpt') {
    process.stderr.write('pw-cli: unknown command: run-scirpt\n');
    process.stderr.write('Did you mean: run-script?\n\n');
    process.stdout.write(getRunScriptHelpText());
    process.exit(1);
  }

  validateRequiredArgs(rawArgv, command);

  // ── queue: batch actions and run them together ────────────────────────────
  if (command === 'queue') {
    await handleQueue(rawArgv);
    return;
  }

  // ── run-script: handled entirely by our CDP executor ─────────────────────
  if (command === 'run-script') {
    await handleRunScript(rawArgv);
    return;
  }

  // ── run-code: handled entirely by our CDP executor ───────────────────────
  if (command === 'run-code') {
    await handleRunCode(rawArgv);
    return;
  }

  // ── Fast path: send command directly to playwright-cli daemon socket ────
  // Skip heavy setup (npm root -g, require playwright, CDP probes) entirely.
  // Only for commands that the daemon handles AND don't need local preprocessing.
  if (command && !MGMT_COMMANDS.has(command)) {
    // Build the args array the daemon expects: strip session flags, keep command + args
    let fastArgs = [...rawArgv];
    // Remove session flags (-s xxx / --session xxx / --session=xxx)
    fastArgs = fastArgs.filter((a, i, arr) => {
      if (a === '-s' || a === '--session') { arr[i + 1] = undefined; return false; }
      if (a === undefined) return false;
      if (a.startsWith('-s=') || a.startsWith('--session=')) return false;
      return true;
    }).filter(Boolean);

    // Apply XPath conversion if needed
    fastArgs = convertXPathCommand(fastArgs);

    // Handle run-code wrapping for XPath-converted commands
    if (fastArgs[0] === 'run-code' && fastArgs.length > 1) {
      const code = fastArgs.slice(1).join(' ');
      fastArgs = ['run-code', wrapCodeIfNeeded(code)];
    }

    const { sendCommand } = require('../src/fast-send');
    const result = await sendCommand(fastArgs, session);
    if (result !== null) {
      // Daemon responded — use its result
      if (result.isError) {
        process.stderr.write(`${result.text}\n`);
        process.exit(1);
      }
      if (result.text) process.stdout.write(result.text + '\n');
      return;
    }
    // result === null means daemon not running — fall through to full path
  }

  // ── From here on: delegate to playwright-cli (with enhancements) ─────────
  const cliPath = findPlaywrightCli();
  if (!cliPath) {
    process.stderr.write('pw-cli: @playwright/cli not found.\nInstall: npm install -g @playwright/cli\n');
    process.exit(1);
  }

  // Ensures a browser is reachable via CDP; if not, spawns playwright-cli open first.
  // Returns the CDP port number.
  async function ensureBrowserRunning() {
    const { getPlaywrightCliCdpPort } = require('../src/browser-manager');
    const { probeCDP } = require('../src/utils');
    const { readState } = require('../src/state');
    const cliPort = getPlaywrightCliCdpPort();
    if (cliPort && await probeCDP(cliPort, 2000)) return cliPort;
    const state = readState();
    if (state && await probeCDP(state.port, 2000)) return state.port;
    // No browser reachable — start one via playwright-cli
    const { spawnSync } = require('child_process');
    const res = spawnSync(process.execPath, [cliPath, 'open', '--headed', '--persistent', '--profile', DEFAULT_PROFILE], {
      stdio: 'inherit',
      cwd: PW_CLI_DIR,
    });
    if (res.status !== 0) {
      process.stderr.write('pw-cli: failed to open browser\n');
      process.exit(res.status || 1);
    }
    // After spawning, re-detect the port
    const newCliPort = getPlaywrightCliCdpPort();
    if (newCliPort) return newCliPort;
    const newState = readState();
    return newState ? newState.port : null;
  }

  // ── goto: navigate the active tab (detected via CDP /json/list) ──────────
  if (command === 'goto') {
    const gotoIdx = rawArgv.indexOf('goto');
    const afterGoto = rawArgv.slice(gotoIdx + 1);
    const rawUrl = afterGoto.find(a => !a.startsWith('-'));
    if (rawUrl) {
      const fullUrl = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const cdpPort = await ensureBrowserRunning();
      const { fetchActivePageUrl } = require('../src/utils');
      const activeUrl = await fetchActivePageUrl(cdpPort);
      const navCode = `async (page, context) => {
        const pages = context.pages();
        let target = pages[pages.length - 1] || page;
        ${activeUrl ? `const match = pages.find(p => p.url() === ${JSON.stringify(activeUrl)});
        if (match) target = match;` : ''}
        await target.goto(${JSON.stringify(fullUrl)}, { waitUntil: 'domcontentloaded', timeout: 0 });
        return target.url();
      }`;
      await handleRunCode(['run-code', navCode]);
      return;
    }
  }

  let argv = [...rawArgv];

  // ── run-code: stdin support + auto-wrap plain code as function ───────────
  if (command === 'run-code') {
    const cmdIdx = argv.indexOf('run-code');
    const afterCmd = argv.slice(cmdIdx + 1);
    const positionals = afterCmd.filter(a => !a.startsWith('-'));

    if (positionals.length === 0) {
      // No inline code — try stdin
      if (process.stdin.isTTY) {
        process.stderr.write('pw-cli: no code provided.\n\nUsage:\n  pw-cli run-code "<async (page) => { ... }>"\n  echo "return await page.title()" | pw-cli run-code\n');
        process.exit(1);
      }
      const code = await readStdin();
      if (!code) {
        process.stderr.write('pw-cli: empty code from stdin\n');
        process.exit(1);
      }
      argv.splice(cmdIdx + 1, 0, wrapCodeIfNeeded(code));
    } else {
      // Inline code provided — wrap if it's plain statements, not a function
      const codeArg = positionals[0];
      const wrapped = wrapCodeIfNeeded(codeArg);
      if (wrapped !== codeArg) {
        // replace original positional with wrapped version
        const origIdx = argv.indexOf(codeArg, cmdIdx + 1);
        if (origIdx !== -1) argv[origIdx] = wrapped;
      }
    }
  }

  // ── Inject defaults for open ─────────────────────────────────────────────
  if (command === 'open') {
    const openIdx = argv.indexOf('open');
    const afterOpen = argv.slice(openIdx + 1);

    // If a URL is provided with open, ensure a browser is running then open a new tab.
    const rawUrlArg = afterOpen.find(a => !a.startsWith('-') && /^(https?:\/\/|[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,})/.test(a));
    const urlArg = rawUrlArg && !/^https?:\/\//.test(rawUrlArg) ? `https://${rawUrlArg}` : rawUrlArg;
    if (urlArg) {
      const navCode = `async page => {
        const newPage = await page.context().newPage();
        await newPage.goto(${JSON.stringify(urlArg)}, { waitUntil: 'domcontentloaded', timeout: 0 });
        return newPage.url();
      }`;
      await ensureBrowserRunning();
      await handleRunCode(['run-code', navCode]);
      return;
    } else {
      const enhanced = injectOpenDefaults(afterOpen);
      argv = [...argv.slice(0, openIdx + 1), ...enhanced];
    }
  }

  // ── XPath support: convert XPath ref args to run-code ───────────────────
  argv = convertXPathCommand(argv);

  // ── Auto-open if session not running and command needs a browser ──────────
  if (command && !MGMT_COMMANDS.has(command)) {
    const alive = await isSessionAlive(session);
    if (!alive) {
      // Spawn playwright-cli open as a separate process (it detaches the daemon)
      const { spawnSync } = require('child_process');
      const openArgs = [
        cliPath,
        ...(session !== 'default' ? ['-s', session] : []),
        'open',
        '--headed', '--persistent', '--profile', DEFAULT_PROFILE,
      ];
      process.chdir(PW_CLI_DIR);
      const res = spawnSync(process.execPath, openArgs, { stdio: 'inherit' });
      if (res.status !== 0) {
        process.stderr.write('pw-cli: failed to auto-open browser\n');
        process.exit(1);
      }
    }
  }

  // ── Rewrite --filename relative paths to absolute (based on original cwd) ─
  // playwright-cli runs from PW_CLI_DIR, so relative --filename paths would
  // land there. Rewrite them before chdir so files end up where the user expects.
  argv = argv.map((arg, i) => {
    if (arg.startsWith('--filename=')) {
      const val = arg.slice('--filename='.length);
      if (val && !path.isAbsolute(val)) return `--filename=${path.resolve(ORIGINAL_CWD, val)}`;
    }
    if (arg === '--filename' && argv[i + 1] && !argv[i + 1].startsWith('-') && !path.isAbsolute(argv[i + 1])) {
      // value is the next element; will be rewritten on that element's turn — skip
    }
    // handle the value token after a bare --filename
    if (i > 0 && argv[i - 1] === '--filename' && !arg.startsWith('-') && !path.isAbsolute(arg)) {
      return path.resolve(ORIGINAL_CWD, arg);
    }
    return arg;
  });

  // ── Redirect snapshot/console output to original cwd ────────────────────
  // playwright-cli writes to .playwright-cli/ relative to its cwd (PW_CLI_DIR).
  // On exit, move any newly created files back to the directory pw-cli was
  // called from, so snapshots appear alongside the user's project.
  {
    const snapshotSrc = path.join(PW_CLI_DIR, '.playwright-cli');
    const snapshotDst = path.join(ORIGINAL_CWD, '.playwright-cli');
    let before = new Set();
    try { before = new Set(fs.readdirSync(snapshotSrc)); } catch {}
    process.on('exit', () => {
      try {
        const files = fs.readdirSync(snapshotSrc);
        if (files.some(f => !before.has(f))) {
          fs.mkdirSync(snapshotDst, { recursive: true });
          for (const f of files) {
            if (before.has(f)) continue;
            const src = path.join(snapshotSrc, f);
            const dst = path.join(snapshotDst, f);
            try {
              fs.renameSync(src, dst);
            } catch (e) {
              if (e.code === 'EXDEV') { fs.copyFileSync(src, dst); fs.unlinkSync(src); }
            }
          }
        }
      } catch {}
    });
  }

  // ── Delegate to playwright-cli ────────────────────────────────────────────
  // Set cwd to PW_CLI_DIR so playwright-cli always finds our workspace
  process.chdir(PW_CLI_DIR);
  // Override argv so playwright-cli's minimist sees our modified args
  process.argv = ['node', 'pw-cli.js', ...argv];
  require(cliPath);
}

main().catch(err => {
  process.stderr.write(`pw-cli: ${err.message}\n`);
  process.exit(1);
});
