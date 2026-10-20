(function (root) {
  'use strict';

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function numberAfter(pattern, text) {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : null;
  }

  function parseSerialLog(rawText) {
    const text = String(rawText || '').replace(/\r/g, '');
    const isMirageLog = /MIRAGE\s+ESP32-S3\s+powf-vs-multiply benchmark/i.test(text);
    const trials = [];
    const trialPattern = /Trial\s+(\d+)\s*:\s*powf\s*=\s*(\d+(?:\.\d+)?)\s*us\s*\|\s*multiply\s*=\s*(\d+(?:\.\d+)?)\s*us/gi;
    let match;
    while ((match = trialPattern.exec(text))) {
      trials.push({ trial: Number(match[1]), powfUs: Number(match[2]), multiplyUs: Number(match[3]) });
    }
    const powfMedianUs = numberAfter(/Median\s+powf\s*:\s*(\d+(?:\.\d+)?)\s*us/i, text);
    const multiplyMedianUs = numberAfter(/Median\s+multiply\s*:\s*(\d+(?:\.\d+)?)\s*us/i, text);
    const checksumMatch = /Checksum comparison\s*:\s*(PASS|FAIL)\b/i.exec(text);
    const checksumValue = label => numberAfter(new RegExp(label + '\\s+checksum\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)', 'i'), text);
    const powfChecksum = checksumValue('powf');
    const multiplyChecksum = checksumValue('multiply');
    const ratio = powfMedianUs !== null && multiplyMedianUs > 0 ? powfMedianUs / multiplyMedianUs : null;
    const samples = numberAfter(/Samples\s*:\s*(\d+)/i, text);
    const repeats = numberAfter(/repeats\s*:\s*(\d+)/i, text);
    const declaredTrials = numberAfter(/trials\s*:\s*(\d+)/i, text);
    const freeHeapBefore = numberAfter(/Free heap before\s*:\s*(\d+)/i, text);
    const freeHeapAfter = numberAfter(/Free heap after\s*:\s*(\d+)/i, text);
    const minimumFreeHeapBefore = numberAfter(/Minimum free heap before\s*:\s*(\d+)/i, text);
    const minimumFreeHeapAfter = numberAfter(/Minimum free heap after\s*:\s*(\d+)/i, text);
    const errors = [];
    if (!isMirageLog) errors.push('This does not look like a MIRAGE ESP32-S3 powf-vs-multiply benchmark log.');
    if (!trials.length) errors.push('No trial timing lines were found.');
    if (powfMedianUs === null || multiplyMedianUs === null || ratio === null) errors.push('Both median timing lines are required.');
    if (!checksumMatch) errors.push('The final checksum comparison line is missing.');
    return {
      valid: errors.length === 0,
      errors,
      samples,
      repeats,
      declaredTrials,
      trials,
      trialCount: trials.length,
      powfMedianUs,
      multiplyMedianUs,
      ratio,
      reportedRatio: numberAfter(/Median ratio powf\/multiply\s*:\s*(\d+(?:\.\d+)?)\s*x/i, text),
      checksumPass: checksumMatch ? checksumMatch[1].toUpperCase() === 'PASS' : null,
      powfChecksum,
      multiplyChecksum,
      freeHeapBefore,
      freeHeapAfter,
      minimumFreeHeapBefore,
      minimumFreeHeapAfter,
      rawLog: text.trim()
    };
  }

  function comparisonKey(record) {
    const parsed = record && record.parsed || {};
    return [record && record.target || '', record && record.buildSettings || '', parsed.samples || '', parsed.repeats || ''].map(value => String(value).trim().toLowerCase()).join('|');
  }

  function assess(record, history) {
    const parsed = record && record.parsed || {};
    if (parsed.checksumPass === false) return { code: 'correctness-failed', label: 'Correctness check failed', explanation: 'The benchmark checksum comparison failed. Do not treat this run as evidence of a safe optimization.' };
    if (parsed.checksumPass !== true || !Number.isFinite(parsed.ratio)) return { code: 'incomplete', label: 'Incomplete evidence', explanation: 'A complete timing result and passing checksum comparison are required before evaluating performance.' };
    const ratio = parsed.ratio;
    if (ratio >= 0.99 && ratio <= 1.01) return { code: 'no-measured-improvement', label: 'No measured improvement', explanation: 'The median timings are within 1% of each other. This run does not demonstrate a meaningful speed advantage.' };

    const direction = ratio > 1 ? 'multiply-faster' : 'powf-faster';
    const magnitude = Math.abs(ratio - 1);
    const key = comparisonKey(record);
    const comparable = (Array.isArray(history) ? history : []).filter(item => comparisonKey(item) === key && item.parsed && item.parsed.checksumPass === true && Number.isFinite(item.parsed.ratio) && Math.abs(item.parsed.ratio - 1) >= 0.03);
    const directions = comparable.map(item => item.parsed.ratio > 1 ? 'multiply-faster' : 'powf-faster');
    const sameDirection = directions.every(item => item === direction);
    const hasSettings = Boolean(String(record.buildSettings || '').trim());
    if (magnitude >= 0.03 && hasSettings && comparable.length >= 3 && sameDirection) {
      return { code: 'verified', label: 'Verified for this benchmark setup', explanation: 'At least three comparable runs show a consistent direction and a median difference of 3% or more. This applies only to this benchmark, board, and recorded build configuration.' };
    }
    const faster = direction === 'multiply-faster' ? 'x * x' : 'powf(x, 2.0f)';
    const settingsNote = hasSettings ? '' : ' Record the compiler/core and build settings before attempting verification.';
    return { code: 'candidate', label: 'Candidate — not verified', explanation: faster + ' was faster in this run, but one result is not enough to establish a repeatable improvement. Collect at least three comparable runs with the same recorded configuration.' + settingsNote };
  }

  const api = { parseSerialLog, assess, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MirageBenchmarkResults = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
