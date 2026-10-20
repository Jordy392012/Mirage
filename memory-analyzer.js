/*
 * MIRAGE Studio memory-analysis helpers.
 * This is a conservative source scanner, not a C/C++ parser or linker-map reader.
 * It reports supported array declarations and intentionally leaves uncertain sizes unresolved.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MirageMemoryAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Approximate sizes for the ESP32-S3's common GCC data model. Compiler flags,
  // typedefs, packed structs, and target-specific declarations can differ.
  const TYPE_BYTES = new Map([
    ['char', 1], ['signed char', 1], ['unsigned char', 1], ['int8_t', 1], ['uint8_t', 1], ['byte', 1], ['bool', 1],
    ['short', 2], ['short int', 2], ['signed short', 2], ['signed short int', 2], ['unsigned short', 2], ['unsigned short int', 2], ['int16_t', 2], ['uint16_t', 2],
    ['int', 4], ['signed int', 4], ['unsigned int', 4], ['long', 4], ['long int', 4], ['signed long', 4], ['signed long int', 4], ['unsigned long', 4], ['unsigned long int', 4],
    ['int32_t', 4], ['uint32_t', 4], ['float', 4], ['size_t', 4],
    ['long long', 8], ['long long int', 8], ['signed long long', 8], ['signed long long int', 8], ['unsigned long long', 8], ['unsigned long long int', 8],
    ['int64_t', 8], ['uint64_t', 8], ['double', 8]
  ]);

  function maskNonCode(source) {
    const chars = source.split('');
    let state = 'code';
    let quote = '';
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (state === 'code') {
        if (ch === '/' && next === '/') {
          chars[i] = chars[i + 1] = ' ';
          i++;
          state = 'line-comment';
        } else if (ch === '/' && next === '*') {
          chars[i] = chars[i + 1] = ' ';
          i++;
          state = 'block-comment';
        } else if (ch === '"' || ch === "'") {
          quote = ch;
          chars[i] = ' ';
          state = 'quoted';
        }
      } else if (state === 'line-comment') {
        if (ch === '\n') state = 'code';
        else chars[i] = ' ';
      } else if (state === 'block-comment') {
        if (ch === '*' && next === '/') {
          chars[i] = chars[i + 1] = ' ';
          i++;
          state = 'code';
        } else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      } else if (state === 'quoted') {
        if (ch === '\\') {
          chars[i] = ' ';
          if (i + 1 < source.length) {
            if (source[i + 1] !== '\n' && source[i + 1] !== '\r') chars[i + 1] = ' ';
            i++;
          }
        } else if (ch === quote) {
          chars[i] = ' ';
          state = 'code';
        } else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      }
    }
    return chars.join('');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function lineAt(source, index) {
    return source.slice(0, Math.max(0, index)).split('\n').length;
  }

  function resolvePositiveInteger(token, constants) {
    const clean = String(token || '').trim().replace(/[uUlL]+$/g, '');
    if (/^\d+$/.test(clean)) {
      const value = Number(clean);
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    }
    return constants.get(clean);
  }

  function scanArrayDeclarations(source, fileName = 'main.cpp') {
    const code = maskNonCode(String(source || ''));
    const constants = new Map();
    const arrays = [];
    const findings = [];

    // Resolve decimal #defines and simple integer constexpr/const declarations.
    const defineRegex = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(\d+)[uUlL]*\s*$/gm;
    let match;
    while ((match = defineRegex.exec(code)) !== null) {
      const value = Number(match[2]);
      if (Number.isSafeInteger(value) && value > 0) constants.set(match[1], value);
    }
    const constantRegex = /\b(?:(?:static|inline)\s+)*(?:constexpr|const)\s+(?:(?:unsigned|signed)\s+)?(?:char|short(?:\s+int)?|int|long(?:\s+int)?|long\s+long(?:\s+int)?|size_t|u?int(?:8|16|32|64)_t)\s+([A-Za-z_]\w*)\s*=\s*(\d+)[uUlL]*\s*;/g;
    while ((match = constantRegex.exec(code)) !== null) {
      const value = Number(match[2]);
      if (Number.isSafeInteger(value) && value > 0) constants.set(match[1], value);
    }

    // Deliberately handles one built-in-type array declarator per statement.
    // More complex declarators, typedefs, templates, and preprocessor branches are out of scope.
    const declarationPattern = /(?:(?<=^)|(?<=[;{}\n]))\s*((?:(?:static|constexpr|const|volatile|PROGMEM|extern|inline|DRAM_ATTR|DMA_ATTR|EXT_RAM_ATTR)\s+)*)((?:(?:unsigned|signed)\s+)?(?:char|short(?:\s+int)?|int|long(?:\s+int)?|long\s+long(?:\s+int)?|float|double|bool|byte|size_t|u?int(?:8|16|32|64)_t))\s+([A-Za-z_]\w*)\s*((?:\s*\[\s*[^\]]*\s*\])+?)\s*(?:(?:PROGMEM|DRAM_ATTR|DMA_ATTR|EXT_RAM_ATTR)\s*)*(?:=\s*[^;]*)?\s*;/gm;

    while ((match = declarationPattern.exec(code)) !== null) {
      const qualifiers = match[1] || '';
      const type = String(match[2] || '').replace(/\s+/g, ' ').trim();
      const name = match[3];
      const dimensionsText = match[4] || '';
      const declarationStart = match.index + Math.max(0, match[0].indexOf(name));
      const declarationText = String(source).slice(match.index, match.index + match[0].length);
      const fullFlags = `${qualifiers} ${declarationText}`;
      const isExtern = /\bextern\b/.test(qualifiers);
      const isStatic = /\bstatic\b/.test(qualifiers);
      const isProgmem = /\bPROGMEM\b/.test(fullFlags);
      const isPsramMarked = /\b(?:EXT_RAM_ATTR|PSRAM_ATTR)\b/.test(fullFlags);
      const isDramMarked = /\b(?:DRAM_ATTR|DMA_ATTR)\b/.test(fullFlags);
      const beforeName = code.slice(0, declarationStart);
      const scopeDepth = Math.max(0, (beforeName.match(/{/g) || []).length - (beforeName.match(/}/g) || []).length);

      const dimensionExpressions = [...dimensionsText.matchAll(/\[\s*([^\]]*)\s*\]/g)].map(part => part[1].trim());
      const resolvedDimensions = dimensionExpressions.map(token => resolvePositiveInteger(token, constants));
      const dimensionsKnown = resolvedDimensions.length > 0 && resolvedDimensions.every(value => Number.isSafeInteger(value) && value > 0);
      const bytesPerElement = TYPE_BYTES.get(type);
      let bytes = null;
      if (dimensionsKnown && bytesPerElement) {
        const elementCount = resolvedDimensions.reduce((product, value) => product * value, 1);
        const estimate = elementCount * bytesPerElement;
        if (Number.isSafeInteger(elementCount) && Number.isSafeInteger(estimate)) bytes = estimate;
      }
      // extern is only a declaration; counting it as storage here would be wrong.
      const includedInTotal = !isExtern && Number.isFinite(bytes);
      let storageClass;
      if (isExtern) storageClass = 'extern declaration (storage not counted here)';
      else if (isProgmem) storageClass = 'PROGMEM-marked (flash placement intended; verify linker map)';
      else if (isPsramMarked) storageClass = 'PSRAM-marked (verify toolchain attribute)';
      else if (isDramMarked) storageClass = 'DRAM/DMA-marked (verify toolchain attribute)';
      else if (isStatic) storageClass = 'static-duration candidate (placement unverified)';
      else if (scopeDepth === 0) storageClass = 'file-scope candidate (placement unverified)';
      else storageClass = 'inner scope (stack vs class/member placement uncertain)';

      const array = {
        file: fileName,
        name,
        type,
        dimensions: dimensionsKnown ? resolvedDimensions : null,
        dimensionExpressions,
        bytes,
        line: lineAt(String(source), match.index + Math.max(0, match[0].indexOf(type))),
        scopeDepth,
        storageClass,
        includedInTotal,
        sizeKnown: Number.isFinite(bytes)
      };
      arrays.push(array);

      if (Number.isFinite(bytes) && bytes >= 8192) {
        findings.push({
          id: `large-array-${name}`,
          severity: 'medium',
          title: `Large array: ${name}`,
          detail: `${name} is declared as ${type} with ${resolvedDimensions.join(' × ')} element${resolvedDimensions.reduce((n, v) => n * v, 1) === 1 ? '' : 's'} (about ${formatBytes(bytes)} at the assumed type size). Storage placement: ${storageClass}.`,
          recommendation: 'Check whether the full array must be resident at once. Consider chunking, reuse, a smaller representation, or flash/PSRAM placement when supported. Verify the actual linker section and runtime use before changing it.',
          offset: match.index
        });
      } else if (!Number.isFinite(bytes)) {
        findings.push({
          id: `unknown-array-${name}`,
          severity: 'low',
          title: `Array size not resolved: ${name}`,
          detail: `${name} uses dimension${dimensionExpressions.length === 1 ? '' : 's'} [${dimensionExpressions.join('] × [')}], but at least one dimension is not a supported positive integer or simple known constant. MIRAGE leaves its byte estimate unknown instead of counting it as zero.`,
          recommendation: 'Resolve the dimension from constants/macros or inspect the compiler output. Variable-length arrays, unsized declarations, and expressions are not assigned an invented size.',
          offset: match.index
        });
      }
    }

    return { arrays, findings, resolvedConstants: constants.size };
  }

  return { scanArrayDeclarations, maskNonCode };
});
