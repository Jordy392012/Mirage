/*
 * MIRAGE Studio: ESP32-S3 microbenchmark for powf(x, 2.0f) vs x * x.
 * Reports timer diagnostics, randomized order, spread, and three input patterns.
 * This is a narrow experiment, not a promise that either expression is faster.
 */
#include <Arduino.h>
#include <math.h>
#include <stdint.h>
#include <esp_random.h>

#if defined(__has_include)
  #if __has_include(<esp_arduino_version.h>)
    #include <esp_arduino_version.h>
  #endif
#endif

constexpr size_t kSampleCount = 256;
constexpr uint32_t kRepeats = 400;
constexpr size_t kTrials = 7;
constexpr size_t kTimerSamples = 31;

static volatile float samples[kSampleCount];
static volatile float benchmarkSink = 0.0f;
using Kernel = float (*)(volatile const float*, size_t, uint32_t);

__attribute__((noinline))
static float runPowf(volatile const float* data, size_t count, uint32_t repeats) {
  float sum = 0.0f;
  for (uint32_t repeat = 0; repeat < repeats; ++repeat) {
    for (size_t i = 0; i < count; ++i) {
      const float value = data[i];
      sum += powf(value, 2.0f);
    }
  }
  return sum;
}

__attribute__((noinline))
static float runMultiply(volatile const float* data, size_t count, uint32_t repeats) {
  float sum = 0.0f;
  for (uint32_t repeat = 0; repeat < repeats; ++repeat) {
    for (size_t i = 0; i < count; ++i) {
      const float value = data[i];
      sum += value * value;
    }
  }
  return sum;
}

static uint32_t timeKernel(Kernel kernel, float* checksum) {
  const uint32_t start = micros();
  *checksum = kernel(samples, kSampleCount, kRepeats);
  const uint32_t elapsed = micros() - start;
  benchmarkSink = *checksum;
  return elapsed;
}

static uint32_t medianOf(const uint32_t* values, size_t count) {
  uint32_t sorted[kTimerSamples];
  for (size_t i = 0; i < count; ++i) sorted[i] = values[i];
  for (size_t i = 1; i < count; ++i) {
    const uint32_t value = sorted[i];
    size_t j = i;
    while (j > 0 && sorted[j - 1] > value) {
      sorted[j] = sorted[j - 1];
      --j;
    }
    sorted[j] = value;
  }
  return sorted[count / 2];
}

static uint32_t minimumOf(const uint32_t* values, size_t count) {
  uint32_t result = values[0];
  for (size_t i = 1; i < count; ++i) if (values[i] < result) result = values[i];
  return result;
}

static uint32_t maximumOf(const uint32_t* values, size_t count) {
  uint32_t result = values[0];
  for (size_t i = 1; i < count; ++i) if (values[i] > result) result = values[i];
  return result;
}

static void fillSamples(float scale) {
  for (size_t i = 0; i < kSampleCount; ++i) {
    const int centered = static_cast<int>(i % 101) - 50;
    samples[i] = static_cast<float>(centered) * scale;
  }
}

static uint32_t measureEmptyTimerInterval() {
  uint32_t intervals[kTimerSamples];
  for (size_t i = 0; i < kTimerSamples; ++i) {
    const uint32_t start = micros();
    intervals[i] = micros() - start;
  }
  return medianOf(intervals, kTimerSamples);
}

