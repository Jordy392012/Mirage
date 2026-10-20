# MIRAGE Optimization Engine (v0.4.0)

MIRAGE currently combines narrow source-rewrite candidates with static optimization hints. Neither is a guarantee of faster execution. The browser version does not compile C++ or benchmark firmware. Build for the exact board, run correctness tests, and measure before accepting a performance claim.

## Source rewrite candidates

The current engine can propose these six rewrites when it recognizes a simple identifier or array-element operand:

- `pow(x, 2)` / `powf(x, 2)` to `x * x`
- `pow(x, 3)` / `powf(x, 3)` to `x * x * x`
- `x * 1` and `1 * x` to `x`
- `x / 1` to `x`
- `x + 0` to `x`
- `x - 0` to `x`

These are reviewable candidates, not universally semantics-preserving compiler optimizations. Floating-point signed zero, NaNs, overflow, overloaded operators, and implicit type conversions can matter. The engine avoids rewriting comments, strings, and operands that contain function calls; member-access operands are intentionally not matched. Applying candidates is an explicit user action.

## Static optimization hints

The analyzer also flags patterns worth inspecting: expensive math near loops, Serial output near loops, dynamic allocation or Arduino `String`, `strlen` near loops, modulo near loops, multiple loop headers close together, double-precision declarations, and large fixed-array declarations. These are heuristics. They do not prove a hot path, nested loops, stack placement, or a measured bottleneck.

## Planned work

The next passes should be based on stronger parsing and type/control-flow context: repeated invariant calculations, bounds-checked buffer strategies, loop transformations, expensive call-site analysis, and target-aware ESP32/ESP-IDF guidance. More aggressive edits should wait for compile checks and regression tests.


## Structural loop analysis (v0.4.0)

MIRAGE scans braced `for` and `while` loop bodies for repeated simple arithmetic expressions. When an expression appears at least twice and its named operands are not visibly assigned in that body, it reports a review hint. The analyzer now produces a narrow automatic rewrite for repeated arithmetic only when operands are explicit const scalar variables or literals and the loop body appears straight-line (no calls, nested blocks, conditionals, short-circuit operators, division, or volatile declarations). It inserts a const auto temporary at the start of the loop body and replaces the repeated uses. Review the preview and undo if needed; this remains a lexical heuristic, not a C++ compiler or proof of equivalence.

**Limitations:** this is a lightweight lexical heuristic, not a C++ parser or data-flow analysis. Pointer/reference aliases, writes through arrays or objects, function side effects, macros, `volatile`, concurrency, exceptions, control flow and language-specific operator behavior can invalidate a suggestion. A report is not proof that an expression is loop-invariant or that hoisting will be faster; the compiler may already optimize it. Compile and test any manual change, then benchmark on the target ESP32.

## Function-aware loop findings and confidence

MIRAGE now reports repeated function-call patterns and repeated simple array accesses inside braced loops, alongside repeated arithmetic. Findings show HIGH, MEDIUM, or LOW confidence where available. Confidence describes how much the lexical evidence supports the pattern, not the likelihood of a speedup. Function calls and array reads are advisory only and are not automatically cached because side effects, aliasing, volatile storage, changing values, and compiler behavior cannot be proven by this scan.

The automatic arithmetic rewrite is deliberately limited. It only considers expressions made of a simple identifier or numeric literal joined by multiplication, addition, or subtraction; identifier operands must have an explicit scalar const declaration in the current lexical block and must not be visibly assigned in the loop body. It rejects nested control flow, calls, conditional operators, short-circuit operators, volatile, and division. C++ macros, aliasing, exceptions, target compiler details, and some language semantics remain outside its model. The generated const auto temporary requires C++11 or later.

The Auto-Optimize preview contains actual source edits. Selecting Apply rewrites to editor changes the in-browser project text; export the project ZIP to save it. MIRAGE still does not compile firmware or measure runtime/RAM from the browser. Compile for the exact board, run correctness tests, inspect the diff, and benchmark on hardware before accepting changes.


## Experimental Clang-backed compile check

MIRAGE's Clang check uses Clang 22 in WebAssembly to compile and link the selected C/C++ file without executing the resulting artifact. It enables compiler diagnostics and type/syntax validation beyond text-pattern analysis. The toolchain is targeted at wasm32-wasi, not ESP32-S3 Xtensa, and its standard library is not an Arduino/ESP-IDF SDK. Files that include board headers may fail because those headers are absent. This is not an ESP32 firmware build, AST-based optimization proof, benchmark, or RAM map. Static rewrite candidates still require review and target-toolchain validation.

The first check downloads approximately 29 MB of compiler assets. Assets are staged during Pages deployment and verified against six pinned SHA-256 hashes. User source is processed in the browser; the compiled artifact is not executed.


Third-party compiler runtime provenance and licensing notes: see [CLANG_WASM_NOTICES.md](CLANG_WASM_NOTICES.md).
