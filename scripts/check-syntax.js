'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const targets = ['bin', 'src', 'test'];

function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = targets.flatMap(target => collectJsFiles(path.join(root, target)));

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--check', ...files], {
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
