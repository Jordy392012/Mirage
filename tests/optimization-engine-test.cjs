const assert = require('node:assert/strict');
require('../optimization-engine.js');
const engine = global.MirageOptimizationEngine;
assert.equal(engine.version, '0.2.0');
const tests = [
  ['square', 'float a = powf(x, 2);', '(x * x)', 'power-two-to-multiply'],
  ['square decimal exponent', 'float a = pow(values[i], 2.0);', '(values[i] * values[i])', 'power-two-to-multiply'],
  ['cube', 'float a = powf(x, 3.0f);', '(x * x * x)', 'power-three-to-multiply'],
  ['multiply one', 'int a = count * 1;', 'count', 'multiply-by-one'],
  ['multiply one reversed', 'int a = 1 * count;', 'count', 'multiply-by-one'],
  ['divide one', 'int a = count / 1;', 'count', 'divide-by-one'],
  ['add zero', 'int a = count + 0;', 'count', 'add-zero'],
  ['subtract zero', 'int a = count - 0;', 'count', 'subtract-zero']
];
for (const [name, source, expected, id] of tests) {
  const result = engine.optimizeSource(source, 'test.cpp');
  assert.ok(result.changes.some(change => change.id === id), name + ' rule not found: ' + JSON.stringify(result.changes));
  assert.ok(result.source.includes(expected), name + ' replacement missing: ' + result.source);
}
const protectedText = '// powf(x, 2)\nconst char *s = "pow(x, 2)";\nfloat a = powf(makeValue(), 2);';
assert.equal(engine.optimizeSource(protectedText, 'test.cpp').changes.length, 0, 'comments, strings and side-effecting calls must be untouched');
const memberAccess = 'int a = object.value + 0; int b = this->value * 1;';
assert.equal(engine.optimizeSource(memberAccess, 'test.cpp').changes.length, 0, 'member access must not be partially rewritten');
const mixed = engine.optimizeSource('int a = count * 1;\nfloat b = powf(v, 2);\nint c = total / 1;', 'mixed.cpp');
assert.equal(mixed.changes.length, 3, 'multiple rewrite rules should work in one file');
assert.ok(mixed.source.includes('int a = count;') && mixed.source.includes('(v * v)') && mixed.source.includes('int c = total;'), 'mixed replacements should preserve surrounding source');
assert.equal(engine.optimizeSource('float x = powf(v, 2);', 'readme.txt').skipped, 'Not a supported C/C++ source file.');
const advice = engine.optimizeSource('void loop(){ for(int i=0;i<100;i++){ Serial.println(powf(x,2)); } String msg = "hello"; }', 'main.ino');
assert.ok(advice.opportunities.some(item => item.id === 'math-in-loop'));
assert.ok(advice.opportunities.some(item => item.id === 'serial-in-loop'));
assert.ok(advice.opportunities.some(item => item.id === 'dynamic-allocation'));
console.log('optimization-engine tests passed:', tests.length + 5, 'checks');
