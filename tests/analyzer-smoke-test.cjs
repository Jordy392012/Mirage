'use strict';
// Lightweight regression test for the v0.1 static-analysis heuristics.
// It extracts the analyzer function from app.js so no browser dependencies are required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const start = app.indexOf('  function analyzeFile(file) {');
const end = app.indexOf('\n\n  let arrayObservations = [];', start);
assert.ok(start >= 0 && end > start, 'could not locate analyzeFile() in app.js');
const analyzerSource = app.slice(start, end).trim() + '\nthis.analyzeFile = analyzeFile;';

const context = {
  TYPE_BYTES: {
    char: 1, 'signed char': 1, 'unsigned char': 1, int8_t: 1, uint8_t: 1, byte: 1, bool: 1,
    short: 2, 'short int': 2, 'unsigned short': 2, int16_t: 2, uint16_t: 2,
    int: 4, 'unsigned int': 4, long: 4, 'long int': 4, 'unsigned long': 4,
    int32_t: 4, uint32_t: 4, float: 4, double: 8, size_t: 4, 'long long': 8, int64_t: 8, uint64_t: 8
  },
  arrayObservations: [],
  escLine: value => String(value).replace(/\s+/g, ' ').trim(),
  formatBytes: bytes => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`,
  addFinding: (list, item) => { if (!list.some(existing => existing.id === item.id && existing.file === item.file)) list.push(item); }
};
vm.createContext(context);
vm.runInContext(analyzerSource, context);

const source = `#include <Arduino.h>\nstatic uint16_t data[4096];\nvoid work() {\n  for (int r=0; r<8; r++) {\n    for (int c=0; c<8; c++) { data[r*8+c]++; }\n  }\n}\n`;
const result = context.analyzeFile({ name: 'nested.cpp', content: source });
const ids = result.map(finding => finding.id);
assert.ok(ids.includes('nested-loop'), 'nested loops should be detected');
assert.ok(ids.includes('large-array-data'), 'large literal-size array should be flagged');
assert.equal(context.arrayObservations.length, 1, 'one array should be inventoried');
assert.equal(context.arrayObservations[0].bytes, 8192, 'uint16_t[4096] should estimate 8192 bytes');

context.arrayObservations = [];
const namedSize = `constexpr int N = 1000;\nfloat samples[N];\nfloat results[N];\nfloat matrix[2][N];`;
context.analyzeFile({ name: 'named-size.cpp', content: namedSize });
assert.equal(context.arrayObservations.length, 3, 'named constant dimensions should be inventoried');
assert.equal(context.arrayObservations.reduce((sum, item) => sum + item.bytes, 0), 16000, 'two float[N] arrays and float[2][N] should estimate 16000 bytes');

context.arrayObservations = [];
const independent = `void work() {\n for (int i=0;i<4;i++) { use(i); }\n for (int j=0;j<4;j++) { use(j); }\n}\n`;
const independentResult = context.analyzeFile({ name: 'independent.cpp', content: independent });
assert.ok(!independentResult.some(finding => finding.id === 'nested-loop'), 'separate loops must not be labeled nested');

const stringLoop = `void f(const char* s) { for (int i=0; i<strlen(s); i++) { use(s[i]); } }`;
const stringResult = context.analyzeFile({ name: 'strlen.cpp', content: stringLoop });
assert.ok(stringResult.some(finding => finding.id === 'strlen-loop'), 'strlen in a loop condition should be detected');

console.log('MIRAGE analyzer smoke tests passed (3 cases).');


// Transformation regression tests. These guard the supported syntax and known hazards.
const transformStart = app.indexOf('  function maskNonCode(source) {');
const transformEnd = app.indexOf('\n\n  let arrayObservations = [];', transformStart);
assert.ok(transformStart >= 0 && transformEnd > transformStart, 'could not locate transformation helpers');
const transformSource = app.slice(transformStart, transformEnd).trim() + '\nthis.suggestTransformations = suggestTransformations;';
const transformContext = {};
vm.createContext(transformContext);
vm.runInContext(transformSource, transformContext);
const transform = transformContext.suggestTransformations;

const multiple = transform('float x = powf(samples[i], 2.0f);\nfloat y = pow(value, 2);');
assert.equal(multiple.changes.length, 2, 'pow/powf with supported exponent-2 forms should be offered');
assert.ok(multiple.source.includes('(samples[i] * samples[i])'), 'simple array element should be rewritten');
assert.ok(multiple.source.includes('(value * value)'), 'identifier should be rewritten');
assert.equal(transform(multiple.source).changes.length, 0, 'applying the transformation should be idempotent');

const unsafeSource = 'float a = powf(samples[i++], 2.0f);\nfloat b = powf(getValue(), 2.0f);';
const unsafe = transform(unsafeSource);
assert.equal(unsafe.changes.length, 0, 'side-effecting indexes and function-call operands must not be rewritten');
assert.equal(unsafe.source, unsafeSource, 'unsupported code must remain byte-for-byte unchanged');

const prose = '// powf(value, 2.0f) in a comment\nconst char* text = "pow(value, 2)"; /* powf(other, 2) */\nfloat z = powf(realValue, 2.0f);';
const proseResult = transform(prose);
assert.equal(proseResult.changes.length, 1, 'comments and quoted strings must be ignored');
assert.ok(proseResult.source.includes('// powf(value, 2.0f) in a comment'), 'line comment must remain unchanged');
assert.ok(proseResult.source.includes('"pow(value, 2)"'), 'quoted string must remain unchanged');
assert.ok(proseResult.source.includes('float z = (realValue * realValue);'), 'real code should still be transformed');

const edgeCases = transform('powf(value, 2.5f); powf(value, exponent); powf(table[ i ], 2.0f);');
assert.equal(edgeCases.changes.length, 1, 'unsupported exponents should be skipped while simple indexed arrays are supported');
assert.ok(edgeCases.source.includes('(table[ i ] * table[ i ])'), 'simple indexed array should be rewritten');

console.log('MIRAGE analyzer and transformation regression tests passed.');
