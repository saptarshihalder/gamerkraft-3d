#!/usr/bin/env node
/** Syntax-check every JavaScript file under src/ and tools/ with `node --check`. */
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(file));
    else if (/\.(m?js)$/.test(entry.name)) out.push(file);
  }
  return out;
}
const files = [...await jsFiles(path.join(root, 'src')), ...await jsFiles(path.join(root, 'tools'))];
let failed = 0;
for (const file of files) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { failed++; console.error(`✖ ${path.relative(root, file)}\n${error.stderr}`); }
}
console.log(`Checked ${files.length} files, ${failed} failed.`);
if (failed) process.exitCode = 1;
