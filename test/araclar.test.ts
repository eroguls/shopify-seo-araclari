import { describe, expect, it } from 'vitest'

import * as paket from '../src/index.js'
import { parseLocaleNumber } from '../src/number.js'
import {
  buildProductJsonLd,
  EMPTY_PRODUCT,
  formatSchemaPrice,
  isValidGtin,
  LIQUID_EXAMPLE,
  RICH_RESULTS_TEST_URL,
  sanitizeProductInput,
  wrapScript,
  type ProductInput,
} from '../src/jsonld.js'
import {
  buildRedirectCsv,
  csvField,
  CSV_HEADER,
  DEFAULT_REDIRECT_OPTIONS,
  normalizePath,
  processRedirects,
  sanitizeRedirectState,
  splitPair,
} from '../src/redirects.js'

const opts = DEFAULT_REDIRECT_OPTIONS

describe('301 yönlendirme: yol normalleştirme', () => {
  it('alan adını, #parçayı ve sondaki eğik çizgiyi atar', () => {
    expect(normalizePath('https://eskisite.com/urun/mavi-gomlek/', opts)).toBe('/urun/mavi-gomlek')
    expect(normalizePath('http://www.eskisite.com.tr/kategori/a#yorumlar', opts)).toBe(
      '/kategori/a',
    )
    expect(normalizePath('www.eskisite.com/sayfa', opts)).toBe('/sayfa')
    expect(normalizePath('eskisite.com/sayfa/', opts)).toBe('/sayfa')
    expect(normalizePath('//cdn.eskisite.com/a', opts)).toBe('/a')
  })

  it('başında eğik çizgi olmayan yolu düzeltir, yinelenen eğik çizgileri birleştirir', () => {
    expect(normalizePath('urun.html', opts)).toBe('/urun.html')
    expect(normalizePath('/kategori//alt///', opts)).toBe('/kategori/alt')
    expect(normalizePath('  "/tirnakli"  ', opts)).toBe('/tirnakli')
  })

  it('sorgu ve sondaki eğik çizgi seçeneklerine uyar', () => {
    expect(normalizePath('/sayfa.php?id=12', opts)).toBe('/sayfa.php')
    expect(normalizePath('/sayfa.php?id=12', { ...opts, stripQuery: false })).toBe(
      '/sayfa.php?id=12',
    )
    expect(normalizePath('/kategori/', { ...opts, trailingSlash: 'keep' })).toBe('/kategori/')
    expect(normalizePath('/', opts)).toBe('/')
  })

  it('okunamayan girişte null döner', () => {
    expect(normalizePath('', opts)).toBeNull()
    expect(normalizePath('/iki kelime', opts)).toBeNull()
    expect(normalizePath('ftp://site.com/a', opts)).toBeNull()
  })

  it('iki sütunlu satırı ayırır', () => {
    expect(splitPair('/eski\t/yeni')).toEqual(['/eski', '/yeni'])
    expect(splitPair('/eski,/yeni')).toEqual(['/eski', '/yeni'])
    expect(splitPair('/eski /yeni')).toEqual(['/eski', '/yeni'])
    expect(splitPair('/tek')).toBeNull()
  })
})

