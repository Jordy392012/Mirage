const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const worker = fs.readFileSync(path.join(__dirname, '..', 'compiler-worker.js'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.match(worker, /runtime\.compileArtifact\(/, 'worker must invoke real Clang compile/link');
assert.match(worker, /captureCompilerOutput/, 'worker must capture compiler diagnostics');
assert.match(worker, /wasm32-wasi/, 'worker must disclose its actual target');
assert.doesNotMatch(worker, /executeBrowserClangArtifact|toolchain\.execute\(/,
  'worker must never execute the compiled program');
assert.match(worker, /int main\(\) \{ return 0; \}/,
  'translation units without main get a harmless linker entry point');
assert.match(worker, /-ast-dump=json/, 'worker should request a compiler AST for structural loop findings');
assert.match(worker, /astLoopFindings/, 'worker should derive loop findings from Clang AST nodes');
assert.match(worker, /toolchain\.runtime\.run\(\s*clang/,
  'raw runtime invocation must only launch Clang for AST parsing');
assert.match(workflow, /sha256sum --check/, 'deployment must verify compiler asset hashes');
assert.match(workflow, /libc-printscan-long-double\.a\.gz/,
  'deployment must include the manifest-referenced long-double support asset');
assert.equal((workflow.match(/curl --fail/g) || []).length, 6,
  'deployment must fetch all six compiler runtime assets');
assert.equal((workflow.match(/sha256sum --check/g) || []).length, 6,
  'all six runtime assets must be hash-checked');
assert.match(html, /id="compilerCheckButton"/, 'UI must expose the Clang check');
assert.match(html, /not the ESP32-S3 Xtensa chip/, 'UI must disclose target mismatch');
assert.match(app, /new Worker\(new URL\('\.\/compiler-worker\.js\?v=0\.2\.0'/,
  'compile work must run in a cache-busted background worker');
console.log('compiler-worker contract tests passed: 15 checks');
