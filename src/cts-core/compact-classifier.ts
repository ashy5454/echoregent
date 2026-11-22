import { readFileSync } from 'node:fs'

type Weights = {
  format: string
  domains: string[]
  vocabulary: Record<string, number>
  idf: number[]
  coefficients: number[][]
  intercept: number[]
}

export function loadCompactClassifier(path: string): (text: string) => { label: string; score: number } {
  const weights = JSON.parse(readFileSync(path, 'utf8')) as Weights
  if (weights.format !== 'cts-tfidf-logistic-v1' || weights.domains.length !== 8 ||
      weights.coefficients.length !== 8 || weights.intercept.length !== 8 ||
      weights.coefficients.some(row => row.length !== weights.idf.length)) {
    throw new Error('Invalid compact classifier weights')
  }
  return (text: string) => {
    const tokens = text.slice(0, 512).toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []
    const counts = new Map<number, number>()
    const terms = [...tokens, ...tokens.slice(0, -1).map((token, index) => token + ' ' + tokens[index + 1])]
    for (const term of terms) {
      if (!Object.prototype.hasOwnProperty.call(weights.vocabulary, term)) continue
      const index = weights.vocabulary[term]
      if (Number.isInteger(index) && index >= 0 && index < weights.idf.length) counts.set(index, (counts.get(index) ?? 0) + 1)
    }
    let normSquared = 0
    const features = [...counts].map(([index, count]) => {
      const value = (1 + Math.log(count)) * weights.idf[index]
      normSquared += value * value
      return { index, value }
    })
    const norm = Math.sqrt(normSquared) || 1
    const logits = weights.coefficients.map((row, domain) =>
      weights.intercept[domain] + features.reduce((sum, feature) => sum + row[feature.index] * feature.value / norm, 0))
    const max = Math.max(...logits)
    const probabilities = logits.map(value => Math.exp(value - max))
    const total = probabilities.reduce((sum, value) => sum + value, 0)
    const winner = logits.indexOf(max)
    return { label: weights.domains[winner], score: probabilities[winner] / total }
  }
}
