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
    self.postMessage({
      type: 'result', ok: true, compileMs,
      diagnostics: (diagnostics || 'No compiler warnings or errors.') + '\n\n' + WASM_TARGET_NOTE
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
