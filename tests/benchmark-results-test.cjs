 'use strict';
const assert = require('node:assert/strict');
const { parseSerialLog, assess } = require('../benchmark-results.js');
const sample = `MIRAGE ESP32-S3 powf-vs-multiply benchmark
Samples: 256 | repeats: 400 | trials: 7
Free heap before: 348332 bytes
Minimum free heap before: 343184 bytes
Trial 1: powf=3024 us | multiply=3024 us
Trial 2: powf=3024 us | multiply=3023 us
Trial 3: powf=3024 us | multiply=3023 us
Trial 4: powf=3024 us | multiply=3084 us
Trial 5: powf=3028 us | multiply=3024 us
Trial 6: powf=3024 us | multiply=3028 us
Trial 7: powf=3028 us | multiply=3023 us
powf checksum: 83781.6328125
multiply checksum: 83781.6328125
Checksum comparison: PASS (tolerance 8.3781633)
Median powf: 3024 us
Median multiply: 3024 us
Median ratio powf/multiply: 1.000x
Free heap after: 348068 bytes
Minimum free heap after: 342920 bytes
Observable sink: 83781.6328125
Benchmark complete.`;
const parsed = parseSerialLog(sample);
assert.equal(parsed.valid, true, parsed.errors.join('; '));
assert.equal(parsed.trialCount, 7);
assert.equal(parsed.samples, 256);
assert.equal(parsed.repeats, 400);
assert.equal(parsed.powfMedianUs, 3024);
assert.equal(parsed.multiplyMedianUs, 3024);
assert.equal(parsed.ratio, 1);
assert.equal(parsed.checksumPass, true);
assert.equal(parsed.freeHeapBefore, 348332);
assert.equal(parsed.freeHeapAfter, 348068);
const record = { target: 'ESP32-S3', buildSettings: '', parsed };
assert.equal(assess(record, [record]).code, 'no-measured-improvement');
const incomplete = parseSerialLog(sample.replace('Checksum comparison: PASS', 'Checksum comparison: FAIL'));
assert.equal(incomplete.valid, true);
assert.equal(assess({ target: 'ESP32-S3', buildSettings: 'core 3.x', parsed: incomplete }, []).code, 'correctness-failed');
assert.equal(parseSerialLog('not a benchmark').valid, false);
function candidate(ratio) { return { target: 'ESP32-S3', buildSettings: 'Arduino-ESP32 core 3.3; 240MHz; default optimization', parsed: { checksumPass: true, ratio, samples: 256, repeats: 400 } }; }
const run1 = candidate(1.06), run2 = candidate(1.05), run3 = candidate(1.07);
assert.equal(assess(run1, [run1]).code, 'candidate');
assert.equal(assess(run3, [run1, run2, run3]).code, 'verified');
const conflicting = candidate(0.94);
assert.equal(assess(conflicting, [run1, run2, conflicting]).code, 'candidate');
console.log('MIRAGE benchmark-results parser and evidence tests passed.');
