# MIRAGE benchmark fixtures

These fixtures begin the measurement stage. Results apply only to the tested code, board, compiler, build settings, and input workload.

## ESP32-S3: powf(x, 2.0f) vs x * x

1. Open esp32s3_powf_benchmark.ino in Arduino IDE.
2. Select the ESP32-S3 board that matches your hardware. Keep the board selection and settings unchanged between comparison runs.
3. Upload the sketch, open Serial Monitor at **115200 baud**, and reset the board.
4. Save the full serial output from the benchmark header through "Benchmark complete."
5. Repeat the run at least three times after the board has settled. Compare the median-of-seven results and reported timing spread between separate runs.
6. Record the exact board selection, Arduino-ESP32 core version, CPU frequency, optimization/build settings, and any other setting that could affect timing. The sketch reports the chip model, CPU frequency, ESP-IDF SDK version, and Arduino-ESP32 core version when available. If the core version is unavailable in the log, check it in Boards Manager.
7. Keep each complete log. In MIRAGE Studio, paste the log into **Benchmark results**, enter the target and build configuration, then choose **Record benchmark**. Export the local history JSON if you want a backup or to share results.

### What the updated sketch measures

- Seven paired timing trials for each input pattern, with the first kernel randomized per pair to reduce systematic first/second-run bias.
- Median timing and min/max range for both expressions.
- A diagnostic median for an empty micros() interval. It is reported, not subtracted, because timer resolution and call overhead are not a reliable universal correction.
- Three input patterns: balanced values (the primary pattern), small-magnitude values, and large-magnitude values.
- A separate checksum-equivalence check for each pattern.
- Board/CPU/SDK details and free-heap readings for context.

The primary balanced pattern keeps the original "Trial N", checksum, and median labels so the existing MIRAGE importer can continue to record its main result. Extra input-pattern summaries are diagnostic and are not merged into the primary evidence record.

### What this does not prove

- It does not prove either expression is faster for every input or compiler configuration.
- The compiler may already optimize powf(x, 2.0f) into multiplication. Similar timings are useful evidence, not a failed benchmark.
- A checksum match only checks the accumulated outputs for these finite test inputs and this tolerance; it is not a formal proof of equivalence for every possible float.
- Free-heap readings are **not** total RAM use, static global allocation, stack high-water mark, or firmware binary size.
- This is not a benchmark of the entire MIRAGE app or a substitute for an ESP-IDF build/linker-map report.

Do not report a speedup until it is measured on the target board. Preserve raw serial logs so the results can be reproduced.

## Recording evidence in MIRAGE Studio

1. After a complete run, copy all Serial Monitor output from the benchmark header through "Benchmark complete."
2. Open the [MIRAGE Studio site](https://jordy392012.github.io/Mirage/) and scroll to **Benchmark results**.
3. Paste the full log, select the matching target, and record the Arduino-ESP32 core version, CPU frequency, and relevant build settings. For a default Arduino IDE setup, say so and include the board selection and core version if known.
4. Choose **Record benchmark**. Results are stored in that browser's local storage; they are not uploaded to a server. Export the history JSON for backup or sharing.

Evidence labels are deliberately conservative. A checksum failure is never treated as a safe optimization. A median ratio within 1% is labelled **No measured improvement**. A larger one-run difference remains a **Candidate — not verified**. Verification requires at least three comparable runs with the same recorded configuration, passing checksums, a consistent direction, and a difference of at least 3% in each run. These labels apply only to this small benchmark setup, not to whole-firmware performance.