static void runPattern(const char* patternName, float scale, bool primaryPattern) {
  fillSamples(scale);
  benchmarkSink = runPowf(samples, kSampleCount, 2);
  benchmarkSink = runMultiply(samples, kSampleCount, 2);

  uint32_t powTimes[kTrials];
  uint32_t multiplyTimes[kTrials];
  float powChecksum = 0.0f;
  float multiplyChecksum = 0.0f;

  for (size_t trial = 0; trial < kTrials; ++trial) {
    // Randomize which kernel goes first for each paired trial.
    const bool powFirst = (esp_random() & 1U) != 0;
    if (powFirst) {
      powTimes[trial] = timeKernel(runPowf, &powChecksum);
      multiplyTimes[trial] = timeKernel(runMultiply, &multiplyChecksum);
    } else {
      multiplyTimes[trial] = timeKernel(runMultiply, &multiplyChecksum);
      powTimes[trial] = timeKernel(runPowf, &powChecksum);
    }

    // Preserve the exact primary trial format for MIRAGE's current importer.
    if (primaryPattern) {
      Serial.printf("Trial %u: powf=%u us | multiply=%u us\n",
                    static_cast<unsigned>(trial + 1),
                    static_cast<unsigned>(powTimes[trial]),
                    static_cast<unsigned>(multiplyTimes[trial]));
    } else {
      // "Case" deliberately avoids being mistaken for a primary Trial row.
      Serial.printf("Case %s %u: powf=%u us | multiply=%u us\n",
                    patternName, static_cast<unsigned>(trial + 1),
                    static_cast<unsigned>(powTimes[trial]),
                    static_cast<unsigned>(multiplyTimes[trial]));
    }
  }

  const float tolerance = 0.0001f * fmaxf(1.0f, fabsf(multiplyChecksum));
  const bool checksumsMatch = fabsf(powChecksum - multiplyChecksum) <= tolerance;
  const uint32_t powMedian = medianOf(powTimes, kTrials);
  const uint32_t multiplyMedian = medianOf(multiplyTimes, kTrials);
  const uint32_t powMin = minimumOf(powTimes, kTrials);
  const uint32_t powMax = maximumOf(powTimes, kTrials);
  const uint32_t multiplyMin = minimumOf(multiplyTimes, kTrials);
  const uint32_t multiplyMax = maximumOf(multiplyTimes, kTrials);

  if (primaryPattern) {
    Serial.printf("powf checksum: %.7f\n", powChecksum);
    Serial.printf("multiply checksum: %.7f\n", multiplyChecksum);
    Serial.printf("Checksum comparison: %s (tolerance %.7f)\n",
                  checksumsMatch ? "PASS" : "FAIL", tolerance);
    Serial.printf("Median powf: %u us\n", static_cast<unsigned>(powMedian));
    Serial.printf("Median multiply: %u us\n", static_cast<unsigned>(multiplyMedian));
    if (multiplyMedian > 0) {
      Serial.printf("Median ratio powf/multiply: %.3fx\n",
                    static_cast<float>(powMedian) / static_cast<float>(multiplyMedian));
    }
    Serial.printf("Timing spread powf: min=%u us | max=%u us | range=%u us\n",
                  static_cast<unsigned>(powMin), static_cast<unsigned>(powMax),
                  static_cast<unsigned>(powMax - powMin));
    Serial.printf("Timing spread multiply: min=%u us | max=%u us | range=%u us\n",
                  static_cast<unsigned>(multiplyMin), static_cast<unsigned>(multiplyMax),
                  static_cast<unsigned>(multiplyMax - multiplyMin));
    Serial.printf("Observable sink: %.7f\n", static_cast<float>(benchmarkSink));
  } else {
    Serial.printf("%s checksum powf: %.7f\n", patternName, powChecksum);
    Serial.printf("%s checksum multiply: %.7f\n", patternName, multiplyChecksum);
    Serial.printf("%s equivalence check: %s (tolerance %.7f)\n",
                  patternName, checksumsMatch ? "PASS" : "FAIL", tolerance);
    Serial.printf("%s median powf: %u us\n", patternName, static_cast<unsigned>(powMedian));
    Serial.printf("%s median multiply: %u us\n", patternName, static_cast<unsigned>(multiplyMedian));
    if (multiplyMedian > 0) {
      Serial.printf("%s median ratio powf/multiply: %.3fx\n", patternName,
                    static_cast<float>(powMedian) / static_cast<float>(multiplyMedian));
    }
    Serial.printf("%s spread powf: min=%u us | max=%u us | range=%u us\n",
                  patternName, static_cast<unsigned>(powMin), static_cast<unsigned>(powMax),
                  static_cast<unsigned>(powMax - powMin));
    Serial.printf("%s spread multiply: min=%u us | max=%u us | range=%u us\n",
                  patternName, static_cast<unsigned>(multiplyMin), static_cast<unsigned>(multiplyMax),
                  static_cast<unsigned>(multiplyMax - multiplyMin));
  }
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println();
  Serial.println("MIRAGE ESP32-S3 powf-vs-multiply benchmark");
  Serial.printf("Samples: %u | repeats: %u | trials: %u\n",
                static_cast<unsigned>(kSampleCount),
                static_cast<unsigned>(kRepeats),
                static_cast<unsigned>(kTrials));
  Serial.printf("Chip model: %s\n", ESP.getChipModel());
  Serial.printf("CPU frequency: %u MHz\n", static_cast<unsigned>(ESP.getCpuFreqMHz()));
  Serial.printf("ESP-IDF SDK: %s\n", ESP.getSdkVersion());
#ifdef ESP_ARDUINO_VERSION_STR
  Serial.printf("Arduino-ESP32 core: %s\n", ESP_ARDUINO_VERSION_STR);
#elif defined(ESP_ARDUINO_VERSION_MAJOR) && defined(ESP_ARDUINO_VERSION_MINOR) && defined(ESP_ARDUINO_VERSION_PATCH)
  Serial.printf("Arduino-ESP32 core: %d.%d.%d\n",
                ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
#else
  Serial.println("Arduino-ESP32 core: version macro unavailable");
#endif

  Serial.printf("Median empty timing interval: %u us (diagnostic only; not subtracted)\n",
                static_cast<unsigned>(measureEmptyTimerInterval()));
  Serial.println("Run order: randomized per paired trial; summaries use medians and min/max spread.");
  Serial.println("Input patterns: balanced (primary), small-magnitude, large-magnitude.");
  Serial.printf("Free heap before: %u bytes\n", ESP.getFreeHeap());
  Serial.printf("Minimum free heap before: %u bytes\n", ESP.getMinFreeHeap());

  // Primary balanced output retains the current importer format.
  runPattern("balanced", 0.03125f, true);
  Serial.println("--- Additional input pattern: small-magnitude ---");
  runPattern("small-magnitude", 0.0009765625f, false);
  Serial.println("--- Additional input pattern: large-magnitude ---");
  runPattern("large-magnitude", 0.125f, false);

  Serial.printf("Free heap after: %u bytes\n", ESP.getFreeHeap());
  Serial.printf("Minimum free heap after: %u bytes\n", ESP.getMinFreeHeap());
  Serial.println("Note: heap readings are context only, not total RAM usage or static .bss size.");
  Serial.println("Keep board, core version, CPU frequency, and build settings unchanged for comparisons.");
  Serial.println("Benchmark complete. Reset the board to run it again.");
}

void loop() {
  delay(1000);
}
