/**
 * Ürün yapılandırılmış verisi (schema.org Product + Offer) üretici. Yalnızca kullanıcının girdiği
 * alanlar yazılır; boş alan çıktıya eklenmez. aggregateRating isteğe bağlıdır ve yalnızca sayfada
 * gerçekten gösterilen yorumlar varsa kullanılmalıdır. Saf fonksiyonlar; tarayıcıda da Node.js’te de
 * çalışır, hiçbir yere istek atmaz.
 */
import { parseLocaleNumber } from './number.js'

export const RICH_RESULTS_TEST_URL = 'https://search.google.com/test/rich-results'

export const JSONLD_CURRENCIES = [
  { value: 'TRY', label: 'TRY (Türk lirası)' },
  { value: 'USD', label: 'USD (ABD doları)' },
  { value: 'EUR', label: 'EUR (Euro)' },
  { value: 'GBP', label: 'GBP (İngiliz sterlini)' },
] as const
export type JsonLdCurrency = (typeof JSONLD_CURRENCIES)[number]['value']

export const AVAILABILITY_OPTIONS = [
  { value: 'InStock', label: 'Stokta' },
  { value: 'OutOfStock', label: 'Stokta yok' },
  { value: 'PreOrder', label: 'Ön sipariş' },
  { value: 'BackOrder', label: 'Tedarik ediliyor (sipariş alınıyor)' },
] as const
export type Availability = (typeof AVAILABILITY_OPTIONS)[number]['value']

export type ProductInput = {
  name: string
  description: string
  brand: string
  sku: string
  gtin: string
  /** Her satır bir görsel URL'si. */
  images: string
  /** Ham fiyat (Türkçe biçim desteklenir). */
  price: string
  currency: JsonLdCurrency
  availability: Availability
  url: string
  ratingEnabled: boolean
  ratingValue: string
  reviewCount: string
}

export const EMPTY_PRODUCT: ProductInput = {
  name: '',
  description: '',
  brand: '',
  sku: '',
  gtin: '',
  images: '',
  price: '',
  currency: 'TRY',
  availability: 'InStock',
  url: '',
  ratingEnabled: false,
  ratingValue: '',
  reviewCount: '',
}

export type FieldKey = keyof ProductInput
export type JsonLdIssue = { field: FieldKey | null; level: 'error' | 'warning'; message: string }

export type JsonLdResult = {
  data: Record<string, unknown>
  /** Biçimlendirilmiş JSON. */
  json: string
  /** Temaya yapıştırılacak <script type="application/ld+json"> bloğu. */
  script: string
  issues: JsonLdIssue[]
}

const BEST_RATING = 5

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch (_error) {
    return false
  }
}

/** GS1 kontrol basamağı (GTIN-8/12/13/14). */
export function isValidGtin(value: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false
  const digits = value.split('').map(Number)
  const check = digits.pop()!
  let sum = 0
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1)
  })
  return (10 - (sum % 10)) % 10 === check
}

/** schema.org fiyatı: nokta ondalık ayırıcı, binlik ayırıcı yok. */
export function formatSchemaPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** JSON'u <script> içine güvenle yerleştirir. */
export function wrapScript(json: string): string {
  return `<script type="application/ld+json">\n${json.replace(/</g, '\\u003c')}\n</script>`
}