describe('301 yönlendirme: satır denetimi ve CSV', () => {
  it('Shopify içe aktarma başlığıyla CSV üretir', () => {
    const result = processRedirects(
      'https://eski.com/urun/a/\n/kategori/b',
      '/products/a\n/collections/b',
    )
    expect(result.csv.split('\n')[0]).toBe('Redirect from,Redirect to')
    expect(result.csv).toBe(`${CSV_HEADER}\n/urun/a,/products/a\n/kategori/b,/collections/b`)
    expect(result.exported).toBe(2)
  })

  it('hedefi boş satırı eşleme bekliyor olarak işaretler ve dosyaya yazmaz', () => {
    const result = processRedirects('/a\n/b', '/products/a\n')
    expect(result.rows.find((row) => row.from === '/b')?.status).toBe('pending')
    expect(result.counts.pending).toBe(1)
    expect(result.csv).not.toContain('/b')
  })

  it('satır numarası eski ve yeni listede aynı satırı eşler; boş satırlar atlanır', () => {
    const result = processRedirects('/a\n\n/c', '/x\n\n/z')
    expect(result.rows.map((row) => [row.line, row.from, row.to])).toEqual([
      [1, '/a', '/x'],
      [3, '/c', '/z'],
    ])
  })

  it('tekrarları işaretler; farklı hedefli tekrar için not düşer', () => {
    const result = processRedirects('/a\n/a/\n/a', '/x\n/y\n/x')
    expect(result.rows.map((row) => row.status)).toEqual(['ok', 'duplicate', 'duplicate'])
    expect(result.rows[1]?.note).toContain('farklı bir hedefle')
    expect(result.exported).toBe(1)
  })

  it('kendine yönlenen satırı ve döngüleri işaretler', () => {
    const self = processRedirects('/a', '/a/')
    expect(self.rows[0]?.status).toBe('self')
    const loop = processRedirects('/a\n/b', '/b\n/a')
    expect(loop.rows.map((row) => row.status)).toEqual(['loop', 'loop'])
    expect(loop.exported).toBe(0)
  })

  it('zinciri son hedefe bağlar', () => {
    const result = processRedirects('/a\n/b', '/b\n/c')
    expect(result.rows[0]?.status).toBe('chain')
    expect(result.rows[0]?.finalTo).toBe('/c')
    expect(result.csv).toContain('/a,/c')
    expect(result.csv).toContain('/b,/c')
  })

  it('ana sayfayı ve okunamayan adresi geçersiz sayar', () => {
    const result = processRedirects('https://eski.com/\n/iki kelime ve fazlası', '/x\n/y')
    expect(result.rows.map((row) => row.status)).toEqual(['invalid', 'invalid'])
  })

  it('tablodan yapıştırılan iki sütunu kullanır', () => {
    const result = processRedirects('/eski-a\t/products/a\n/eski-b,/products/b', '')
    expect(result.exported).toBe(2)
    expect(result.csv).toContain('/eski-b,/products/b')
  })

  it('CSV alanlarını gerektiğinde tırnaklar', () => {
    expect(csvField('/a,b')).toBe('"/a,b"')
    expect(csvField('/a"b')).toBe('"/a""b"')
    expect(buildRedirectCsv([])).toBe(CSV_HEADER)
  })

  it('kayıtlı durumu doğrular', () => {
    expect(sanitizeRedirectState(null)).toBeNull()
    expect(sanitizeRedirectState({ oldText: 5, options: { trailingSlash: 'x' } })).toEqual({
      oldText: '',
      newText: '',
      options: { stripQuery: true, trailingSlash: 'remove' },
    })
  })
})

const product = (patch: Partial<ProductInput>): ProductInput => ({ ...EMPTY_PRODUCT, ...patch })

