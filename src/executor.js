'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

function isFunctionExpression(code) {
  const text = code.trim();
  return /^(async\s+function\b|function\b|async\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(text);
}

async function runFunctionExpression(code, globals) {
  const factory = new Function(...Object.keys(globals), `return (${code});`);
  const maybeFn = factory(...Object.values(globals));

  if (typeof maybeFn === 'function') {
    return maybeFn(
      globals.page,
      globals.context,
      globals.browser,
      globals.playwright,
      globals.args
    );
  }

  return maybeFn;
}

// Use AsyncFunction constructor to execute in the same V8 context as playwright objects.
// This avoids vm.runInNewContext's cross-context prototype issues.
async function runCode(code, globals) {
  if (isFunctionExpression(code)) {
    return runFunctionExpression(code, globals);
  }

  return runProgram(code, globals);
}

async function runProgram(code, globals) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(...Object.keys(globals), code);
  return fn.call(globals, ...Object.values(globals));
}

async function withTemporaryGlobals(globals, fn) {
  const previous = new Map();
  const keys = Object.keys(globals);

  for (const key of keys) {
    const existed = Object.prototype.hasOwnProperty.call(globalThis, key);
    previous.set(key, { existed, value: globalThis[key] });
    globalThis[key] = globals[key];
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const entry = previous.get(key);
      if (!entry.existed) {
        delete globalThis[key];
      } else {
        globalThis[key] = entry.value;
      }
    }
  }
}

async function execCode(code, { browser, context, page, playwright }) {
  const globals = {
    browser,
    context,
    page,
    playwright,
    require,
    console,
    process,
  };
  return withTemporaryGlobals(globals, () => runCode(code, globals));
}

function buildScriptRequire(absPath) {
  const localRequire = Module.createRequire(absPath);
  const scriptRequire = function scriptRequire(id) {
    try {
      return localRequire(id);
    } catch (error) {
      if (
        error &&
        error.code === 'MODULE_NOT_FOUND' &&
        typeof id === 'string' &&
        !id.startsWith('.') &&
        !path.isAbsolute(id)
      ) {
        return require(id);
      }
      throw error;
    }
  };

  scriptRequire.resolve = localRequire.resolve.bind(localRequire);
  scriptRequire.cache = require.cache;
  scriptRequire.extensions = require.extensions;
  return scriptRequire;
}

function isModuleExport(code) {
  return /\bmodule\.exports\b/.test(code) || /\bexports\./.test(code);
}

function hasMainFunction(code) {
  return /\b(async\s+)?function\s+main\s*\(/.test(code);
}

async function execScript(scriptPath, scriptArgs, { browser, context, page, playwright }) {
  const absPath = path.resolve(scriptPath);
  if (!fs.existsSync(absPath)) {
    const err = new Error(`Script not found: ${absPath}`);
    err.code = 'ENOENT';
    throw err;
  }

  const code = fs.readFileSync(absPath, 'utf8');
  const pwGlobals = { page, context, browser, playwright, args: scriptArgs };

  // Standard module pattern: script uses module.exports = function(...)
  // The exported function receives Playwright globals as a single object argument.
  if (isModuleExport(code)) {
    return execModuleScript(absPath, code, pwGlobals);
  }

  // Legacy bare-code pattern: script body is executed directly with globals as local variables.
  return execBareScript(absPath, code, pwGlobals);
}

async function execModuleScript(absPath, code, pwGlobals) {
  const moduleDir = path.dirname(absPath);
  const scriptRequire = buildScriptRequire(absPath);
  const scriptModule = {
    id: absPath,
    filename: absPath,
    path: moduleDir,
    exports: {},
    loaded: false,
    children: [],
    parent: require.main || module,
    require: scriptRequire,
  };
  scriptRequire.main = scriptModule;

  // Evaluate the module body to populate module.exports.
  // Playwright globals are available during evaluation for backward compat.
  const wrapGlobals = {
    ...pwGlobals,
    require: scriptRequire,
    module: scriptModule,
    exports: scriptModule.exports,
    console,
    process,
    __filename: absPath,
    __dirname: moduleDir,
  };
  await withTemporaryGlobals(wrapGlobals, () => runProgram(code, wrapGlobals));
  scriptModule.loaded = true;

  const exported = scriptModule.exports;
  if (typeof exported === 'function') {
    return exported(pwGlobals);
  }
  return exported;
}

async function execBareScript(absPath, code, pwGlobals) {
  const moduleDir = path.dirname(absPath);
  const scriptRequire = buildScriptRequire(absPath);
  const scriptModule = {
    id: absPath,
    filename: absPath,
    path: moduleDir,
    exports: {},
    loaded: false,
    children: [],
    parent: require.main || module,
    require: scriptRequire,
  };
  scriptRequire.main = scriptModule;

  const globals = {
    ...pwGlobals,
    require: scriptRequire,
    module: scriptModule,
    exports: scriptModule.exports,
    console,
    process,
    __filename: absPath,
    __dirname: moduleDir,
  };
  // If the script defines a main function, append a call to it.
  const finalCode = hasMainFunction(code)
    ? code + '\nreturn main({ page, context, browser, playwright, args });'
    : code;
  const result = await withTemporaryGlobals(globals, () => runProgram(finalCode, globals));
  scriptModule.loaded = true;
  return result === undefined ? scriptModule.exports : result;
}

module.exports = { execCode, execScript };