export function buildProductJsonLd(
  input: ProductInput,
  parse: (value: string) => number | null = parseLocaleNumber,
): JsonLdResult {
  const issues: JsonLdIssue[] = []
  const error = (field: FieldKey | null, message: string) =>
    issues.push({ field, level: 'error', message })
  const warning = (field: FieldKey | null, message: string) =>
    issues.push({ field, level: 'warning', message })

  const name = input.name.trim()
  const description = input.description.trim()
  const brand = input.brand.trim()
  const sku = input.sku.trim()
  const gtin = input.gtin.replace(/[\s-]/g, '')
  const url = input.url.trim()

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
  }
  if (name) data.name = name
  else error('name', 'Ürün adı zorunlu.')
  if (description) data.description = description

  const imageLines = input.images
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const images = imageLines.filter(isHttpUrl)
  if (images.length < imageLines.length)
    error('images', 'Görsel adresleri https:// ile başlayan tam URL olmalı.')
  if (images.length) data.image = images
  else if (!imageLines.length) warning('images', 'En az bir ürün görseli eklemeniz önerilir.')

  if (sku) data.sku = sku
  if (gtin) {
    if (isValidGtin(gtin)) data[`gtin${gtin.length}`] = gtin
    else error('gtin', 'GTIN 8, 12, 13 veya 14 haneli olmalı ve kontrol basamağı doğru olmalı.')
  }
  if (brand) data.brand = { '@type': 'Brand', name: brand }

  if (url && !isHttpUrl(url)) error('url', 'Ürün URL’si https:// ile başlayan tam adres olmalı.')

  const price = input.price.trim() ? parse(input.price) : null
  if (input.price.trim() && (price === null || price < 0))
    error('price', 'Geçerli bir fiyat girin.')
  if (price !== null && price >= 0) {
    data.offers = {
      '@type': 'Offer',
      ...(url && isHttpUrl(url) ? { url } : {}),
      priceCurrency: input.currency,
      price: formatSchemaPrice(price),
      availability: `https://schema.org/${input.availability}`,
    }
  } else if (!input.price.trim()) {
    warning('price', 'Fiyat girilmezse Offer bölümü oluşturulmaz.')
  }

  if (input.ratingEnabled) {
    const ratingValue = parse(input.ratingValue)
    const reviewCount = parse(input.reviewCount)
    const ratingOk = ratingValue !== null && ratingValue >= 1 && ratingValue <= BEST_RATING
    const countOk = reviewCount !== null && Number.isInteger(reviewCount) && reviewCount > 0
    if (!ratingOk) error('ratingValue', `Ortalama puan 1 ile ${BEST_RATING} arasında olmalı.`)
    if (!countOk) error('reviewCount', 'Yorum sayısı sıfırdan büyük bir tam sayı olmalı.')
    if (ratingOk && countOk) {
      data.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: String(Number(ratingValue.toFixed(2))),
        reviewCount,
        bestRating: BEST_RATING,
      }
    }
  }

  const json = JSON.stringify(data, null, 2)
  return { data, json, script: wrapScript(json), issues }
}

/** Temada dinamik kullanım için örnek Liquid (standart Shopify nesne ve filtreleri). */
export const LIQUID_EXAMPLE = `{%- assign current_variant = product.selected_or_first_available_variant -%}
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": {{ product.title | json }},
  "description": {{ product.description | strip_html | json }},
  "image": [
    {%- for image in product.images limit: 3 -%}
      {{ image | image_url: width: 1200 | prepend: 'https:' | json }}{% unless forloop.last %},{% endunless %}
    {%- endfor -%}
  ],
  "brand": { "@type": "Brand", "name": {{ product.vendor | json }} },
  "sku": {{ current_variant.sku | json }},
  "offers": {
    "@type": "Offer",
    "url": {{ request.origin | append: current_variant.url | json }},
    "priceCurrency": {{ cart.currency.iso_code | json }},
    "price": {{ current_variant.price | divided_by: 100.0 | json }},
    "availability": "https://schema.org/{% if current_variant.available %}InStock{% else %}OutOfStock{% endif %}"
  }
}
</script>`

const isCurrency = (value: unknown): value is JsonLdCurrency =>
  JSONLD_CURRENCIES.some((item) => item.value === value)
const isAvailability = (value: unknown): value is Availability =>
  AVAILABILITY_OPTIONS.some((item) => item.value === value)

/** Dışarıdan (ör. localStorage ya da bir form) gelen değeri ProductInput'a çevirir. */
export function sanitizeProductInput(value: unknown): ProductInput | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const text = (key: keyof ProductInput, max: number) =>
    typeof raw[key] === 'string' ? (raw[key] as string).slice(0, max) : ''
  return {
    name: text('name', 300),
    description: text('description', 5000),
    brand: text('brand', 200),
    sku: text('sku', 100),
    gtin: text('gtin', 20),
    images: text('images', 5000),
    price: text('price', 30),
    currency: isCurrency(raw.currency) ? raw.currency : EMPTY_PRODUCT.currency,
    availability: isAvailability(raw.availability) ? raw.availability : EMPTY_PRODUCT.availability,
    url: text('url', 1000),
    ratingEnabled: raw.ratingEnabled === true,
    ratingValue: text('ratingValue', 10),
    reviewCount: text('reviewCount', 12),
  }
}
