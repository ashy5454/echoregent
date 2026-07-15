export type SensitiveDataKind = 'email' | 'phone' | 'payment_card' | 'national_id' | 'secret'

export interface RedactionResult {
  value: string
  counts: Partial<Record<SensitiveDataKind, number>>
}

/** Redacts common direct identifiers and credentials before automatic memory persistence. */
export function redactSensitiveData(input: string): RedactionResult {
  const counts: Partial<Record<SensitiveDataKind, number>> = {}
  const redact = (kind: SensitiveDataKind, value: string, pattern: RegExp): string =>
    value.replace(pattern, () => {
      counts[kind] = (counts[kind] ?? 0) + 1
      return `[REDACTED_${kind.toUpperCase()}]`
    })

  let value = input
  value = redact('secret', value, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g)
  value = redact('secret', value, /\b(?:sk|rk|pk|AIza|AKIA)[-_A-Za-z0-9]{16,}\b/g)
  value = redact('secret', value, /\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi)
  value = redact('email', value, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)
  value = redact('national_id', value, /\b\d{3}-\d{2}-\d{4}\b/g)
  value = value.replace(/\b(?:\d[ -]?){13,19}\b/g, (candidate) => {
    const digits = candidate.replace(/\D/g, '')
    if (!isLuhnValid(digits)) return candidate
    counts.payment_card = (counts.payment_card ?? 0) + 1
    return '[REDACTED_PAYMENT_CARD]'
  })
  value = redact('phone', value, /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?){2,4}\d{3,4}(?!\w)/g)
  return { value, counts }
}

function isLuhnValid(value: string): boolean {
  if (value.length < 13 || value.length > 19) return false
  let sum = 0
  let doubleDigit = false
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index])
    if (!Number.isInteger(digit)) return false
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}
