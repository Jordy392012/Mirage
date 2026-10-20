/*
 * MIRAGE Studio optimization engine.
 * Source rewrites are reviewable candidates, not proof of faster execution.
 * Heuristic opportunity reports never claim a measured speedup.
 */
(function (root) {
  'use strict';

  const SUPPORTED = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.ino']);

  // Replace comments and quoted text with spaces while preserving offsets/newlines.
  function maskNonCode(source) {
    const chars = source.split('');
    let state = 'code';
    let quote = '';
    for (let i = 0; i < source.length; i++) {
      const ch = source[i], next = source[i + 1];
      if (state === 'code') {
        if (ch === '/' && next === '/') { chars[i] = chars[i + 1] = ' '; i++; state = 'line-comment'; }
        else if (ch === '/' && next === '*') { chars[i] = chars[i + 1] = ' '; i++; state = 'block-comment'; }
        else if (ch === '"' || ch === "'") { quote = ch; chars[i] = ' '; state = 'quoted'; }
      } else if (state === 'line-comment') {
        if (ch === '\n') state = 'code'; else chars[i] = ' ';
      } else if (state === 'block-comment') {
        if (ch === '*' && next === '/') { chars[i] = chars[i + 1] = ' '; i++; state = 'code'; }
        else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      } else if (state === 'quoted') {
        if (ch === '\\') {
          chars[i] = ' ';
          if (i + 1 < source.length) { if (source[i + 1] !== '\n' && source[i + 1] !== '\r') chars[i + 1] = ' '; i++; }
        } else if (ch === quote) { chars[i] = ' '; state = 'code'; }
        else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      }
    }
    return chars.join('');
  }

  function lineAt(source, offset) { return source.slice(0, offset).split('\n').length; }

  function findOpportunities(source, masked) {
    const out = [];
    const add = (id, title, severity, reason, suggestion, pattern) => {
      const match = pattern.exec(masked);
      if (match) out.push({ id, title, severity, line: lineAt(source, match.index), reason, suggestion });
    };
    add('math-in-loop', 'Expensive math near a loop', 'medium',
      'A loop and a math-library call occur close together. If the inputs are invariant across iterations, repeated work may be avoidable.',
      'Inspect the loop and hoist only calculations whose inputs truly do not change. Do not cache values that depend on changing sensor data or state.',
      /\b(?:for|while)\s*\([^)]*\)[\s\S]{0,500}?\b(?:powf?|sqrtf?|sinf?|cosf?|tanf?|logf?|expf?)\s*\(/);
    add('serial-in-loop', 'Serial output near a loop', 'medium',
      'Serial printing inside or near a loop can dominate runtime and change timing.',
      'Consider reducing log frequency, buffering diagnostics, or compiling diagnostic output out of performance-critical builds.',
      /\b(?:for|while)\s*\([^)]*\)[\s\S]{0,500}?\bSerial\s*\.\s*(?:print|println|printf)\s*\(/);
    add('dynamic-allocation', 'Dynamic allocation / Arduino String', 'medium',
      'Dynamic allocation can add latency and fragment limited heap memory in long-running embedded programs.',
      'Review repeated allocations; where lifetime and maximum size are known, consider fixed-capacity buffers or reusable storage. Check truncation and ownership carefully.',
      /\b(?:malloc|calloc|realloc|free|new\s+[A-Za-z_]|String\s+[A-Za-z_])/);
    add('strlen-in-loop', 'String length calculation near a loop', 'low',
      'strlen walks the string each time it is called, so repeating it in a loop may repeat work.',
      'If the string is unchanged, compute its length once before the loop; do not cache it if the string can change.',
      /\b(?:for|while)\s*\([^)]*\)[\s\S]{0,500}?\bstrlen\s*\(/);
    add('modulo-in-loop', 'Modulo operation near a loop', 'low',
      'Modulo in a hot loop may cost more than simpler index arithmetic, depending on the divisor and compiler.',
      'Measure first. For power-of-two ring buffers, consider a correctly typed unsigned mask only after proving the buffer size and wrap semantics.',
      /\b(?:for|while)\s*\([^)]*\)[\s\S]{0,500}?%\s*[A-Za-z_0-9(]/);
    add('nested-loops', 'Multiple loop headers close together', 'medium',
      'Two loop headers occur close together in the source. This heuristic cannot prove they are nested or that either is a bottleneck.',
      'Inspect the actual braces and control flow. If loops are nested, check whether work can be reduced or precomputed while preserving iteration order.',
      /\bfor\s*\([^)]*\)[\s\S]{0,500}?\bfor\s*\(/);
    add('double-precision', 'Double-precision arithmetic', 'low',
      'Some embedded targets handle double precision more slowly than single precision; exact cost depends on the chip and toolchain.',
      'If the algorithm permits lower precision, test float against double with tolerances and real measurements. Do not change precision blindly.',
      /\bdouble\s+[A-Za-z_]/);
    add('large-stack-buffer', 'Large fixed-array candidate', 'medium',
      'A fixed-size array with an obvious numeric size may use substantial stack or static memory depending on where it is declared.',
      'Check the declaration scope, task stack high-water marks, and linker map. Consider another storage strategy only after reviewing lifetime, reentrancy, and task concurrency.',
      /\b(?:uint8_t|int8_t|char|short|int|float|double)\s+[A-Za-z_]\w*\s*\[\s*(?:\d{3,}|\d+\s*\*\s*\d+)\s*\]/);
    return out;
  }

  function optimizeSource(source, filename) {
    source = String(source || '');
    const extension = String(filename || '').toLowerCase().match(/\.[^.\/]+$/)?.[0] || '';
    if (!SUPPORTED.has(extension)) return { source, changes: [], opportunities: [], skipped: 'Not a supported C/C++ source file.' };

    const masked = maskNonCode(source);
    const candidates = [];
    const operand = String.raw`[A-Za-z_]\w*(?:\s*\[\s*(?:[A-Za-z_]\w*|\d+)\s*\])?`;
    const rules = [
      {
        id: 'power-two-to-multiply', rule: 'Square via multiplication',
        pattern: new RegExp(String.raw`(?<![\w.>:])\bpowf?\s*\(\s*(${operand})\s*,\s*2(?:\.0f?|f)?\s*\)`, 'g'),
        replace: m => `(${m[1].trim()} * ${m[1].trim()})`,
        reason: 'Replaces a square call with multiplication when the argument is a simple identifier or array element.',
        caution: 'Floating-point edge cases can differ, and the compiler may already optimize this. Compile and benchmark.'
      },
      {
        id: 'power-three-to-multiply', rule: 'Cube via multiplication',
        pattern: new RegExp(String.raw`(?<![\w.>:])\bpowf?\s*\(\s*(${operand})\s*,\s*3(?:\.0f?|f)?\s*\)`, 'g'),
        replace: m => `(${m[1].trim()} * ${m[1].trim()} * ${m[1].trim()})`,
        reason: 'Offers a multiplication candidate for a literal cube with a simple argument.',
        caution: 'This can change rounding, overflow, NaN, and floating-point exception behavior. Review and test carefully.'
      },
      {
        id: 'multiply-by-one', rule: 'Remove multiplication by one',
        pattern: new RegExp(String.raw`(?:(?<![\w.>:])\b(${operand})\s*\*\s*1\b|(?<![\w.>:])\b1\s*\*\s*(${operand}))`, 'g'),
        replace: m => (m[1] || m[2]).trim(),
        reason: 'Removes a redundant multiplication by the integer literal one.',
        caution: 'Only simple identifiers/array elements are matched. Review overloaded types and floating-point edge cases.'
      },
      {
        id: 'divide-by-one', rule: 'Remove division by one',
        pattern: new RegExp(String.raw`(?<![\w.>:])\b(${operand})\s*/\s*1\b`, 'g'),
        replace: m => m[1].trim(),
        reason: 'Removes division by the integer literal one.',
        caution: 'Review type conversions and overloaded operators; compile and test the changed expression.'
      },
      {
        id: 'add-zero', rule: 'Remove addition of zero',
        pattern: new RegExp(String.raw`(?<![\w.>:])\b(${operand})\s*\+\s*0\b`, 'g'),
        replace: m => m[1].trim(),
        reason: 'Removes addition of the integer literal zero.',
        caution: 'Floating-point signed zero and overloaded operators can make this observably different.'
      },
      {
        id: 'subtract-zero', rule: 'Remove subtraction of zero',
        pattern: new RegExp(String.raw`(?<![\w.>:])\b(${operand})\s*-\s*0\b`, 'g'),
        replace: m => m[1].trim(),
        reason: 'Removes subtraction of the integer literal zero.',
        caution: 'Review floating-point signed-zero behavior and overloaded operators before keeping it.'
      }
    ];

    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(masked)) !== null) {
        // Avoid matching a call nested inside a larger identifier, and only accept
        // simple operands by construction. Keep source offsets for exact patching.
        const original = source.slice(match.index, match.index + match[0].length);
        candidates.push({ id: rule.id, rule: rule.rule, reason: rule.reason, caution: rule.caution,
          original, replacement: rule.replace(match), offset: match.index, line: lineAt(source, match.index) });
        if (match[0].length === 0) rule.pattern.lastIndex++;
      }
    }

    // Drop overlapping candidates; when multiple rules touch the same span, prefer
    // the earliest registered rule. All remaining patches apply right-to-left.
    candidates.sort((a, b) => a.offset - b.offset || b.original.length - a.original.length);
    const changes = [];
    for (const candidate of candidates) {
      const end = candidate.offset + candidate.original.length;
      if (changes.some(existing => candidate.offset < existing.offset + existing.original.length && end > existing.offset)) continue;
      changes.push(candidate);
    }
    let optimized = source;
    for (const change of changes.slice().sort((a, b) => b.offset - a.offset)) {
      optimized = optimized.slice(0, change.offset) + change.replacement + optimized.slice(change.offset + change.original.length);
    }
    return { source: optimized, changes, opportunities: findOpportunities(source, masked), skipped: null };
  }

  root.MirageOptimizationEngine = Object.freeze({ optimizeSource, maskNonCode, version: '0.2.0' });
})(typeof window !== 'undefined' ? window : globalThis);
