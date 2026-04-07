'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execCode, execScript } = require('../src/executor');

function createGlobals() {
  return {
    browser: { name: 'browser' },
    context: { name: 'context' },
    page: {
      value: 7,
      async locator(selector) {
        return {
          async click() {
            return `clicked:${selector}`;
          },
        };
      },
    },
    playwright: { name: 'playwright' },
  };
}

test('execCode supports plain statement bodies', async () => {
  const result = await execCode('return page.value + 1;', createGlobals());
  assert.equal(result, 8);
});

test('execCode supports async arrow function expressions', async () => {
  const result = await execCode('async page => { return page.value + 2; }', createGlobals());
  assert.equal(result, 9);
});

test('execCode supports function expressions using page globals', async () => {
  const result = await execCode(
    'async (page) => { const locator = await page.locator("xpath=//input[@placeholder=\\"开始时间\\"]"); return locator.click(); }',
    createGlobals()
  );
  assert.equal(result, 'clicked:xpath=//input[@placeholder="开始时间"]');
});

test('execScript supports CommonJS module globals and script args', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-exec-script-'));
  const scriptPath = path.join(tempDir, 'script.js');

  fs.writeFileSync(
    scriptPath,
    [
      "function getCliArgs() {",
      "  if (Array.isArray(globalThis.args)) return globalThis.args;",
      "  return process.argv.slice(2);",
      "}",
      "",
      "async function main() {",
      "  const cliArgs = getCliArgs();",
      "  return {",
      "    args: cliArgs,",
      "    hasPage: !!page,",
      "    mainMatches: require.main === module,",
      "    exportedType: typeof module.exports",
      "  };",
      "}",
      "",
      "if (require.main === module) {",
      "  module.exports = main();",
      "} else {",
      "  module.exports = { mainMatches: false };",
      "}",
    ].join('\n'),
    'utf8'
  );

  try {
    const result = await execScript(scriptPath, ['foo', '--bar'], createGlobals());
    const resolved = await result;

    assert.deepEqual(resolved, {
      args: ['foo', '--bar'],
      hasPage: true,
      mainMatches: true,
      exportedType: 'object',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('execScript provides __filename and __dirname', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-exec-script-'));
  const scriptPath = path.join(tempDir, 'meta.js');

  fs.writeFileSync(scriptPath, 'return { file: __filename, dir: __dirname };', 'utf8');

  try {
    const result = await execScript(scriptPath, [], createGlobals());
    assert.equal(result.file, path.resolve(scriptPath));
    assert.equal(result.dir, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('execScript can require local modules relative to script', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-exec-script-'));
  const helperPath = path.join(tempDir, 'helper.js');
  const scriptPath = path.join(tempDir, 'main.js');

  fs.writeFileSync(helperPath, 'module.exports = { value: 42 };', 'utf8');
  fs.writeFileSync(scriptPath, "const h = require('./helper'); return h.value;", 'utf8');

  try {
    const result = await execScript(scriptPath, [], createGlobals());
    assert.equal(result, 42);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('execScript throws for missing script file', async () => {
  await assert.rejects(
    () => execScript('/nonexistent/script.js', [], createGlobals()),
    { code: 'ENOENT' }
  );
});

test('execScript with empty args defaults to empty array', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-exec-script-'));
  const scriptPath = path.join(tempDir, 'args.js');

  fs.writeFileSync(scriptPath, 'return args;', 'utf8');

  try {
    const result = await execScript(scriptPath, [], createGlobals());
    assert.deepEqual(result, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('execScript accesses all playwright globals', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-exec-script-'));
  const scriptPath = path.join(tempDir, 'globals.js');

  fs.writeFileSync(scriptPath, [
    'return {',
    '  hasPage: !!page,',
    '  hasBrowser: !!browser,',
    '  hasContext: !!context,',
    '  hasPlaywright: !!playwright,',
    '};',
  ].join('\n'), 'utf8');

  try {
    const result = await execScript(scriptPath, [], createGlobals());
    assert.deepEqual(result, {
      hasPage: true,
      hasBrowser: true,
      hasContext: true,
      hasPlaywright: true,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
