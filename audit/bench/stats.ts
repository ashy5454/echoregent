/**
 * Wilcoxon signed-rank test for paired samples (two-sided), used by
 * paired-eval.ts to test whether EchoRegent's per-conversation cost/quality
 * deltas are significantly different from zero across the paired sample.
 * No external stats library needed — this is the whole test.
 */

export interface WilcoxonResult {
  n: number          // number of non-zero pairs used
  wPlus: number       // sum of ranks for positive differences
  wMinus: number      // sum of ranks for negative differences
  statistic: number   // min(wPlus, wMinus)
  zApprox: number     // normal approximation z-score (valid for n >= ~10)
  pValueApprox: number // two-sided p-value from the normal approximation
}

export function wilcoxonSignedRank(a: number[], b: number[]): WilcoxonResult {
  if (a.length !== b.length) throw new Error('paired arrays must be the same length')
  const diffs = a.map((v, i) => v - b[i]).filter((d) => d !== 0)
  const n = diffs.length
  if (n === 0) return { n: 0, wPlus: 0, wMinus: 0, statistic: 0, zApprox: 0, pValueApprox: 1 }

  const abs = diffs.map((d) => Math.abs(d))
  const order = abs.map((_, i) => i).sort((i, j) => abs[i] - abs[j])

  // Assign ranks with average-rank tie handling.
  const ranks = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && abs[order[j + 1]] === abs[order[i]]) j++
    const avgRank = (i + 1 + j + 1) / 2
    for (let k = i; k <= j; k++) ranks[order[k]] = avgRank
    i = j + 1
  }

  let wPlus = 0
  let wMinus = 0
  diffs.forEach((d, idx) => {
    if (d > 0) wPlus += ranks[idx]
    else wMinus += ranks[idx]
  })

  const statistic = Math.min(wPlus, wMinus)
  const meanW = (n * (n + 1)) / 4
  const sdW = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24)
  const zApprox = sdW === 0 ? 0 : (statistic - meanW) / sdW
  const pValueApprox = 2 * (1 - normalCdf(Math.abs(zApprox)))

  return { n, wPlus, wMinus, statistic, zApprox, pValueApprox: Math.min(1, pValueApprox) }
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun approximation of the standard normal CDF.
  const t = 1 / (1 + 0.2316419 * z)
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return 1 - p
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
