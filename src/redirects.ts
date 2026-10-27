/**
 * 301 yönlendirme listesi. Eski adresler (tam URL veya yol) ve isteğe bağlı yeni yollar satır satır
 * eşlenir; adresler normalize edilir, sorunlu satırlar işaretlenir ve Shopify'ın URL yönlendirme
 * içe aktarma biçiminde CSV üretilir. Saf fonksiyonlar; tarayıcıda da Node.js’te de çalışır.
 *
 * Satır durumları:
 *   ok        CSV'ye girer
 *   chain     hedef başka bir satırın kaynağı (A → B → C); CSV'ye son hedefle (A → C) girer
 *   pending   hedef boş: eşleme bekliyor, CSV'ye girmez
 *   duplicate aynı kaynak daha önce geçti; ilk satır geçerlidir, bu satır CSV'ye girmez
 *   self      kaynak ve hedef aynı; CSV'ye girmez
 *   loop      yönlendirmeler bir döngü oluşturuyor (A → B → A); CSV'ye girmez
 *   invalid   adres okunamadı veya ana sayfa (/) kaynak olarak verildi; CSV'ye girmez
 */
export type TrailingSlash = 'remove' | 'keep'

export type RedirectOptions = {
  /** Sorgu dizesini (?…) kaynaklardan kaldırır. */
  stripQuery: boolean
  /** Sondaki eğik çizgi: kaldır veya olduğu gibi bırak. */
  trailingSlash: TrailingSlash
}

export const DEFAULT_REDIRECT_OPTIONS: RedirectOptions = {
  stripQuery: true,
  trailingSlash: 'remove',
}

export type RedirectStatus = 'ok' | 'chain' | 'pending' | 'duplicate' | 'self' | 'loop' | 'invalid'

export type RedirectRow = {
  /** Girdideki satır numarası (1'den başlar). */
  line: number
  /** Kullanıcının yazdığı eski adres. */
  rawFrom: string
  from: string | null
  to: string | null
  status: RedirectStatus
  /** CSV'ye yazılacak hedef (zincirlerde son hedef). */
  finalTo: string | null
  note: string | null
}

export type RedirectResult = {
  rows: RedirectRow[]
  csv: string
  /** CSV'ye giren satır sayısı (başlık hariç). */
  exported: number
  counts: Record<RedirectStatus, number>
}

export const CSV_HEADER = 'Redirect from,Redirect to'
export const MAX_REDIRECT_LINES = 5000

