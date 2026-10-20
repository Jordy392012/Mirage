const assert = require('node:assert/strict');
require('../optimization-engine.js');
const engine = global.MirageOptimizationEngine;
assert.equal(engine.version, '0.4.0');
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

const repeatedLoop = engine.optimizeSource(
  'void loop() { for (int i = 0; i < 10; ++i) { out[i] = scale * 0.5f; other[i] = scale * 0.5f; } }',
  'loop.cpp'
);
assert.ok(repeatedLoop.opportunities.some(item => item.id === 'repeated-loop-expression'),
  'should detect repeated arithmetic in a braced loop when named operands are not assigned');
const mutatedLoop = engine.optimizeSource(
  'void loop() { for (int i = 0; i < 10; ++i) { scale = scale + 1; out[i] = scale * 2; other[i] = scale * 2; } }',
  'loop.cpp'
);
assert.ok(!mutatedLoop.opportunities.some(item => item.id === 'repeated-loop-expression'),
  'should not suggest hoisting an expression whose named operand is assigned in the loop');
const nonLoopRepeat = engine.optimizeSource(
  'void run() { out = scale * 2; other = scale * 2; }',
  'loop.cpp'
);
assert.ok(!nonLoopRepeat.opportunities.some(item => item.id === 'repeated-loop-expression'),
  'should only report repeated expressions inside braced loops');
const commentedRepeat = engine.optimizeSource(
  'void loop() { for (int i=0; i<10; ++i) { out = scale * 2; // scale * 2\n } }',
  'loop.cpp'
);
assert.ok(!commentedRepeat.opportunities.some(item => item.id === 'repeated-loop-expression'),
  'comments must not count as repeated arithmetic');

console.log('optimization-engine tests passed: 27 checks');

const cacheableLoop = engine.optimizeSource(
  'void loop() { const float scale = 0.5f; for (int i=0; i<10; ++i) { out[i] = scale * 2.0f; other[i] = scale * 2.0f; } }',
  'loop.cpp'
);
assert.ok(cacheableLoop.changes.some(change => change.id === 'cache-repeated-loop-arithmetic'),
  'should generate an actual cached temporary for repeated arithmetic with const scalar operands');
assert.ok(cacheableLoop.changes.filter(change => change.id === 'replace-repeated-loop-arithmetic').length >= 2,
  'should replace each repeated arithmetic occurrence');
assert.ok(cacheableLoop.source.includes('const auto _mirage_cached_1 = scale * 2.0f;'),
  'should insert a real temporary declaration into the rewritten source');
assert.ok(!cacheableLoop.source.includes('other[i] = scale * 2.0f'),
  'should replace repeated expression uses in the output source');

const mutableLoop = engine.optimizeSource(
  'void loop() { float scale = 0.5f; for (int i=0; i<10; ++i) { out[i] = scale * 2.0f; other[i] = scale * 2.0f; } }',
  'loop.cpp'
);
assert.ok(!mutableLoop.changes.some(change => change.id === 'cache-repeated-loop-arithmetic'),
  'must not cache expressions using non-const operands');

const conditionalLoop = engine.optimizeSource(
  'void loop() { const float scale = 0.5f; for (int i=0; i<10; ++i) { if (ready) out[i] = scale * 2.0f; other[i] = scale * 2.0f; } }',
  'loop.cpp'
);
assert.ok(!conditionalLoop.changes.some(change => change.id === 'cache-repeated-loop-arithmetic'),
  'must not cache arithmetic in conditional/nested control flow');

const functionAndArray = engine.optimizeSource(
  'void loop() { for (int i=0; i<10; ++i) { float a = sinf(angle); float b = sinf(angle); float x = values[i]; float y = values[i]; } }',
  'loop.cpp'
);
assert.ok(functionAndArray.opportunities.some(item => item.id === 'repeated-loop-call' && item.confidence),
  'should report repeated function calls with confidence');
assert.ok(functionAndArray.opportunities.some(item => item.id === 'repeated-array-access' && item.confidence),
  'should report repeated array accesses with confidence');

const unrelatedConst = engine.optimizeSource(
  'void first() { const float scale = 0.5f; } void loop() { float scale = 0.5f; for (int i=0; i<10; ++i) { out[i] = scale * 2.0f; other[i] = scale * 2.0f; } }',
  'loop.cpp'
);
assert.ok(!unrelatedConst.changes.some(change => change.id === 'cache-repeated-loop-arithmetic'),
  'a const declaration from another function must not authorize a rewrite');

const nameCollision = engine.optimizeSource(
  'void loop() { const float scale = 0.5f; float _mirage_cached_1 = 9; for (int i=0; i<10; ++i) { out[i] = scale * 2.0f; other[i] = scale * 2.0f; } }',
  'loop.cpp'
);
assert.ok(nameCollision.source.includes('const auto _mirage_cached_2 = scale * 2.0f;'),
  'generated temporary names must not collide with identifiers already in the source');
