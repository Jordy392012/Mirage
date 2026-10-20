# MIRAGE Studio

**An experimental browser-based optimization workbench for ESP32-S3 firmware.**

MIRAGE's long-term goal is to help developers find ways to make embedded applications faster and handle larger working sets with limited physical RAM. This repository is the first UI + static-analysis prototype, not yet an optimizing compiler.

## What works in v0.3

- Paste and edit C/C++ source in the browser.
- Import supported source/build files individually or import a ZIP project archive.
- Switch between imported files and analyze the currently loaded project together.
- Run heuristic scans for selected patterns such as nested-loop candidates, `pow()` calls, serial logging, Arduino `String`, dynamic allocation, explicit waits, memory copies, and literal-sized arrays.
- Review potential findings categorized by speed or memory.
- Preview and explicitly apply a narrowly scoped `pow`/`powf`-to-multiplication rewrite for simple identifiers and simple array indexes.
- Run regression tests locally; GitHub Actions runs those tests before publishing the site.
- Export a JSON report, or download the active source file.
- Use the app as a static GitHub Pages site; no application backend is required for this prototype.

The project ZIP reader is loaded from jsDelivr (JSZip). Source code is read and analyzed in the browser; this app does not upload source code to a MIRAGE server.

The project ZIP reader is loaded from jsDelivr (JSZip). Source code is read and analyzed in the browser; this app does not upload source code to a MIRAGE server.

## Important limitations

- This version does **not** compile firmware, execute user code, apply source optimizations, or benchmark an ESP32.
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
```

## GitHub Pages

https://jordy392012.github.io/Mirage/

## Roadmap

1. Improve static analysis and add test fixtures.
2. Add carefully scoped, reviewable transformations with correctness/regression tests.
3. Integrate a real ESP-IDF build runner and collect build/linker-map metrics.
4. Add reproducible on-device benchmarks for ESP32-S3 hardware.
5. Research automatic optimization search and a managed-memory runtime.

## Contributing

Please include a small source fixture or test case with analyzer changes, explain the code pattern being detected, and avoid describing a suggestion as a measured optimization unless there is a reproducible benchmark.

## License

MIT. See [`LICENSE`](LICENSE).
