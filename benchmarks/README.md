# MIRAGE benchmark fixtures

These fixtures begin the measurement stage. They are intentionally narrow: one result only applies to the tested code, board, compiler, and settings.

## ESP32-S3: `powf(x, 2.0f)` vs `x * x`

1. Open `esp32s3_powf_benchmark.ino` in Arduino IDE.
2. Select the ESP32-S3 board that matches your hardware and the same CPU/compiler settings for all runs.
3. Upload the sketch, open Serial Monitor at **115200 baud**, and reset the board.
4. Save the full serial output, including all seven trials, checksum comparison, medians, and heap readings.
5. Repeat the run at least three times after the board has settled. Compare the median-of-seven results between runs.
6. Record the exact board, Arduino-ESP32 core version, CPU frequency, optimization/build settings, and any other settings that can affect timing.

### What this measures

- Median execution time for two small kernels using the same input data and loop count.
- Whether their accumulated results agree within a small tolerance for this finite test dataset.
- Free-heap readings before and after the test, as context only.

### What this does not measure

- It does not prove the rewrite is faster for every input or every compiler.
- The compiler may already turn the `powf` expression into multiplication. If timings are similar, that is a useful result—not a failed benchmark.
- Heap readings are **not** total RAM use, static global allocation, stack high-water mark, or firmware binary size.
- This is not a benchmark of the entire MIRAGE app or a substitute for a full ESP-IDF build/linker-map report.

Do not report a speedup until it is measured on the target board. Keep the raw serial logs so results can be reproduced.
