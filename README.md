# MIRAGE Studio

**An experimental browser-based optimization workbench for ESP32-S3 firmware.**

MIRAGE's long-term goal is to help developers find ways to make embedded applications faster and handle larger working sets with limited physical RAM. This repository is the first UI + static-analysis prototype, not yet an optimizing compiler.

## What works in the current prototype

- Paste and edit C/C++ source in the browser.
- Import supported source/build files individually or import a ZIP project archive.
- Switch between imported files and analyze the currently loaded project together.
- Run heuristic scans for selected patterns such as nested-loop candidates, `pow()` calls, serial logging, Arduino `String`, dynamic allocation, explicit waits, memory copies, and literal-sized arrays.
- Review potential findings categorized by speed or memory.
- Preview and explicitly apply a narrowly scoped `pow`/`powf`-to-multiplication rewrite for simple identifiers and simple array indexes.
- Run regression tests locally; GitHub Actions runs those tests before publishing the site.
- Export a JSON analysis report, or download the active source file.
- Import complete ESP32-S3 Serial Monitor logs into a local benchmark history, review conservative evidence labels, and export the history as JSON.
- Use the app as a static GitHub Pages site; no application backend is required for this prototype.

The project ZIP reader is loaded from jsDelivr (JSZip). Source code is read and analyzed in the browser; this app does not upload source code to a MIRAGE server.

## Benchmarking

The first ESP32-S3 benchmark fixture compares `powf(x, 2.0f)` with `x * x` on-device. See [benchmarks/README.md](benchmarks/README.md) for setup and reporting guidance. The Benchmark results panel parses full serial logs and saves them in browser-local storage; it does not upload source code or benchmark logs to a MIRAGE server.

This is a measured experiment, not a guaranteed optimization. Compiler settings can change the result, and the compiler may already optimize the original expression. The sketch's heap readings are not total RAM usage or static memory size.

## Important limitations

- This version does **not** compile firmware, execute user code, apply source optimizations, or benchmark an ESP32 from the website.
- Finding cards are heuristics, not proof of a bottleneck or an instruction to modify code blindly.
- The array estimate is partial. It counts selected literal-sized declarations that the scanner recognizes; it is not total RAM usage, total static memory, or a substitute for an ESP-IDF linker map and runtime measurements.
- The visual roadmap describes planned research and is not a claim that those capabilities have already been implemented.
- No speedup multiplier is predicted or promised.

## Run locally

Because this is a static site, you can open `index.html` directly for the main UI. To test ZIP import reliably and avoid browser-specific local-file behavior, serve the directory over HTTP, for example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

Run the analyzer smoke tests with Node.js:

```bash
node tests/analyzer-smoke-test.cjs
node tests/benchmark-results-test.cjs
```

## GitHub Pages

https://jordy392012.github.io/Mirage/

## Roadmap

1. Improve static analysis and add test fixtures.
2. Add carefully scoped, reviewable transformations with correctness/regression tests.
3. Integrate a real ESP-IDF build runner and collect build/linker-map metrics.
4. Record reproducible on-device ESP32-S3 benchmark evidence and compare repeated runs.
5. Research automatic optimization search and a managed-memory runtime.

## Contributing

Please include a small source fixture or test case with analyzer changes, explain the code pattern being detected, and avoid describing a suggestion as a measured optimization unless there is a reproducible benchmark.

## License

MIT. See [`LICENSE`](LICENSE).


## Compiler-backed checks (experimental)

MIRAGE can run a real Clang 22 compile/link check in a WebAssembly worker for the currently selected C/C++ file. The compiler assets are downloaded on demand from the deployed site's clang/ path; GitHub Actions fetches them and verifies six pinned SHA-256 digests during deployment. Source text is passed to the local browser worker and is not uploaded to a compiler service. The worker deliberately compiles but does not execute the generated program.

**Important:** this bundled Clang toolchain targets wasm32-wasi, not ESP32-S3 Xtensa. It is useful for portable C/C++ syntax, type, warning, and limited AST-backed loop-pattern checks, but it is not a firmware build. Arduino/ESP-IDF headers, board-specific libraries, target ABI, Xtensa code generation, flash/RAM maps, and actual hardware performance are not represented. A failure caused by a missing board header is not necessarily a bug in the source; a passing check does not prove that the ESP32 firmware will build.


Third-party compiler runtime provenance and licensing notes: see [CLANG_WASM_NOTICES.md](CLANG_WASM_NOTICES.md).

The optional AST pass looks for repeated arithmetic expressions, function calls, and array accesses inside braced loops in include-free source files up to 100 KB. These are review hints only; calls and array reads are never auto-cached, and the pass does not prove loop invariance or performance gains.
