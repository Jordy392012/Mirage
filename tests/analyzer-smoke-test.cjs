'use strict';
// Regression tests for MIRAGE's source heuristics and the isolated memory scanner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const memory = require('../memory-analyzer.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function scan(source, file = 'fixture.cpp') {
  return memory.scanArrayDeclarations(source, file);
}

// A literal-sized array and multi-dimensional array have the expected estimates.
let result = scan('static uint16_t data[4096];\nfloat matrix[2][16];');
assert.equal(result.arrays.length, 2);
assert.equal(result.arrays[0].bytes, 8192, 'uint16_t[4096] should estimate 8192 bytes');
assert.deepEqual(result.arrays[1].dimensions, [2, 16]);
assert.equal(result.arrays[1].bytes, 128);
assert.ok(result.findings.some(item => item.id === 'large-array-data'));

// Numeric constexpr constants and #define dimensions are resolved.
result = scan('#define WIDTH 32\nconstexpr int N = 1000;\nfloat samples[N];\nfloat matrix[2][N];\nuint8_t row[WIDTH];');
assert.equal(result.arrays.length, 3);
assert.equal(result.arrays.reduce((sum, item) => sum + (item.includedInTotal ? item.bytes : 0), 0), 12032);
assert.deepEqual(result.arrays[1].dimensions, [2, 1000]);

// Comments and strings must not turn fake declarations into inventory entries.
result = scan('// uint8_t fake[999];\nconst char* text = "float fake[300]"; /* int nope[600]; */\nfloat valid[4];');
assert.deepEqual(result.arrays.map(item => item.name), ['valid']);
assert.equal(result.arrays[0].bytes, 16);

// Location/storage clues are shown as estimates, not confirmed linker placement.
result = scan('uint8_t globalBuf[64];\nvoid work() { int localBuf[8]; static int cache[16]; }');
assert.equal(result.arrays.length, 3);
assert.match(result.arrays[0].storageClass, /file-scope/);
assert.match(result.arrays[1].storageClass, /inner scope/);
assert.match(result.arrays[2].storageClass, /static-duration/);
assert.equal(result.arrays[1].bytes, 32);

// A size MIRAGE cannot resolve is unknown—not zero—and produces a finding.
result = scan('void f(size_t n) { uint8_t buffer[n]; }');
assert.equal(result.arrays.length, 1);
assert.equal(result.arrays[0].bytes, null);
assert.equal(result.arrays[0].includedInTotal, false);
assert.ok(result.findings.some(item => item.id === 'unknown-array-buffer'));

// Extern declarations are inventory information but not counted as storage here.
result = scan('extern uint8_t shared[128];\nuint8_t owned[16];');
assert.equal(result.arrays.length, 2);
assert.equal(result.arrays[0].includedInTotal, false);
assert.equal(result.arrays[1].includedInTotal, true);
assert.equal(result.arrays.reduce((sum, item) => sum + (item.includedInTotal ? item.bytes : 0), 0), 16);

// Check the memory integration inside app.js, not only the standalone helper.
const analyzeStart = app.indexOf('  function analyzeFile(file) {');
const analyzeEndMarker = '\n  }\n\n  let arrayObservations = [];';
const analyzeEnd = app.indexOf(analyzeEndMarker, analyzeStart);
assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart, 'could not locate analyzeFile()');
const analyzerSource = app.slice(analyzeStart, analyzeEnd + '\n  }'.length).trim() + '\nthis.analyzeFile = analyzeFile;';
const appContext = {
  window: { MirageMemoryAnalyzer: memory },
  TYPE_BYTES: { char: 1, 'signed char': 1, 'unsigned char': 1, int8_t: 1, uint8_t: 1, byte: 1, bool: 1, short: 2, 'short int': 2, 'unsigned short': 2, 'unsigned short int': 2, int16_t: 2, uint16_t: 2, int: 4, 'unsigned int': 4, long: 4, 'long int': 4, 'unsigned long': 4, int32_t: 4, uint32_t: 4, float: 4, double: 8, size_t: 4, 'long long': 8, int64_t: 8, uint64_t: 8 },
  arrayObservations: [],
  escLine: value => String(value).replace(/\s+/g, ' ').trim(),
  formatBytes: bytes => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`,
  addFinding: (list, item) => { if (!list.some(existing => existing.id === item.id && existing.file === item.file)) list.push(item); }
};
vm.createContext(appContext);
vm.runInContext(analyzerSource, appContext);
const appFindings = appContext.analyzeFile({ name: 'integration.cpp', content: 'uint8_t tiny[32];\nvoid f(size_t n) { uint8_t unknown[n]; }' });
assert.equal(appContext.arrayObservations.length, 2, 'app analyzer should integrate the memory scanner');
assert.ok(appFindings.some(item => item.id === 'unknown-array-unknown'));

// Transformation regression tests preserved from v0.3.
const transformStart = app.indexOf('  function maskNonCode(source) {');
const transformEnd = app.indexOf('  let arrayObservations = [];', transformStart);
assert.ok(transformStart >= 0 && transformEnd > transformStart, 'could not locate transformation helpers');
const transformSource = app.slice(transformStart, transformEnd).trim() + '\nthis.suggestTransformations = suggestTransformations;';
const transformContext = {};
vm.createContext(transformContext);
vm.runInContext(transformSource, transformContext);
const transform = transformContext.suggestTransformations;
const multiple = transform('float x = powf(samples[i], 2.0f);\nfloat y = pow(value, 2);');
assert.equal(multiple.changes.length, 2);
assert.ok(multiple.source.includes('(samples[i] * samples[i])'));
assert.ok(multiple.source.includes('(value * value)'));
assert.equal(transform(multiple.source).changes.length, 0);
const unsafeSource = 'float a = powf(samples[i++], 2.0f);\nfloat b = powf(getValue(), 2.0f);';
const unsafe = transform(unsafeSource);
assert.equal(unsafe.changes.length, 0);
assert.equal(unsafe.source, unsafeSource);
const prose = '// powf(value, 2.0f) in a comment\nconst char* text = "pow(value, 2)"; /* powf(other, 2) */\nfloat z = powf(realValue, 2.0f);';
const proseResult = transform(prose);
assert.equal(proseResult.changes.length, 1);
assert.ok(proseResult.source.includes('// powf(value, 2.0f) in a comment'));
assert.ok(proseResult.source.includes('"pow(value, 2)"'));
assert.ok(proseResult.source.includes('float z = (realValue * realValue);'));

console.log('MIRAGE memory-analysis and transformation regression tests passed.');
