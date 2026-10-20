# MIRAGE Optimization Engine (v0.3.0)

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


## Structural loop analysis (v0.3.0)

MIRAGE scans braced `for` and `while` loop bodies for repeated simple arithmetic expressions. When an expression appears at least twice and its named operands are not visibly assigned in that body, it reports a review hint. The analyzer does not move code or automatically hoist expressions.

**Limitations:** this is a lightweight lexical heuristic, not a C++ parser or data-flow analysis. Pointer/reference aliases, writes through arrays or objects, function side effects, macros, `volatile`, concurrency, exceptions, control flow and language-specific operator behavior can invalidate a suggestion. A report is not proof that an expression is loop-invariant or that hoisting will be faster; the compiler may already optimize it. Compile and test any manual change, then benchmark on the target ESP32.
