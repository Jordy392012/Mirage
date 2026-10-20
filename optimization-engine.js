/*
 * MIRAGE Studio optimization engine.
 * Static source rewrites are candidates, not proof of faster execution.
 * Keep passes narrow, avoid side-effecting operands, and return auditable diffs.
 */
(function (root) {
  'use strict';

  function maskNonCode(source) {
    const chars = source.split('');
    let state = 'code';
    let quote = '';
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (state === 'code') {
        if (ch === '/' && next === '/') {
          chars[i] = chars[i + 1] = ' '; i++; state = 'line-comment';
        } else if (ch === '/' && next === '*') {
          chars[i] = chars[i + 1] = ' '; i++; state = 'block-comment';
        } else if (ch === '"' || ch === "'") {
          quote = ch; chars[i] = ' '; state = 'quoted';
        }
      } else if (state === 'line-comment') {
        if (ch === '\n') state = 'code'; else chars[i] = ' ';
      } else if (state === 'block-comment') {
        if (ch === '*' && next === '/') {
          chars[i] = chars[i + 1] = ' '; i++; state = 'code';
        } else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      } else if (state === 'quoted') {
        if (ch === '\\') {
          chars[i] = ' ';
          if (i + 1 < source.length) {
            if (source[i + 1] !== '\n' && source[i + 1] !== '\r') chars[i + 1] = ' ';
            i++;
          }
        } else if (ch === quote) { chars[i] = ' '; state = 'code'; }
        else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      }
    }
    return chars.join('');
  }

  function optimizeSource(source, filename) {
    source = String(source || '');
    const extension = String(filename || '').toLowerCase().match(/\.[^.\/]+$/)?.[0] || '';
    const supported = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.ino']);
    if (!supported.has(extension)) return { source, changes: [], skipped: 'Not a supported C/C++ source file.' };

    const masked = maskNonCode(source);
    const changes = [];
    // Narrow rule: simple identifiers/array reads only. Never duplicate calls,
    // increments, or other operand expressions that might have side effects.
    const pattern = /\b(powf?)\s*\(\s*([A-Za-z_]\w*(?:\s*\[\s*(?:[A-Za-z_]\w*|\d+)\s*\])?)\s*,\s*2(?:\.0f?|f)?\s*\)/g;
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const operand = match[2].trim();
      const original = source.slice(match.index, match.index + match[0].length);
      const replacement = `(${operand} * ${operand})`;
      changes.push({
        id: 'power-of-two-to-multiply', rule: 'Power of two → multiplication',
        reason: 'Replaces pow/powf with a literal exponent of 2 when the operand is a simple identifier or array element.',
        caution: 'Floating-point edge cases can differ; the compiler may already optimize this. Compile and benchmark before keeping it.',
        original, replacement, offset: match.index,
        line: source.slice(0, match.index).split('\n').length
      });
    }

    let optimized = source;
    for (const change of changes.slice().reverse()) {
      optimized = optimized.slice(0, change.offset) + change.replacement + optimized.slice(change.offset + change.original.length);
    }
    return { source: optimized, changes, skipped: null };
  }

  root.MirageOptimizationEngine = Object.freeze({ optimizeSource, maskNonCode, version: '0.1.0' });
})(typeof window !== 'undefined' ? window : globalThis);
