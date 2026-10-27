/**
 * Kullanıcının yazdığı sayıyı okur. Türkçe ("12.500,75") ve noktalı ondalık ("2.5") girişleri kabul
 * eder. Virgül varsa ondalık ayırıcı odur ve noktalar binlik sayılır; virgül yoksa yalnızca
 * "12.500" gibi üçerli gruplar binlik kabul edilir. Okunamayan veya negatif değer için null döner.
 */
export function parseLocaleNumber(input: string): number | null {
  const raw = input.replace(/[\s ₺$€%]/g, '')
  if (raw === '') return null
  let normalized: string
  if (raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, '')
  } else {
    normalized = raw
  }
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.') return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : null
}
