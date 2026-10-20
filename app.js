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

    // Resolve simple integer constants so declarations such as float buffer[N] are counted.
    // This is deliberately a small source heuristic, not a full C++ preprocessor/parser.
    const integerConstants = new Map();
    const constantRegex = /\b(?:(?:static|inline)\s+)*(?:constexpr|const)\s+(?:(?:unsigned|signed)\s+)?(?:char|short(?:\s+int)?|int|long(?:\s+int)?|size_t|u?int(?:8|16|32|64)_t)\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*;/g;
    let constantMatch;
    while ((constantMatch = constantRegex.exec(source)) !== null) {
      const value = Number(constantMatch[2]);
      if (Number.isSafeInteger(value) && value > 0) integerConstants.set(constantMatch[1], value);
    }

    const allocationArrayRegex = /(?:^|[;{}\n])\s*(?:(?:static|constexpr|const|volatile|PROGMEM|extern|inline)\s+)*(unsigned\s+)?(char|short(?:\s+int)?|int|long(?:\s+int)?|float|double|bool|byte|size_t|u?int(?:8|16|32|64)_t)\s+([A-Za-z_]\w*)\s*((?:\s*\[\s*(?:\d+|[A-Za-z_]\w*)\s*\])+)(?:\s*=\s*[^;]*)?\s*;/g;
    const seen = new Set();
    let match;
    while ((match = allocationArrayRegex.exec(source)) !== null) {
      const type = `${match[1] ? 'unsigned ' : ''}${match[2]}`.replace(/\s+/g, ' ').trim();
      const dimTokens = [...match[4].matchAll(/\[\s*(\d+|[A-Za-z_]\w*)\s*\]/g)].map(part => part[1]);
      const dims = dimTokens.map(token => /^\d+$/.test(token) ? Number(token) : integerConstants.get(token));
      if (dims.some(value => value === undefined)) continue;
      if (!dims.length || dims.some(n => !Number.isSafeInteger(n) || n < 1)) continue;
      const byteType = TYPE_BYTES[type] ?? TYPE_BYTES[match[2]];
      if (!byteType) continue;
      const count = dims.reduce((product, value) => product * value, 1);
      const bytes = count * byteType;
      if (!Number.isSafeInteger(bytes) || seen.has(match[3])) continue;
      seen.add(match[3]);
      // Store array matches as structured observations; a large one also becomes a finding.
      arrayObservations.push({ file: file.name, name: match[3], type, dimensions: dims, bytes, line: lineOf(match.index + match[0].indexOf(match[2])) });
      if (bytes >= 8192) {
        add(`large-array-${match[3]}`, 'memory', 'medium', `Large array: ${match[3]}`, `${match[3]} is declared as ${type} with ${dims.join(' × ')} element${count === 1 ? '' : 's'} (about ${formatBytes(bytes)} of storage at this type size).`, 'Check whether the whole array must be resident at once. Depending on access patterns, chunking, smaller element types, flash-backed constants, or external PSRAM may help.', match.index);
      }
    }

    // Very long literal arrays often dominate static storage; the parsed array inventory is shown separately.
    const suspiciousStack = /\b(?:char|short|int|long|float|double|uint\d+_t|int\d+_t)\s+[A-Za-z_]\w*\s*\[\s*(\d{4,})\s*\]/.exec(source);
    if (suspiciousStack && !list.some(item => item.id.startsWith('large-array-'))) {
      add('large-array-scope', 'memory', 'low', 'Large array declaration detected', 'A large fixed-size array appears in the source. If it is a local variable, it may use task stack space; if global, it contributes to static memory.', 'Confirm the array scope and measured placement in the linker map. Consider streaming or reusing storage if the full array is not needed simultaneously.', suspiciousStack.index);
    }

    return list;
  }

  // Conservative first transformation: only a single identifier/array-element base
  // and a literal exponent of exactly 2.0. It is a candidate rewrite, not a guarantee
  // of identical floating-point edge-case behavior or a measured speedup.
  function suggestTransformations(source) {
    const changes = [];
    const pattern = /\b(powf?)\s*\(\s*([A-Za-z_]\w*(?:\s*\[[^\]\n]+\])?)\s*,\s*2(?:\.0f?|f)?\s*\)/g;
    const optimized = source.replace(pattern, (whole, fn, operand, offset) => {
      const replacement = `(${operand.trim()} * ${operand.trim()})`;
      changes.push({ original: whole, replacement, offset });
      return replacement;
    });
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
    const knownArrayBytes = arrayObservations.reduce((sum, item) => sum + item.bytes, 0);
    lastReport = {
      tool: 'MIRAGE Studio', version: '0.1.0', target: 'ESP32-S3', analysisType: 'static heuristic scan', generatedAt: new Date().toISOString(),
      limitations: ['This report is not a compiler output or hardware benchmark.', 'Array storage is a partial estimate based on matched literal-sized declarations; it is not total RAM usage.', 'Findings are heuristics and must be reviewed by a developer.'],
      summary: { files: projectFiles.length, sourceLines: totalSourceLines, findings: findings.length, matchedArrayCount: arrayObservations.length, matchedArrayBytes: knownArrayBytes },
      files: projectFiles.map(file => ({ name: file.name, lines: file.content ? file.content.split('\n').length : 0, characters: file.content.length })),
      arrays: arrayObservations.map(({ file, name, type, dimensions, bytes, line }) => ({ file, name, type, dimensions, bytes, line })),
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
    if (arrayObservations.length) signals.push({ icon: '▦', kind: 'memory', title: `${arrayObservations.length} known-size array${arrayObservations.length === 1 ? '' : 's'} matched`, text: `${formatBytes(arrayObservations.reduce((sum, array) => sum + array.bytes, 0))} combined estimated storage; verify the map file and placement.` });
    if (memoryFindings.length) memoryFindings.forEach(item => signals.push({ icon: '!', kind: 'memory', title: item.title, text: `${item.file}:${item.line} — ${item.detail}` }));
    if (!signals.length) signals.push({ icon: 'i', kind: '', title: 'No recognized memory-risk pattern', text: 'This limited scan did not find supported memory patterns. It cannot measure heap, task stack, or total firmware RAM use.' });
    signals.slice(0, 8).forEach(signal => {
      const row = document.createElement('div'); row.className = 'signal-row';
      const icon = document.createElement('span'); icon.className = `signal-icon ${signal.kind}`; icon.textContent = signal.icon;
      const copy = document.createElement('div'); copy.className = 'signal-copy';
      const title = document.createElement('strong'); title.textContent = signal.title;
      const detail = document.createElement('span'); detail.textContent = signal.text;
      copy.append(title, detail); row.append(icon, copy); root.append(row);
    });
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

  function exportReport() {
    if (!lastReport) { toast('Run an analysis before exporting a report.'); return; }
    downloadBlob('mirage-analysis-report.json', JSON.stringify(lastReport, null, 2), 'application/json;charset=utf-8');
    toast('Analysis report exported.');
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
  ['overview', 'source', 'findings', 'memory'].forEach(id => { const el = document.getElementById(id); if (observer && el) observer.observe(el); });

  // Ensure the reset-created snapshot button remains wired to the analyzer.
  $('#exportReportButton')?.addEventListener('click', exportReport);

  // Initial demo is intentionally loaded so the first visit shows a useful working example.
  codeInput.value = DEMO_CODE;
  $('#breadcrumbProject').textContent = 'Demo project';
  renderFileTabs(); updateEditorMeta();
  // If no analysis has been run, metrics honestly remain unmeasured.
})();
