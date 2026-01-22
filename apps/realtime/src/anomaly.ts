/**
 * Rolling z-score anomaly detector. O(1) updates via Welford's algorithm.
 * One detector per symbol; fire() returns true when the latest sample deviates
 * by more than `threshold` standard deviations.
 */
export class ZScoreDetector {
  private n = 0;
  private mean = 0;
  private m2 = 0;

  constructor(private readonly threshold = 3.5, private readonly minSamples = 30) {}

  observe(x: number): { z: number; anomaly: boolean } {
    this.n++;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (x - this.mean);
    const variance = this.n > 1 ? this.m2 / (this.n - 1) : 0;
    const std = Math.sqrt(variance);
    const z = std > 0 ? (x - this.mean) / std : 0;
    const anomaly = this.n >= this.minSamples && Math.abs(z) >= this.threshold;
    return { z, anomaly };
  }
}

/**
 * Rolling-window variant — bounded memory, more responsive to regime changes.
 */
export class WindowedZScore {
  private readonly buf: number[] = [];

  constructor(private readonly windowSize = 120, private readonly threshold = 3.0) {}

  observe(x: number): { z: number; anomaly: boolean } {
    this.buf.push(x);
    if (this.buf.length > this.windowSize) this.buf.shift();
    if (this.buf.length < 20) return { z: 0, anomaly: false };
    const mean = this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
    const variance = this.buf.reduce((a, b) => a + (b - mean) ** 2, 0) / this.buf.length;
    const std = Math.sqrt(variance);
    const z = std > 0 ? (x - mean) / std : 0;
    return { z, anomaly: Math.abs(z) >= this.threshold };
  }
}
