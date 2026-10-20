import { createToolchain } from 'https://esm.sh/@live-codes/clang-wasm@0.3.0/toolchain?bundle';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = value => String(value || '').replace(ANSI, '');
const WASM_TARGET_NOTE = 'Compiler target: wasm32-wasi (not ESP32-S3 Xtensa). This check does not prove ESP32 toolchain compatibility.';

let toolchainPromise;
async function getToolchain() {
  if (!toolchainPromise) {
    globalThis.SharedArrayBuffer ??= class SharedArrayBuffer {};
    const baseUrl = new URL('./clang/', self.location.href).href;
    toolchainPromise = createToolchain({ baseUrl });
  }
  return toolchainPromise;
}


function findJsonDocument(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function astLoopFindings(ast, source) {
  const findings = [];
  const lineAtOffset = offset => source.slice(0, Math.max(0, offset)).split('\n').length;
  const spanOf = node => {
    const range = node && node.range;
    const begin = range && range.begin && range.begin.offset;
    const end = range && range.end && range.end.offset;
    if (!Number.isInteger(begin) || !Number.isInteger(end) || end < begin || end >= source.length) return null;
    return { begin, end: end + (range.end.tokLen || 1) };
  };
  const walk = (node, callback) => {
    if (!node || typeof node !== 'object') return;
    callback(node);
    if (Array.isArray(node.inner)) for (const child of node.inner) walk(child, callback);
  };
  walk(ast, node => {
    if (!['ForStmt', 'WhileStmt', 'DoStmt'].includes(node.kind)) return;
    const children = Array.isArray(node.inner) ? node.inner : [];
    let body = null;
    for (const child of children) if (child.kind === 'CompoundStmt') body = child;
    if (!body) return;
    const groups = { call: new Map(), array: new Map(), arithmetic: new Map() };
    walk(body, item => {
      let category = null;
      if (['CallExpr', 'CXXMemberCallExpr', 'CXXOperatorCallExpr'].includes(item.kind)) category = 'call';
      else if (item.kind === 'ArraySubscriptExpr') category = 'array';
      else if (item.kind === 'BinaryOperator' && ['+', '-', '*'].includes(item.opcode)) category = 'arithmetic';
      if (!category) return;
      const span = spanOf(item);
      if (!span) return;
      const expression = source.slice(span.begin, span.end).replace(/\s+/g, ' ').trim();
      if (!expression || expression.length > 180) return;
      const groupKey = category === 'arithmetic'
        ? String(item.opcode) + ':' + expression
        : expression;
      const map = groups[category];
      if (!map.has(groupKey)) map.set(groupKey, { count: 0, expression, offset: span.begin, type: item.type && item.type.qualType });
      map.get(groupKey).count++;
    });
    for (const [category, title, detail] of [
      ['arithmetic', 'Repeated arithmetic in loop (Clang AST)', 'Clang parsed the same arithmetic expression multiple times inside this loop. Inspect operand stability and check generated assembly before caching it.'],
      ['call', 'Repeated function call in loop (Clang AST)', 'Clang parsed the same function call multiple times inside this loop. Calls can have side effects or read changing state, so MIRAGE does not cache them automatically.'],
      ['array', 'Repeated array access in loop (Clang AST)', 'Clang parsed the same array access multiple times inside this loop. Aliasing, writes, volatile storage, and compiler optimization still need review.']
    ]) {
      const repeated = [...groups[category].values()]
        .filter(item => item.count >= 2)
        .sort((a, b) => a.expression.length - b.expression.length)[0];
      if (!repeated) continue;
      findings.push({
        category,
        title,
        line: lineAtOffset(repeated.offset),
        expression: repeated.expression,
        type: repeated.type || 'unknown',
        detail
      });
    }
  });
  return findings;
}

async function runAstPass(toolchain, source, isC) {
  // Keep the AST output bounded and avoid pretending board/header declarations are available.
  if (source.length > 100000 || /^\s*#\s*include\b/m.test(source)) {
    return { findings: [], note: 'AST loop findings skipped: this pass is limited to source files up to 100 KB with no #include directives. The compiler check above still applies to the selected file.' };
  }
  const fileName = isC ? 'ast/main.c' : 'ast/main.cpp';
  toolchain.addFile(fileName, source);
  const clang = await toolchain.runtime.getModule(toolchain.runtime.assetUrls.clang);
  const captured = await toolchain.captureCompilerOutput(() =>
    toolchain.runtime.run(
      clang, true, 'clang', '-cc1', '-triple', 'wasm32-wasi',
      '-fsyntax-only', '-ast-dump=json', '-ferror-limit', '20',
      '-resource-dir', toolchain.runtime.compilerConfig?.resourceDir || '/lib/clang/22',
      ...(isC ? ['-std=gnu17', '-x', 'c'] : ['-std=gnu++17', '-x', 'c++']),
      fileName
    )
  );
  if (captured.error) {
    return { findings: [], note: 'Clang compile/link passed, but the optional AST pass was unavailable: ' + String(captured.error.message || captured.error) };
  }
  const cleaned = stripAnsi(captured.raw || '');
  const jsonText = findJsonDocument(cleaned);
  if (!jsonText) return { findings: [], note: 'Clang compile/link passed; the AST output could not be parsed, so no AST loop findings were added.' };
  try {
    return { findings: astLoopFindings(JSON.parse(jsonText), source), note: 'AST pass used Clang-parsed loops and expression types; these findings are still optimization candidates, not measured speedups.' };
  } catch (error) {
    return { findings: [], note: 'Clang compile/link passed; AST parsing was skipped because the compiler output was not valid JSON.' };
  }
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'compile') return;
  const source = String(message.source || '');
  const originalName = String(message.filename || 'main.cpp');
  const isC = /\.c$/i.test(originalName) && !/\.(?:cc|cpp|cxx|ino)$/i.test(originalName);
  const language = isC ? 'c' : 'c++';
  const fileName = isC ? 'main.c' : 'main.cpp';
  if (!source.trim()) {
    self.postMessage({ type: 'result', ok: false, diagnostics: 'The selected file is empty.' });
    return;
  }
  try {
    self.postMessage({ type: 'progress', message: 'Loading pinned Clang WebAssembly runtime…' });
    const toolchain = await getToolchain();
    self.postMessage({ type: 'progress', message: 'Compiling the selected source (the generated program will not be executed)…' });
    const hasMain = /\bmain\s*\(/.test(source);
    const compileSource = hasMain ? source : source + '\n\nint main() { return 0; }\n';
    const started = performance.now();
    const captured = await toolchain.captureCompilerOutput(() =>
      toolchain.runtime.compileArtifact(compileSource, {
        language,
        fileName,
        compileArgs: isC
          ? ['-std=gnu17', '-Wall', '-Wextra', '-Wconversion']
          : ['-std=gnu++17', '-Wall', '-Wextra', '-Wconversion', '-Wshadow']
      })
    );
    const compileMs = ((performance.now() - started) / 1000).toFixed(2) + ' s';
    const diagnostics = stripAnsi(captured.raw || '').trim();
    if (captured.error) {
      toolchain.dispose();
      self.postMessage({
        type: 'result', ok: false, compileMs,
        diagnostics: (diagnostics || String(captured.error.message || captured.error)) + '\n\n' + WASM_TARGET_NOTE
      });
      return;
    }
    const astResult = await runAstPass(toolchain, source, isC);
    const astText = astResult.findings.length
      ? '\n\nClang AST loop findings:\n' + astResult.findings.map(item =>
          '- Line ' + item.line + ': ' + item.title + '\n  Expression: ' + item.expression +
          '\n  Clang type: ' + item.type + '\n  ' + item.detail
        ).join('\n')
      : '\n\nClang AST loop findings: none detected.';
    self.postMessage({
      type: 'result', ok: true, compileMs,
      diagnostics: (diagnostics || 'No compiler warnings or errors.') + astText + '\n' + astResult.note + '\n\n' + WASM_TARGET_NOTE
    });
    toolchain.dispose();
  } catch (error) {
    self.postMessage({
      type: 'result', ok: false,
      diagnostics: stripAnsi(error && (error.stack || error.message) || String(error)) + '\n\n' + WASM_TARGET_NOTE,
      error: String(error && error.message || error)
    });
  }
};
