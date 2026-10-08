#!/usr/bin/env node
// The root package.json workspaces are the public mods: exactly the entries of .claude-plugin/marketplace.json.
// Each workspace package.json owns its mod's version; copy it into plugins/<mod>/.claude-plugin/plugin.json
// the mod's marketplace entry and package-lock.json (npm ci refuses a stale lock). Edits are textual, so each file keeps its own formatting.
// --check: report drift (versions, or workspaces vs marketplace entries) and exit 1 without writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const marketPath = join(root, '.claude-plugin/marketplace.json');
const lockPath = join(root, 'package-lock.json');
let drift = false;
const fail = msg => { console.error(`x ${msg}`); drift = true; };

// Replace the first "version" value at or after `from`; the file must already have one there.
function sync(file, version, from = 0) {
  const text = readFileSync(file, 'utf8');
  const re = /"version":\s*"([^"]*)"/g;
  re.lastIndex = from;
  const m = re.exec(text);
  const rel = file.slice(root.length + 1);
  if (!m) return fail(`${rel}: no version field`);
  if (m[1] === version) return console.log(`= ${rel} ${version}`);
  if (check) return fail(`${rel}: version ${m[1]}, expected ${version}`);
  const at = m.index + m[0].lastIndexOf(m[1]);
  writeFileSync(file, text.slice(0, at) + version + text.slice(at + m[1].length));
  console.log(`^ ${rel} -> ${version}`);
}

const listed = readJson(marketPath).plugins.map(p => p.name);
const workspaces = readJson(join(root, 'package.json')).workspaces;
const names = workspaces.map(dir => readJson(join(root, dir, 'package.json')).name);
for (const n of listed.filter(n => !names.includes(n))) fail(`${n} is in marketplace.json but not a workspace`);
for (const n of names.filter(n => !listed.includes(n))) fail(`${n} is a workspace but not in marketplace.json`);

workspaces.forEach(dir => {
  const { name, version } = readJson(join(root, dir, 'package.json'));
  if (dir !== `plugins/${name}`) return fail(`workspace ${dir} must be plugins/${name}`);
  sync(join(root, dir, '.claude-plugin/plugin.json'), version);
  const entry = readFileSync(marketPath, 'utf8').indexOf(`"name": "${name}"`);
  if (entry >= 0) sync(marketPath, version, entry);
  const locked = readFileSync(lockPath, 'utf8').indexOf(`"${dir}": {`);
  if (locked >= 0) sync(lockPath, version, locked);
});
if (drift) {
  console.error('Version drift. Run `node scripts/sync-plugin-versions.mjs` to fix.');
  process.exitCode = 1;
}
