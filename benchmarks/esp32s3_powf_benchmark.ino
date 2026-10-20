/*
 * MIRAGE Studio: ESP32-S3 microbenchmark for the powf(x, 2.0f) rewrite.
 *
 * Compares the original expression with multiplication on the same board and
 * compiler settings. This is a narrow experiment, not a general benchmark of
 * MIRAGE or a promise that the rewrite is faster.
 */
#include <Arduino.h>
#include <math.h>
#include <stdint.h>

constexpr size_t kSampleCount = 256;
constexpr uint32_t kRepeats = 400;
constexpr size_t kTrials = 7;

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
  benchmarkSink = *checksum;  // Keep the result observable.
  return elapsed;
}

static uint32_t medianOf(uint32_t values[kTrials]) {
  uint32_t sorted[kTrials];
  for (size_t i = 0; i < kTrials; ++i) sorted[i] = values[i];
  for (size_t i = 1; i < kTrials; ++i) {
    const uint32_t value = sorted[i];
    size_t j = i;
    while (j > 0 && sorted[j - 1] > value) {
      sorted[j] = sorted[j - 1];
      --j;
    }
    sorted[j] = value;
  }
  return sorted[kTrials / 2];
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

  for (size_t i = 0; i < kSampleCount; ++i) {
    const int centered = static_cast<int>(i % 101) - 50;
    samples[i] = static_cast<float>(centered) * 0.03125f;
  }

  Serial.printf("Free heap before: %u bytes\n", ESP.getFreeHeap());
  Serial.printf("Minimum free heap before: %u bytes\n", ESP.getMinFreeHeap());

  // Warm both paths before timing to reduce one-time effects.
  benchmarkSink = runPowf(samples, kSampleCount, 2);
  benchmarkSink = runMultiply(samples, kSampleCount, 2);

  uint32_t powTimes[kTrials];
  uint32_t multiplyTimes[kTrials];
  float powChecksum = 0.0f;
  float multiplyChecksum = 0.0f;

  for (size_t trial = 0; trial < kTrials; ++trial) {
    // Alternate order to reduce consistent first/second-run bias.
    if ((trial % 2) == 0) {
      powTimes[trial] = timeKernel(runPowf, &powChecksum);
      multiplyTimes[trial] = timeKernel(runMultiply, &multiplyChecksum);
    } else {
      multiplyTimes[trial] = timeKernel(runMultiply, &multiplyChecksum);
      powTimes[trial] = timeKernel(runPowf, &powChecksum);
    }
    Serial.printf("Trial %u: powf=%u us | multiply=%u us\n",
                  static_cast<unsigned>(trial + 1),
                  static_cast<unsigned>(powTimes[trial]),
                  static_cast<unsigned>(multiplyTimes[trial]));
  }

  const float tolerance = 0.0001f * fmaxf(1.0f, fabsf(multiplyChecksum));
  const bool checksumsMatch = fabsf(powChecksum - multiplyChecksum) <= tolerance;
  const uint32_t powMedian = medianOf(powTimes);
  const uint32_t multiplyMedian = medianOf(multiplyTimes);

  Serial.printf("powf checksum: %.7f\n", powChecksum);
  Serial.printf("multiply checksum: %.7f\n", multiplyChecksum);
  Serial.printf("Checksum comparison: %s (tolerance %.7f)\n",
                checksumsMatch ? "PASS" : "REVIEW DIFFERENCE", tolerance);
  Serial.printf("Median powf: %u us\n", static_cast<unsigned>(powMedian));
  Serial.printf("Median multiply: %u us\n", static_cast<unsigned>(multiplyMedian));
  if (multiplyMedian > 0) {
    Serial.printf("Median ratio powf/multiply: %.3fx\n",
                  static_cast<float>(powMedian) / static_cast<float>(multiplyMedian));
  }
  Serial.printf("Free heap after: %u bytes\n", ESP.getFreeHeap());
  Serial.printf("Minimum free heap after: %u bytes\n", ESP.getMinFreeHeap());
  Serial.printf("Observable sink: %.7f\n", static_cast<float>(benchmarkSink));
  Serial.println("Note: heap readings are not total RAM usage or static .bss size.");
  Serial.println("Benchmark complete. Reset the board to run it again.");
}

void loop() {
  delay(1000);
}
