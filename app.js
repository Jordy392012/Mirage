(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SOURCE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.ino', '.txt', '.s', '.cmake']);
  const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_PROJECT_CHARS = 10 * 1024 * 1024;
  const TYPE_BYTES = {
    char: 1, 'signed char': 1, 'unsigned char': 1, int8_t: 1, uint8_t: 1, byte: 1, bool: 1,
    short: 2, 'short int': 2, 'unsigned short': 2, int16_t: 2, uint16_t: 2,
    int: 4, 'unsigned int': 4, long: 4, 'long int': 4, 'unsigned long': 4,
    int32_t: 4, uint32_t: 4, float: 4, double: 8, size_t: 4, 'long long': 8, int64_t: 8, uint64_t: 8
  };

  const DEMO_NAME = 'main.cpp';
  const DEMO_CODE = `#include <Arduino.h>
#include <math.h>

static uint16_t samples[4096];
static float windowBuffer[512];

void setup() {
  Serial.begin(115200);
}

void loop() {
  float total = 0.0f;

  // Example workload: a few patterns worth inspecting.
  for (int i = 0; i < 512; i++) {
    windowBuffer[i] = sinf(i * 0.03f) * 0.5f;
  }

  for (int row = 0; row < 32; row++) {
    for (int col = 0; col < 32; col++) {
      int index = row * 32 + col;
      total += windowBuffer[index % 512] * 0.25f;
    }
  }

  // For real firmware, frequent logging may affect timing.
  Serial.println(total);
  delay(10);
}
`;

  let projectFiles = [{ name: DEMO_NAME, content: DEMO_CODE }];
  let activeFileName = DEMO_NAME;
  let findings = [];
  let lastReport = null;
  let activeFilter = 'all';
  let toastTimeout = null;

  const fileInput = $('#fileInput');
  const codeInput = $('#codeInput');
  const lineGutter = $('#lineGutter');
  const fileStrip = $('.file-strip');
  const dropZone = $('#dropZone');

  function fileExtension(name) {
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index) : '';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escLine(text) {
    return String(text).replace(/\s+/g, ' ').trim();
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => element.classList.remove('visible'), 3300);
  }

  function getActiveFile() {
    return projectFiles.find(file => file.name === activeFileName) || projectFiles[0] || null;
  }

  function syncActiveContent() {
    const file = getActiveFile();
    if (file) file.content = codeInput.value;
  }

  function renderFileTabs() {
    // Recreate tabs using DOM nodes; file names are untrusted user input.
    fileStrip.replaceChildren();
    projectFiles.forEach(file => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `file-tab${file.name === activeFileName ? ' active' : ''}`;
      tab.title = file.name;
      tab.setAttribute('aria-pressed', String(file.name === activeFileName));
      const icon = document.createElement('span');
      icon.className = 'code-file-icon';
      icon.textContent = fileExtension(file.name).toLowerCase() === '.ino' ? 'IO' : fileExtension(file.name).toLowerCase() === '.h' || fileExtension(file.name).toLowerCase() === '.hpp' ? 'H' : 'C+';
      const name = document.createElement('span');
      name.textContent = file.name.split('/').pop();
      const bullet = document.createElement('span');
      bullet.className = 'tab-close';
      bullet.textContent = '•';
      tab.append(icon, name, bullet);
      tab.addEventListener('click', () => switchFile(file.name));
      fileStrip.append(tab);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.id = 'addFileButton'; add.className = 'add-file-button'; add.title = 'Add or upload files'; add.textContent = '+';
    add.addEventListener('click', () => fileInput.click());
    fileStrip.append(add);
    const hint = document.createElement('span');
    hint.className = 'file-strip-hint';
    hint.textContent = projectFiles.length > 1 ? `${projectFiles.length} files loaded` : 'Paste code or open files';
    fileStrip.append(hint);
    $('#activeFileName').textContent = activeFileName.split('/').pop();
    const ext = fileExtension(activeFileName).toLowerCase();
    $('#editorLanguage').textContent = ext === '.h' || ext === '.hpp' ? 'C/C++ HEADER' : ext === '.ino' ? 'ARDUINO' : ['.cmake', '.txt'].includes(ext) ? 'TEXT / BUILD' : 'C++';
  }

  function updateEditorMeta() {
    const lines = codeInput.value.length ? codeInput.value.split('\n').length : 0;
    lineGutter.textContent = Array.from({ length: Math.max(1, lines) }, (_, index) => index + 1).join('\n');
    $('#editorLineCount').textContent = `${lines} line${lines === 1 ? '' : 's'}`;
    $('#editorEmpty').hidden = codeInput.value.length > 0;
    $('#lineMetric').textContent = projectFiles.reduce((sum, file) => sum + (file.content.length ? file.content.split('\n').length : 0), 0).toLocaleString();
    $('#fileMetric').textContent = projectFiles.length.toLocaleString();
    $('#fileMetricDetail').textContent = projectFiles.length === 1 && projectFiles[0].name === DEMO_NAME ? 'Demo source loaded' : 'Source files loaded';
  }

  function switchFile(name) {
    syncActiveContent();
    activeFileName = name;
    const file = getActiveFile();
    codeInput.value = file ? file.content : '';
    renderFileTabs();
    updateEditorMeta();
  }

  function addFinding(list, item) {
    if (!list.some(existing => existing.id === item.id && existing.file === item.file)) list.push(item);
  }

  function analyzeFile(file) {
    const source = file.content || '';
    const lines = source.split('\n');
    const list = [];
    const lineOf = (matchIndex) => source.slice(0, Math.max(0, matchIndex)).split('\n').length;
    const add = (id, category, severity, title, detail, recommendation, index = 0) => addFinding(list, {
      id, category, severity, title, detail, recommendation, file: file.name,
      line: Math.max(1, lineOf(index)), excerpt: escLine(lines[Math.max(0, lineOf(index) - 1)] || '')
    });

    // Repeated strlen() work inside a loop condition can be avoided when the input is immutable.
    const strlenLoop = /\b(?:for|while)\s*\([^{}\n]*\bstrlen\s*\([^)]*\)/m.exec(source);
    if (strlenLoop) add('strlen-loop', 'speed', 'medium', 'Repeated string-length calculation in a loop', 'A loop condition appears to call strlen(). That can scan the same string repeatedly.', 'If the string cannot change during the loop, calculate its length once before entering the loop.', strlenLoop.index);

    // pow() may be expensive, but the best replacement depends on exponent and numeric requirements.
    const powMatch = /\bpowf?\s*\(/.exec(source);
    if (powMatch) add('pow-call', 'speed', 'low', 'Power function detected', 'A pow()/powf() call may be expensive on a small MCU, depending on the arguments and implementation.', 'For small constant integer exponents, compare repeated multiplication or a specialized routine. Verify numerical accuracy before changing it.', powMatch.index);

    const serialMatch = /\b(?:for|while)\s*\([^)]*\)\s*\{(?:(?!\})[\s\S]){0,700}?\bSerial\d*\s*\.\s*(?:print|println)\s*\(/.exec(source);
    if (serialMatch) {
      const serialIndex = serialMatch.index + serialMatch[0].search(/\bSerial\d*\s*\./);
      add('serial-loop', 'speed', 'medium', 'Serial logging in a looping workload', 'Serial output can dominate execution time when called frequently, especially at low baud rates.', 'Keep diagnostic output out of tight loops when measuring performance; buffer or rate-limit logs where appropriate.', serialIndex);
    }

    const stringMatch = /\bString\b/.exec(source);
    if (stringMatch) add('arduino-string', 'memory', 'medium', 'Arduino String usage detected', 'String operations can allocate and resize heap memory. Repeated concatenation may increase fragmentation risk in long-running firmware.', 'For hot paths or long-lived embedded services, consider reserved capacity, fixed-size buffers, or bounded string routines where suitable.', stringMatch.index);

    const dynamicMatch = /\b(?:malloc|calloc|realloc|free)\s*\(|\bnew\s+(?:const\s+)?[A-Za-z_]/.exec(source);
    if (dynamicMatch) add('dynamic-alloc', 'memory', 'low', 'Dynamic memory allocation detected', 'Heap allocation is not automatically bad, but repeated allocations can create fragmentation and variable latency.', 'Inspect allocation frequency and lifetimes. Consider startup allocation, reusable buffers, or a bounded pool for predictable workloads.', dynamicMatch.index);

    const delayMatch = /\b(?:delay|vTaskDelay|sleep|usleep)\s*\(/.exec(source);
    if (delayMatch) add('blocking-delay', 'speed', 'low', 'Explicit wait / delay detected', 'A wait is present. It may be intentional for scheduling, power, or device timing; it is not necessarily wasteful.', 'Check whether this wait belongs in the timing-critical path. For RTOS tasks, use the appropriate scheduling primitive instead of busy-waiting.', delayMatch.index);

    // Find a nested-loop-looking sequence. This is intentionally a heuristic, not a full parser.
    const nestedMatch = /\b(?:for|while)\s*\([^)]*\)\s*\{(?:(?!\})[\s\S]){0,500}?\b(?:for|while)\s*\(/.exec(source);
    if (nestedMatch) {
      const tail = nestedMatch[0].slice(1);
      const innerOffset = tail.search(/\b(?:for|while)\s*\(/);
      const innerIndex = nestedMatch.index + (innerOffset >= 0 ? innerOffset + 1 : 0);
      add('nested-loop', 'speed', 'medium', 'Nested loop pattern detected', 'Nested loops can multiply work as input sizes grow. The actual cost depends on loop bounds and the work inside each loop.', 'Profile this section first. Check whether calculations can be reused, data access can be improved, or the algorithm can avoid repeated comparisons.', innerIndex);
    }

    const copyMatch = /\b(?:memcpy|memmove)\s*\(/.exec(source);
    if (copyMatch) add('memory-copy', 'speed', 'low', 'Memory-copy operation detected', 'Large or repeated copies can consume time and create extra peak-memory demand.', 'Check whether the copy is needed, whether buffers can be reused, or whether the consumer can process the source directly. Do not remove copies that protect aliasing or ownership.', copyMatch.index);

    // Inventory supported built-in array declarations with a separate scanner.
    // Unknown dimensions remain null; they are never silently treated as 0 bytes.
    const memoryScan = window.MirageMemoryAnalyzer.scanArrayDeclarations(source, file.name);
    memoryScan.arrays.forEach(item => arrayObservations.push(item));
    memoryScan.findings.forEach(item => add(item.id, 'memory', item.severity, item.title, item.detail, item.recommendation, item.offset));
    return list;
  }

  // Conservative source rewrite: only identifiers or array elements with a simple
  // identifier/integer index are supported. Comments and quoted literals are masked
  // before matching so examples in prose are never rewritten. This is still a
  // lightweight lexer, not a complete C++ parser or proof of semantic equivalence.
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

  // This is a candidate rewrite, not a guarantee of identical floating-point edge
  // behavior or a measured speedup. Restricting array indices avoids duplicating
  // side effects such as i++ or function calls when the operand is evaluated twice.
  function suggestTransformations(source) {
    const changes = [];
    const masked = maskNonCode(source);
    const pattern = /\b(powf?)\s*\(\s*([A-Za-z_]\w*(?:\s*\[\s*(?:[A-Za-z_]\w*|\d+)\s*\])?)\s*,\s*2(?:\.0f?|f)?\s*\)/g;
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const operand = match[2].trim();
      changes.push({
        original: source.slice(match.index, match.index + match[0].length),
        replacement: `(${operand} * ${operand})`,
        offset: match.index
      });
    }
    let optimized = source;
    for (const change of [...changes].reverse()) {
      optimized = optimized.slice(0, change.offset) + change.replacement + optimized.slice(change.offset + change.original.length);
    }
    return { source: optimized, changes };
  }

  let arrayObservations = [];

  function buildAnalysis() {
    syncActiveContent();
    arrayObservations = [];
    const totalSourceLines = projectFiles.reduce((sum, file) => sum + (file.content ? file.content.split('\n').length : 0), 0);
    findings = projectFiles.flatMap(analyzeFile).sort((a, b) => {
      const severityRank = { high: 0, medium: 1, low: 2 };
      return (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || a.line - b.line;
    });
    const knownArrayBytes = arrayObservations.reduce((sum, item) => sum + (item.includedInTotal && Number.isFinite(item.bytes) ? item.bytes : 0), 0);
    const knownSizeArrayCount = arrayObservations.filter(item => Number.isFinite(item.bytes)).length;
    const unknownSizeArrayCount = arrayObservations.filter(item => !Number.isFinite(item.bytes)).length;
    lastReport = {
      tool: 'MIRAGE Studio', version: '0.4.0', target: 'ESP32-S3', analysisType: 'static heuristic scan', generatedAt: new Date().toISOString(),
      limitations: ['This report is not compiler output, a linker map, or a hardware benchmark.', 'Array inventory covers a limited set of built-in-type declarations. Unsupported expressions remain unknown; reported bytes are source-level estimates, not total RAM or peak live memory.', 'Storage class and memory-section labels are hints only; verify actual placement with the ESP-IDF linker map and runtime measurements.', 'Findings are heuristics and must be reviewed by a developer.'],
      summary: { files: projectFiles.length, sourceLines: totalSourceLines, findings: findings.length, matchedArrayCount: arrayObservations.length, knownSizeArrayCount, unknownSizeArrayCount, matchedArrayBytes: knownArrayBytes },
      files: projectFiles.map(file => ({ name: file.name, lines: file.content ? file.content.split('\n').length : 0, characters: file.content.length })),
      arrays: arrayObservations.map(({ file, name, type, dimensions, dimensionExpressions, bytes, line, scopeDepth, storageClass, includedInTotal, sizeKnown }) => ({ file, name, type, dimensions, dimensionExpressions, bytes, line, scopeDepth, storageClass, includedInTotal, sizeKnown })),
      findings: findings.map(({ id, category, severity, title, detail, recommendation, file, line, excerpt }) => ({ id, category, severity, title, detail, recommendation, file, line, excerpt }))
    };
    renderAnalysis(knownArrayBytes, totalSourceLines);
    toast(`Analysis complete: ${findings.length} potential finding${findings.length === 1 ? '' : 's'} to review.`);
  }

  function renderAnalysis(knownArrayBytes, totalSourceLines) {
    $('#lineMetric').textContent = totalSourceLines.toLocaleString();
    $('#findingMetric').textContent = findings.length.toLocaleString();
    $('#navFindingCount').textContent = findings.length.toString();
    $('#findingsHeadingCount').textContent = findings.length.toString();
    $('#ramMetric').textContent = formatBytes(knownArrayBytes);
    $('#knownArrayTotal').textContent = formatBytes(knownArrayBytes);
    $('#arrayCountLabel').textContent = `${arrayObservations.length} detected`;
    const barPct = knownArrayBytes === 0 ? 0 : Math.min(100, Math.round(knownArrayBytes / (128 * 1024) * 100));
    $('#arrayBar').style.width = `${barPct}%`;

    renderSnapshot(knownArrayBytes, totalSourceLines);
    renderFindings();
    renderMemorySignals();
  }

  function renderSnapshot(knownArrayBytes, totalSourceLines) {
    const root = $('#snapshotContent');
    root.replaceChildren();
    const stats = document.createElement('div');
    stats.className = 'snapshot-stat-list';
    const rows = [
      ['Source lines', totalSourceLines.toLocaleString()],
      ['Potential findings', findings.length.toString()],
      ['Matched array storage', formatBytes(knownArrayBytes)],
      ['Array declarations', arrayObservations.length.toString()],
      ['Unresolved array sizes', arrayObservations.filter(item => !Number.isFinite(item.bytes)).length.toString()],
      ['Measured speedup', 'Not measured']
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div'); row.className = 'snapshot-stat';
      const left = document.createElement('span'); left.textContent = label;
      const right = document.createElement('strong'); right.textContent = value;
      row.append(left, right); stats.append(row);
    });
    const callout = document.createElement('div'); callout.className = 'snapshot-callout';
    const title = document.createElement('strong'); title.textContent = findings.length ? `${findings.length} thing${findings.length === 1 ? '' : 's'} worth investigating` : 'No matching heuristics found';
    const text = document.createElement('p'); text.textContent = findings.length ? 'Review each suggestion before changing firmware. A source pattern is a lead, not proof of a bottleneck.' : 'That does not prove the code is fully optimized. This first version only recognizes a limited set of patterns.';
    callout.append(title, text); root.append(stats, callout);
  }

  function renderFindings() {
    const root = $('#findingsList');
    root.replaceChildren();
    const filtered = findings.filter(item => activeFilter === 'all' || item.category === activeFilter);
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = findings.length ? 'findings-empty-filter' : 'findings-placeholder';
      if (findings.length) empty.textContent = 'No findings in this filter. Try “All findings”.';
      else {
        const symbol = document.createElement('span'); symbol.className = 'placeholder-symbol'; symbol.textContent = '⌁';
        const copy = document.createElement('div');
        const strong = document.createElement('strong'); strong.textContent = 'Your optimization queue is empty';
        const para = document.createElement('p'); para.textContent = 'Analyze the project to find potential improvements.';
        copy.append(strong, para); empty.append(symbol, copy);
      }
      root.append(empty); return;
    }
    filtered.forEach(item => {
      const card = document.createElement('article'); card.className = 'finding-card';
      const icon = document.createElement('div'); icon.className = `finding-icon ${item.category}`; icon.textContent = item.category === 'memory' ? '▦' : item.category === 'correctness' ? '!' : '↗';
      const main = document.createElement('div'); main.className = 'finding-main';
      const meta = document.createElement('div'); meta.className = 'finding-meta';
      const severity = document.createElement('span'); severity.className = `severity ${item.severity}`; severity.textContent = item.severity.toUpperCase();
      const category = document.createElement('span'); category.className = 'category-pill'; category.textContent = item.category.toUpperCase();
      meta.append(severity, category);
      const title = document.createElement('h3'); title.textContent = item.title;
      const detail = document.createElement('p'); detail.textContent = item.detail;
      const rec = document.createElement('div'); rec.className = 'finding-recommendation';
      const label = document.createElement('strong'); label.textContent = 'Investigate: ';
      rec.append(label, document.createTextNode(item.recommendation));
      main.append(meta, title, detail, rec);
      const line = document.createElement('div'); line.className = 'finding-line'; line.textContent = `${item.file}:${item.line}`;
      card.append(icon, main, line); root.append(card);
    });
  }

  function renderMemorySignals() {
    const root = $('#memorySignals'); root.replaceChildren();
    const memoryFindings = findings.filter(item => item.category === 'memory');
    const signals = [];
    const knownBytes = arrayObservations.reduce((sum, item) => sum + (item.includedInTotal && Number.isFinite(item.bytes) ? item.bytes : 0), 0);
    const knownCount = arrayObservations.filter(item => item.includedInTotal && Number.isFinite(item.bytes)).length;
    const unknownCount = arrayObservations.filter(item => !Number.isFinite(item.bytes)).length;
    if (arrayObservations.length) signals.push({
      icon: '▦', kind: 'memory',
      title: arrayObservations.length + ' array declaration' + (arrayObservations.length === 1 ? '' : 's') + ' inventoried',
      text: formatBytes(knownBytes) + ' combined size estimate for ' + knownCount + ' sized declaration' + (knownCount === 1 ? '' : 's') + '; ' + unknownCount + ' size' + (unknownCount === 1 ? '' : 's') + ' unresolved. This is not a total-RAM measurement.'
    });
    if (memoryFindings.length) memoryFindings.forEach(item => signals.push({ icon: '!', kind: 'memory', title: item.title, text: item.file + ':' + item.line + ' — ' + item.detail }));
    if (!signals.length) signals.push({ icon: 'i', kind: '', title: 'No recognized memory-risk pattern', text: 'This limited scan cannot measure heap, task stack, or total firmware RAM usage.' });
    signals.slice(0, 8).forEach(signal => {
      const row = document.createElement('div'); row.className = 'signal-row';
      const icon = document.createElement('span'); icon.className = 'signal-icon ' + signal.kind; icon.textContent = signal.icon;
      const copy = document.createElement('div'); copy.className = 'signal-copy';
      const title = document.createElement('strong'); title.textContent = signal.title;
      const detail = document.createElement('span'); detail.textContent = signal.text;
      copy.append(title, detail); row.append(icon, copy); root.append(row);
    });

    const divider = document.createElement('div'); divider.className = 'snapshot-divider'; root.append(divider);
    const heading = document.createElement('div'); heading.className = 'panel-eyebrow'; heading.textContent = 'ARRAY INVENTORY'; root.append(heading);
    const note = document.createElement('p');
    note.className = 'signal-empty';
    note.textContent = 'Estimated byte sizes use common ESP32-S3 type sizes. Scope and section labels are clues only; inspect the linker map to confirm placement.';
    root.append(note);

    if (!arrayObservations.length) {
      const empty = document.createElement('div'); empty.className = 'signal-empty';
      empty.textContent = 'No supported built-in-type array declarations found. Heap allocations, structs, STL containers, and compiler-added data are not included in this inventory.';
      root.append(empty);
      return;
    }
    const orderedArrays = [...arrayObservations].sort((a, b) => {
      const aSize = Number.isFinite(a.bytes) ? a.bytes : -1;
      const bSize = Number.isFinite(b.bytes) ? b.bytes : -1;
      return bSize - aSize;
    });
    orderedArrays.slice(0, 24).forEach(array => {
      const row = document.createElement('div'); row.className = 'signal-row';
      const icon = document.createElement('span'); icon.className = 'signal-icon memory'; icon.textContent = Number.isFinite(array.bytes) ? '▦' : '?';
      const copy = document.createElement('div'); copy.className = 'signal-copy';
      const dimensions = array.dimensionExpressions && array.dimensionExpressions.length ? array.dimensionExpressions.join(' × ') : '?';
      const title = document.createElement('strong');
      title.textContent = array.name + ' — ' + (Number.isFinite(array.bytes) ? formatBytes(array.bytes) : 'size unknown');
      const detail = document.createElement('span');
      detail.textContent = array.file + ':' + array.line + ' · ' + array.type + '[' + dimensions + '] · ' + array.storageClass;
      copy.append(title, detail); row.append(icon, copy); root.append(row);
    });
    if (orderedArrays.length > 24) {
      const more = document.createElement('div'); more.className = 'signal-empty';
      more.textContent = (orderedArrays.length - 24) + ' more declarations are included in the exported report.';
      root.append(more);
    }
  }
  async function importFiles(fileList) {
    const incoming = [...fileList];
    if (!incoming.length) return;
    let parsed = [];
    for (const file of incoming) {
      if (!file.name.toLowerCase().endsWith('.zip') && file.size > MAX_SOURCE_FILE_BYTES) {
        toast(`Skipped ${file.name}: files must be 2 MiB or smaller in this prototype.`);
        continue;
      }
      if (file.name.toLowerCase().endsWith('.zip')) {
        if (!window.JSZip) {
          toast('ZIP reader did not load. Try individual source files or reload and try again.');
          continue;
        }
        try {
          const zip = await window.JSZip.loadAsync(file);
          const zipEntries = Object.values(zip.files).filter(entry => !entry.dir && !/(^|\/)(\.git|build|node_modules|managed_components)(\/|$)/i.test(entry.name) && SOURCE_EXTENSIONS.has(fileExtension(entry.name).toLowerCase()));
          if (zipEntries.length > 80) toast('Large archive: importing the first 80 supported source/build files.');
          let archiveChars = 0;
          for (const entry of zipEntries.slice(0, 80)) {
            const uncompressedSize = entry._data && Number.isFinite(entry._data.uncompressedSize) ? entry._data.uncompressedSize : 0;
            if (uncompressedSize > MAX_SOURCE_FILE_BYTES) continue;
            const content = await entry.async('string');
            archiveChars += content.length;
            if (archiveChars > MAX_PROJECT_CHARS) { toast('Archive exceeds the 10 MB source limit; remaining files were skipped.'); break; }
            parsed.push({ name: entry.name, content });
          }
        } catch (error) {
          console.error(error);
          toast(`Could not read ${file.name} as a ZIP archive.`);
        }
      } else if (SOURCE_EXTENSIONS.has(fileExtension(file.name).toLowerCase())) {
        try {
          const content = await file.text();
          if (content.length > MAX_SOURCE_FILE_BYTES) { toast(`Skipped ${file.name}: files must be 2 MiB or smaller in this prototype.`); continue; }
          parsed.push({ name: file.webkitRelativePath || file.name, content });
        }
        catch { toast(`Could not read ${file.name}.`); }
      } else {
        toast(`Skipped unsupported file: ${file.name}`);
      }
    }
    if (!parsed.length) return;
    syncActiveContent();
    const next = new Map(projectFiles.map(file => [file.name, file]));
    parsed.forEach(file => next.set(file.name, file));
    projectFiles = [...next.values()];
    activeFileName = parsed[0].name;
    const active = getActiveFile();
    codeInput.value = active ? active.content : '';
    $('#breadcrumbProject').textContent = parsed.length === 1 ? parsed[0].name.split('/').pop() : `${parsed.length} imported files`;
    renderFileTabs(); updateEditorMeta();
    toast(`Loaded ${parsed.length} source file${parsed.length === 1 ? '' : 's'}. Run analysis to refresh findings.`);
  }

  function resetDemo() {
    projectFiles = [{ name: DEMO_NAME, content: DEMO_CODE }];
    activeFileName = DEMO_NAME;
    findings = [];
    lastReport = null;
    activeFilter = 'all';
    $$('.filter-button').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
    codeInput.value = DEMO_CODE;
    $('#breadcrumbProject').textContent = 'Demo project';
    renderFileTabs(); updateEditorMeta();
    $('#findingMetric').textContent = '—'; $('#ramMetric').textContent = '—'; $('#navFindingCount').textContent = '—'; $('#findingsHeadingCount').textContent = '0'; $('#knownArrayTotal').textContent = '—'; $('#arrayCountLabel').textContent = '0 detected'; $('#arrayBar').style.width = '0%';
    $('#snapshotContent').innerHTML = '<div class="empty-snapshot"><div class="empty-orbit">✳</div><strong>Ready when you are</strong><p>Run an analysis to surface potential performance and memory issues in your code.</p><button class="small-primary" id="snapshotAnalyzeButton" type="button">Analyze code →</button></div>';
    $('#findingsList').innerHTML = '<div class="findings-placeholder"><span class="placeholder-symbol">⌁</span><div><strong>Your optimization queue is empty</strong><p>Analyze the project to find potential improvements.</p></div></div>';
    $('#memorySignals').innerHTML = '<div class="signal-empty">Run analysis to inspect memory-related patterns.</div>';
    $('#snapshotAnalyzeButton').addEventListener('click', buildAnalysis);
    toast('Demo project loaded. Analyze it to see how MIRAGE works.');
  }

  function downloadBlob(filename, content, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getBenchmarkRecords() {
    try {
      const records = JSON.parse(localStorage.getItem('mirage-benchmark-history-v1') || '[]');
      return Array.isArray(records) ? records.filter(record => record && record.parsed && record.id) : [];
    } catch (_) { return []; }
  }

  function saveBenchmarkRecords(records) {
    try { localStorage.setItem('mirage-benchmark-history-v1', JSON.stringify(records.slice(0, 30))); return true; }
    catch (_) { return false; }
  }

  function setBenchmarkStatus(message, kind = '') {
    const status = $('#benchmarkImportStatus');
    status.textContent = message;
    status.className = `benchmark-import-status${kind ? ` ${kind}` : ''}`;
  }

  function appendBenchmarkMetric(root, label, value) {
    const metric = document.createElement('div'); metric.className = 'benchmark-metric';
    const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = value;
    metric.append(name, result); root.append(metric);
  }

  function renderBenchmarkHistory() {
    const root = $('#benchmarkResultsList');
    if (!root || !window.MirageBenchmarkResults) return;
    const api = window.MirageBenchmarkResults;
    const records = getBenchmarkRecords();
    $('#benchmarkCount').textContent = String(records.length);
    root.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div'); empty.className = 'benchmark-empty';
      empty.textContent = 'No benchmark runs recorded yet. Import the complete Serial Monitor output above; MIRAGE will preserve the raw log with its parsed metrics.';
      root.append(empty); return;
    }
    records.forEach(record => {
      const assessment = api.assess(record, records);
      const card = document.createElement('article'); card.className = 'benchmark-record';
      const top = document.createElement('div'); top.className = 'benchmark-record-top';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h4'); title.className = 'benchmark-record-title'; title.textContent = 'powf(x, 2.0f) vs x * x';
      const date = document.createElement('div'); date.className = 'benchmark-record-meta';
      const when = record.capturedAt ? new Date(record.capturedAt) : null;
      date.textContent = `${record.target || 'ESP32-S3'} · ${when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : 'Date not recorded'} · ${record.parsed.trialCount || 0} trial rows`;
      const config = document.createElement('div'); config.className = 'benchmark-record-meta'; config.textContent = `Build: ${record.buildSettings && record.buildSettings.trim() ? record.buildSettings : 'Not recorded'}`;
      titleWrap.append(title, date, config);
      const badge = document.createElement('span'); badge.className = `benchmark-status ${assessment.code}`; badge.textContent = assessment.label;
      top.append(titleWrap, badge);
      const metrics = document.createElement('div'); metrics.className = 'benchmark-metrics';
      appendBenchmarkMetric(metrics, 'Median powf', Number.isFinite(record.parsed.powfMedianUs) ? `${record.parsed.powfMedianUs} µs` : '—');
      appendBenchmarkMetric(metrics, 'Median multiply', Number.isFinite(record.parsed.multiplyMedianUs) ? `${record.parsed.multiplyMedianUs} µs` : '—');
      appendBenchmarkMetric(metrics, 'Median ratio', Number.isFinite(record.parsed.ratio) ? `${record.parsed.ratio.toFixed(3)}×` : '—');
      appendBenchmarkMetric(metrics, 'Checksum', record.parsed.checksumPass === true ? 'PASS' : record.parsed.checksumPass === false ? 'FAIL' : 'Unknown');
      const explanation = document.createElement('p'); explanation.className = 'benchmark-assessment'; explanation.textContent = assessment.explanation;
      const heap = document.createElement('p'); heap.className = 'benchmark-record-meta';
      heap.textContent = `Free heap: ${Number.isFinite(record.parsed.freeHeapBefore) ? record.parsed.freeHeapBefore.toLocaleString() : '—'} → ${Number.isFinite(record.parsed.freeHeapAfter) ? record.parsed.freeHeapAfter.toLocaleString() : '—'} bytes. Heap readings are context, not total RAM or proof of a memory optimization.`;
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'View original serial log';
      const raw = document.createElement('pre'); raw.textContent = record.parsed.rawLog || '';
      details.append(summary, raw);
      card.append(top, metrics, explanation, heap, details); root.append(card);
    });
  }

  function exportBenchmarkHistory() {
    const records = getBenchmarkRecords();
    if (!records.length) { setBenchmarkStatus('There are no saved runs to export yet.', 'error'); return; }
    const exported = records.map(record => ({ ...record, assessment: window.MirageBenchmarkResults.assess(record, records) }));
    downloadBlob('mirage-benchmark-history.json', JSON.stringify({ tool: 'MIRAGE Studio', schemaVersion: 1, exportedAt: new Date().toISOString(), records: exported }, null, 2), 'application/json;charset=utf-8');
    setBenchmarkStatus(`Exported ${records.length} benchmark run${records.length === 1 ? '' : 's'} as JSON.`, 'success');
  }

  function importBenchmarkLog() {
    const rawLog = $('#benchmarkLog').value.trim();
    const parsed = window.MirageBenchmarkResults.parseSerialLog(rawLog);
    if (!parsed.valid) { setBenchmarkStatus(parsed.errors.join(' '), 'error'); return; }
    const records = getBenchmarkRecords();
    const target = $('#benchmarkTarget').value.trim() || 'ESP32-S3';
    const buildSettings = $('#benchmarkSettings').value.trim();
    records.unshift({ id: `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, capturedAt: new Date().toISOString(), target, buildSettings, parsed });
    if (!saveBenchmarkRecords(records)) { setBenchmarkStatus('The log parsed, but this browser could not save local history. Check browser storage settings and export/record the output manually.', 'error'); return; }
    renderBenchmarkHistory();
    const assessment = window.MirageBenchmarkResults.assess(records[0], records);
    setBenchmarkStatus(`Recorded ${parsed.trialCount} trial rows. Result: ${assessment.label}.`, 'success');
    toast('Benchmark result recorded locally.');
  }

  function clearBenchmarkHistory() {
    if (!getBenchmarkRecords().length) { setBenchmarkStatus('Benchmark history is already empty.'); return; }
    if (!window.confirm('Clear all MIRAGE benchmark runs saved in this browser? Export the history first if you want a backup.')) return;
    try { localStorage.removeItem('mirage-benchmark-history-v1'); renderBenchmarkHistory(); setBenchmarkStatus('Local benchmark history cleared. Exported JSON files are not affected.', 'success'); }
    catch (_) { setBenchmarkStatus('This browser would not allow local history to be cleared.', 'error'); }
  }

  function exportReport() {
    if (!lastReport) { toast('Run an analysis before exporting a report.'); return; }
    const benchmarks = getBenchmarkRecords();
    lastReport.benchmarkEvidence = benchmarks.map(record => ({ ...record, assessment: window.MirageBenchmarkResults.assess(record, benchmarks) }));
    downloadBlob('mirage-analysis-report.json', JSON.stringify(lastReport, null, 2), 'application/json;charset=utf-8');
    toast('Analysis report exported with benchmark evidence.');
  }

  // Editor events.
  codeInput.addEventListener('input', () => { syncActiveContent(); updateEditorMeta(); });
  // Transformation preview UI is created in JS to keep the analyzer usable as a static site.
  const transformPanel = document.createElement('section');
  transformPanel.id = 'transformPanel';
  transformPanel.hidden = true;
  transformPanel.style.cssText = 'margin-top:14px;padding:16px;border:1px solid #39304f;border-radius:9px;background:#111521;color:#edf1fb';
  transformPanel.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><div style="font:9px monospace;letter-spacing:1px;color:#a995ff">TRANSFORMATION PREVIEW</div><h3 style="margin:8px 0;font-size:14px">Candidate code rewrites</h3><p id="transformSummary" style="margin:0;color:#9ba8bd;font-size:11px;line-height:1.7"></p></div>
      <div style="display:flex;gap:8px"><button type="button" id="applyTransformButton" class="primary-button">Apply changes</button><button type="button" id="cancelTransformButton" class="secondary-button">Cancel</button></div>
    </div>
    <pre id="transformDiff" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;background:#090d15;border:1px solid #252f41;border-radius:6px;padding:12px;font:10px/1.7 monospace;color:#cbd6e8;margin:13px 0 0"></pre>
    <p style="font-size:9px;line-height:1.7;color:#c6ae7c;margin:10px 0 0">Experimental: replacing pow(x, 2) with x*x can change floating-point edge-case behavior and may not be faster if the compiler already optimizes it. Review, compile, and benchmark before using in firmware.</p>`;
  const sourcePanel = $('.source-panel');
  if (sourcePanel) sourcePanel.append(transformPanel);
  const transformButton = document.createElement('button');
  transformButton.type = 'button'; transformButton.className = 'ghost-button'; transformButton.textContent = '⚡ Preview rewrites';
  transformButton.style.marginTop = '10px';
  transformButton.id = 'previewTransformButton';
  const editorFooter = $('.source-panel .editor-footer');
  if (editorFooter) editorFooter.insertAdjacentElement('afterend', transformButton);
  let pendingTransformation = null;
  transformButton.addEventListener('click', () => {
    syncActiveContent();
    const file = getActiveFile();
    if (!file) return;
    const result = suggestTransformations(file.content);
    pendingTransformation = result.changes.length ? { fileName: file.name, before: file.content, after: result.source, changes: result.changes } : null;
    transformPanel.hidden = false;
    if (!pendingTransformation) {
      $('#transformSummary').textContent = 'No supported safe-pattern candidates found in this file. Currently this preview handles pow/powf with a literal exponent of 2 only.';
      $('#transformDiff').textContent = 'No changes proposed.';
      $('#applyTransformButton').disabled = true;
    } else {
      $('#transformSummary').textContent = `${result.changes.length} candidate rewrite${result.changes.length === 1 ? '' : 's'} in ${file.name}. Preview the exact replacements below.`;
      $('#transformDiff').textContent = result.changes.map((change, index) => `${index + 1}. Line ${result.source.slice(0, change.offset).split('\n').length}\n- ${change.original}\n+ ${change.replacement}`).join('\n\n');
      $('#applyTransformButton').disabled = false;
    }
    transformPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#applyTransformButton').addEventListener('click', () => {
    if (!pendingTransformation) return;
    const file = projectFiles.find(item => item.name === pendingTransformation.fileName);
    if (!file) return;
    file.content = pendingTransformation.after;
    if (file.name === activeFileName) codeInput.value = file.content;
    updateEditorMeta();
    pendingTransformation = null;
    transformPanel.hidden = true;
    buildAnalysis();
    toast('Candidate rewrite applied. Export and compile to verify it before using it.');
  });
  $('#cancelTransformButton').addEventListener('click', () => { pendingTransformation = null; transformPanel.hidden = true; });

  codeInput.addEventListener('scroll', () => { lineGutter.scrollTop = codeInput.scrollTop; });
  codeInput.addEventListener('keydown', event => {
    if (event.key === 'Tab') { event.preventDefault(); const start = codeInput.selectionStart; const end = codeInput.selectionEnd; codeInput.setRangeText('  ', start, end, 'end'); syncActiveContent(); updateEditorMeta(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); buildAnalysis(); }
  });

  $('#analyzeButton').addEventListener('click', buildAnalysis);
  $('#snapshotAnalyzeButton').addEventListener('click', buildAnalysis);
  $('#uploadButton').addEventListener('click', () => fileInput.click());
  $('#browseButton').addEventListener('click', () => fileInput.click());
  $('#addFileButton').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async event => { await importFiles(event.target.files); fileInput.value = ''; });
  $('#loadDemoButton').addEventListener('click', resetDemo);
  $('#downloadSourceButton').addEventListener('click', () => { syncActiveContent(); const file = getActiveFile(); if (file) downloadBlob(file.name.split('/').pop(), file.content); });
  $('#clearCodeButton').addEventListener('click', () => { codeInput.value = ''; syncActiveContent(); updateEditorMeta(); codeInput.focus(); });
  $('#docsButton').addEventListener('click', () => $('#howDialog').showModal());
  $$('.filter-button').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; $$('.filter-button').forEach(item => item.classList.toggle('active', item === button)); renderFindings(); }));

  // Drag and drop files, with an accessible keyboard path via Enter/Space.
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', async event => { const files = event.dataTransfer && event.dataTransfer.files; if (files && files.length) await importFiles(files); });
  dropZone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });

  // Update navigation highlight as sections enter view.
  const navLinks = $$('.nav-link');
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) navLinks.forEach(link => link.classList.toggle('active', link.dataset.nav === visible.target.id || (visible.target.id === 'overview' && link.dataset.nav === 'overview')));
  }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, .1, .25] }) : null;
  ['overview', 'source', 'findings', 'memory', 'benchmarks'].forEach(id => { const el = document.getElementById(id); if (observer && el) observer.observe(el); });

  // Ensure the reset-created snapshot button remains wired to the analyzer.
  $('#exportReportButton')?.addEventListener('click', exportReport);
  $('#importBenchmarkButton')?.addEventListener('click', importBenchmarkLog);
  $('#exportBenchmarksButton')?.addEventListener('click', exportBenchmarkHistory);
  $('#clearBenchmarksButton')?.addEventListener('click', clearBenchmarkHistory);
  renderBenchmarkHistory();

  // Initial demo is intentionally loaded so the first visit shows a useful working example.
  codeInput.value = DEMO_CODE;
  $('#breadcrumbProject').textContent = 'Demo project';
  renderFileTabs(); updateEditorMeta();
  // If no analysis has been run, metrics honestly remain unmeasured.
})();