describe('ürün JSON-LD', () => {
  it('ayrıştırıcı verilmezse Türkçe sayı biçimini okur', () => {
    const result = buildProductJsonLd(product({ name: 'A', price: '1.299,90' }))
    expect((result.data.offers as { price: string }).price).toBe('1299.90')
  })


  it('geçerli Product + Offer üretir', () => {
    const result = buildProductJsonLd(
      product({
        name: 'Mavi gömlek',
        description: 'Pamuklu gömlek',
        brand: 'Örnek',
        sku: 'MG-01',
        gtin: '4006381333931',
        images: 'https://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.jpg',
        price: '1.299,90',
        currency: 'TRY',
        availability: 'InStock',
        url: 'https://magaza.example.com/products/mavi-gomlek',
      }),
      parseLocaleNumber,
    )
    expect(result.issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(result.data).toEqual({
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: 'Mavi gömlek',
      description: 'Pamuklu gömlek',
      image: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      sku: 'MG-01',
      gtin13: '4006381333931',
      brand: { '@type': 'Brand', name: 'Örnek' },
      offers: {
        '@type': 'Offer',
        url: 'https://magaza.example.com/products/mavi-gomlek',
        priceCurrency: 'TRY',
        price: '1299.90',
        availability: 'https://schema.org/InStock',
      },
    })
    expect(JSON.parse(result.json)).toEqual(result.data)
    expect(result.script.startsWith('<script type="application/ld+json">')).toBe(true)
  })

  it('boş alanları yazmaz; ad zorunludur', () => {
    const result = buildProductJsonLd(product({}), parseLocaleNumber)
    expect(result.data).toEqual({ '@context': 'https://schema.org/', '@type': 'Product' })
    expect(result.issues.some((issue) => issue.field === 'name' && issue.level === 'error')).toBe(
      true,
    )
  })

  it('aggregateRating yalnızca seçilirse ve değerler geçerliyse eklenir', () => {
    const off = buildProductJsonLd(
      product({ name: 'A', ratingValue: '4,5', reviewCount: '12' }),
      parseLocaleNumber,
    )
    expect(off.data.aggregateRating).toBeUndefined()
    const on = buildProductJsonLd(
      product({ name: 'A', ratingEnabled: true, ratingValue: '4,5', reviewCount: '12' }),
      parseLocaleNumber,
    )
    expect(on.data.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.5',
      reviewCount: 12,
      bestRating: 5,
    })
    const bad = buildProductJsonLd(
      product({ name: 'A', ratingEnabled: true, ratingValue: '7', reviewCount: '0' }),
      parseLocaleNumber,
    )
    expect(bad.data.aggregateRating).toBeUndefined()
    expect(bad.issues.filter((issue) => issue.level === 'error')).toHaveLength(2)
  })

  it('GTIN kontrol basamağını ve URL’leri denetler', () => {
    expect(isValidGtin('4006381333931')).toBe(true)
    expect(isValidGtin('4006381333932')).toBe(false)
    expect(isValidGtin('036000291452')).toBe(true)
    expect(isValidGtin('96385074')).toBe(true)
    expect(isValidGtin('12345')).toBe(false)
    const result = buildProductJsonLd(
      product({ name: 'A', gtin: '4006381333932', images: 'resim.jpg', url: 'magaza.com' }),
      parseLocaleNumber,
    )
    const fields = result.issues.filter((i) => i.level === 'error').map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(['gtin', 'images', 'url']))
    expect(result.data.gtin13).toBeUndefined()
  })

  it('fiyatı nokta ondalıkla yazar ve script içinde < karakterini kaçışlar', () => {
    expect(formatSchemaPrice(1299.9)).toBe('1299.90')
    expect(formatSchemaPrice(100)).toBe('100')
    expect(wrapScript('{"a":"</script>"}')).not.toContain('</script>"')
  })

  it('Liquid örneği standart filtreleri kullanır; test bağlantısı Google’a gider', () => {
    expect(LIQUID_EXAMPLE).toContain('{{ product.title | json }}')
    expect(LIQUID_EXAMPLE).toContain('application/ld+json')
    expect(RICH_RESULTS_TEST_URL).toBe('https://search.google.com/test/rich-results')
  })

  it('kayıtlı girdiyi doğrular', () => {
    expect(sanitizeProductInput('x')).toBeNull()
    const value = sanitizeProductInput({ name: 'A', currency: 'XYZ', availability: 'Nope' })
    expect(value?.currency).toBe('TRY')
    expect(value?.availability).toBe('InStock')
    expect(value?.ratingEnabled).toBe(false)
  })
})

describe('paket girişi', () => {
  it('araçları tek yerden dışa aktarır', () => {
    expect(typeof paket.processRedirects).toBe('function')
    expect(typeof paket.buildProductJsonLd).toBe('function')
    expect(paket.parseLocaleNumber('12.500,75')).toBe(12500.75)
  })
})