export const STATUS_LABELS: Record<RedirectStatus, string> = {
  ok: 'Hazır',
  chain: 'Zincir düzeltildi',
  pending: 'Eşleme bekliyor',
  duplicate: 'Tekrar',
  self: 'Kendine yönleniyor',
  loop: 'Döngü',
  invalid: 'Geçersiz',
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** Şemasız alan adı: "www.ornek.com/..." veya "ornek.com.tr/...". */
const BARE_HOST = /^(www\.[^/?#\s]+|[^/?#\s]+\.[a-z]{2,}(?=[/?#]))/i

/**
 * Tek bir adresi mağaza içi yola çevirir: alan adı ve #parça atılır, baştaki eğik çizgi eklenir,
 * yinelenen eğik çizgiler birleştirilir. Okunamayan girişte null döner.
 */
export function normalizePath(input: string, options: RedirectOptions): string | null {
  let value = input.trim().replace(/^["']+|["']+$/g, '')
  if (!value) return null

  if (value.startsWith('//')) value = `https:${value}`
  else if (!SCHEME.test(value) && !value.startsWith('/') && BARE_HOST.test(value))
    value = `https://${value}`

  let path: string
  let query: string
  if (SCHEME.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch (_error) {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    path = url.pathname
    query = url.search
  } else {
    const hashAt = value.indexOf('#')
    if (hashAt >= 0) value = value.slice(0, hashAt)
    const queryAt = value.indexOf('?')
    path = queryAt >= 0 ? value.slice(0, queryAt) : value
    query = queryAt >= 0 ? value.slice(queryAt) : ''
  }

  if (/\s/.test(path)) return null
  path = `/${path}`.replace(/\/{2,}/g, '/')
  if (options.trailingSlash === 'remove' && path.length > 1) path = path.replace(/\/+$/, '')
  if (options.stripQuery || query === '?') query = ''
  return path + query
}

/** Eski listede "eski<TAB>yeni", "eski,yeni" veya "eski;yeni" biçimindeki satırı ayırır. */
export function splitPair(line: string): [string, string] | null {
  const match =
    line.match(/^\s*(\S+)\s*(?:\t|,|;)\s*(\S*)\s*$/) ?? line.match(/^\s*(\S+)\s+(\S+)\s*$/)
  return match ? [match[1]!, match[2] ?? ''] : null
}

/** CSV alanı: virgül, tırnak veya satır sonu içeriyorsa tırnak içine alınır. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildRedirectCsv(pairs: { from: string; to: string }[]): string {
  return [CSV_HEADER, ...pairs.map((pair) => `${csvField(pair.from)},${csvField(pair.to)}`)].join(
    '\n',
  )
}

/** Satır satır eşler; eski listedeki satır numarası yeni listedeki aynı satırla eşleşir. */
export function processRedirects(
  oldText: string,
  newText: string,
  options: RedirectOptions = DEFAULT_REDIRECT_OPTIONS,
): RedirectResult {
  const oldLines = oldText.split(/\r?\n/).slice(0, MAX_REDIRECT_LINES)
  const newLines = newText.split(/\r?\n/)
  const targetOptions: RedirectOptions = { stripQuery: false, trailingSlash: 'remove' }

  const rows: RedirectRow[] = []
  oldLines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return
    let rawFrom = rawLine.trim()
    let rawTo = (newLines[index] ?? '').trim()
    if (!rawTo || /[\t,;]|\s/.test(rawFrom)) {
      const pair = splitPair(rawLine)
      if (pair) {
        rawFrom = pair[0]
        if (!rawTo) rawTo = pair[1]
      }
    }
    const from = normalizePath(rawFrom, options)
    const to = rawTo ? normalizePath(rawTo, targetOptions) : null
    const row: RedirectRow = {
      line: index + 1,
      rawFrom,
      from,
      to,
      status: 'ok',
      finalTo: to,
      note: null,
    }
    if (!from) {
      row.status = 'invalid'
      row.note = 'Adres okunamadı; boşluk veya geçersiz karakter olabilir.'
    } else if (from === '/') {
      row.status = 'invalid'
      row.note =
        'Ana sayfa kaynak olamaz; alan adı bağlandığında ana sayfa zaten yeni mağazayı açar.'
    } else if (rawTo && !to) {
      row.status = 'invalid'
      row.note = 'Hedef adres okunamadı.'
    } else if (!to) {
      row.status = 'pending'
      row.note = 'Hedef boş: bu adresin yeni karşılığını yazın.'
    } else if (from === to) {
      row.status = 'self'
      row.note = 'Kaynak ve hedef aynı; yönlendirme gerekmez ya da hedef yanlış yazılmış.'
    }
    rows.push(row)
  })

  // Tekrarlar: ilk geçerli satır esas alınır.
  const firstByFrom = new Map<string, RedirectRow>()
  for (const row of rows) {
    if (!row.from || row.status === 'invalid') continue
    const first = firstByFrom.get(row.from)
    if (!first) {
      firstByFrom.set(row.from, row)
      continue
    }
    row.status = 'duplicate'
    row.note =
      first.to && row.to && first.to !== row.to
        ? `Bu kaynak ${first.line}. satırda farklı bir hedefle geçiyor (${first.to}); hangisinin doğru olduğuna karar verin.`
        : `Bu kaynak ${first.line}. satırda zaten var.`
  }

  // Zincir ve döngü: hedef, başka bir aktif satırın kaynağıysa izlenir.
  const graph = new Map<string, string>()
  for (const [from, row] of firstByFrom) {
    if ((row.status === 'ok' || row.status === 'chain') && row.to) graph.set(from, row.to)
  }
  for (const [from, row] of firstByFrom) {
    if (row.status !== 'ok' || !row.to || !graph.has(row.to)) continue
    const seen = new Set<string>([from])
    let current = row.to
    let looped = false
    while (graph.has(current)) {
      if (seen.has(current)) {
        looped = true
        break
      }
      seen.add(current)
      current = graph.get(current)!
    }
    if (looped || current === from) {
      row.status = 'loop'
      row.note =
        'Bu yönlendirme bir döngüye giriyor; zincirdeki satırlardan birinin hedefini düzeltin.'
      row.finalTo = null
    } else {
      row.status = 'chain'
      row.finalTo = current
      row.note = `${row.to} de yönlendiriliyor; CSV'ye doğrudan son hedef (${current}) yazıldı.`
    }
  }

  const exportedRows = rows.filter(
    (row) => (row.status === 'ok' || row.status === 'chain') && row.from && row.finalTo,
  )
  const counts: Record<RedirectStatus, number> = {
    ok: 0,
    chain: 0,
    pending: 0,
    duplicate: 0,
    self: 0,
    loop: 0,
    invalid: 0,
  }
  for (const row of rows) counts[row.status] += 1

  return {
    rows,
    csv: buildRedirectCsv(exportedRows.map((row) => ({ from: row.from!, to: row.finalTo! }))),
    exported: exportedRows.length,
    counts,
  }
}

export type RedirectState = { oldText: string; newText: string; options: RedirectOptions }

const MAX_STORED_CHARS = 200_000

/** Dışarıdan (ör. localStorage) gelen değeri RedirectState'e çevirir. */
export function sanitizeRedirectState(value: unknown): RedirectState | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const options = (raw.options ?? {}) as Record<string, unknown>
  return {
    oldText: typeof raw.oldText === 'string' ? raw.oldText.slice(0, MAX_STORED_CHARS) : '',
    newText: typeof raw.newText === 'string' ? raw.newText.slice(0, MAX_STORED_CHARS) : '',
    options: {
      stripQuery:
        typeof options.stripQuery === 'boolean'
          ? options.stripQuery
          : DEFAULT_REDIRECT_OPTIONS.stripQuery,
      trailingSlash: options.trailingSlash === 'keep' ? 'keep' : 'remove',
    },
  }
}
