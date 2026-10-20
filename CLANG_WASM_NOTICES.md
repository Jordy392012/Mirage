# Clang WebAssembly third-party notices

MIRAGE's optional browser compiler check distributes the following third-party toolchain assets during GitHub Pages deployment. The deployment workflow verifies the five runtime asset SHA-256 hashes before publishing.

- **Clang/LLVM 22.1.8 and LLD**: LLVM project, licensed under Apache License 2.0 with LLVM Exceptions. Source and license: https://github.com/llvm/llvm-project and https://github.com/llvm/llvm-project/blob/main/LICENSE.TXT
- **WASI sysroot**: WASI SDK / wasi-libc and libc++ components, under their respective upstream licenses (including Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, and CC0-1.0 where applicable). Sources: https://github.com/WebAssembly/wasi-sdk and https://github.com/llvm/llvm-project
- **Clang-WASM JavaScript toolchain wrapper**: @live-codes/clang-wasm, MIT. Source and license: https://github.com/live-codes/clang-wasm
- **Low-level WebAssembly runtime**: @wasm-idle/llvm-core, licensed under Apache License 2.0 with LLVM Exceptions. Source: https://github.com/wasm-idle/llvm-core

MIRAGE's own source remains under the repository's root LICENSE. These third-party components retain their own licenses and notices; they are not relicensed by MIRAGE. This list summarizes the bundled runtime provenance; consult each upstream repository for complete license texts and component-level notices.
