#!/usr/bin/env node
// Fails on features missing in Chromium 76 (PLAN §1.3) in js/, css/ and index.html; then `node --check` on every js file.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
function walk(d, ext, out = []) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, ext, out); else if (p.endsWith(ext) && !/\.bak-/.test(p)) out.push(p); } return out; }
const JS = [[/\?\.[a-zA-Z_$\[(]/, 'optional chaining ?.'], [/\?\?/, 'nullish ??'], [/\.replaceAll\(/, 'replaceAll'], [/\.at\(-?\d/, 'Array.at'], [/replaceChildren/, 'replaceChildren'], [/Promise\.any/, 'Promise.any'], [/WeakRef/, 'WeakRef'], [/loading=["']lazy/, 'loading=lazy'], [/structuredClone/, 'structuredClone'], [/\bclass\s+\w+[^{]*\{[^}]*^\s*\w+\s*=/m, 'class field'], [/(^|[^\w.])#[a-z_]\w*\s*(=|;|\()/, 'private field']];
const CSS = [[/(^|[;{\s])inset\s*:/, 'inset'], [/(^|[;{\s])gap\s*:/, 'gap (flex)'], [/aspect-ratio/, 'aspect-ratio'], [/(^|[\s:,(])(min|max|clamp)\(/, 'min()/max()/clamp()'], [/:is\(|:where\(|:focus-visible/, ':is/:where/:focus-visible'], [/content-visibility/, 'content-visibility'], [/backdrop-filter/, 'backdrop-filter (slow)']];
let bad = 0;
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");
for (const f of walk(path.join(root, 'js'), '.js')) {
  const s = strip(fs.readFileSync(f, 'utf8'));
  s.split('\n').forEach((l, i) => JS.forEach(([re, n]) => { if (re.test(l)) { bad++; console.log(`${path.relative(root, f)}:${i + 1}: ${n}`); } }));
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.log(path.relative(root, f) + ': syntax: ' + String(e.stderr).split('\n').slice(0, 5).join(' ')); }
}
for (const f of walk(path.join(root, 'css'), '.css').concat([path.join(root, 'index.html')])) {
  const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  s.split('\n').forEach((l, i) => CSS.forEach(([re, n]) => { if (re.test(l)) { bad++; console.log(`${path.relative(root, f)}:${i + 1}: ${n}`); } }));
}
console.log(bad ? `compat: ${bad} problem(s)` : 'compat ok');
process.exit(bad ? 1 : 0);
