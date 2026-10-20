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
const independent = `void work() {\n for (int i=0;i<4;i++) { use(i); }\n for (int j=0;j<4;j++) { use(j); }\n}\n`;
const independentResult = context.analyzeFile({ name: 'independent.cpp', content: independent });
assert.ok(!independentResult.some(finding => finding.id === 'nested-loop'), 'separate loops must not be labeled nested');

const stringLoop = `void f(const char* s) { for (int i=0; i<strlen(s); i++) { use(s[i]); } }`;
const stringResult = context.analyzeFile({ name: 'strlen.cpp', content: stringLoop });
assert.ok(stringResult.some(finding => finding.id === 'strlen-loop'), 'strlen in a loop condition should be detected');

console.log('MIRAGE analyzer smoke tests passed (3 cases).');
