# shopify-seo-araclari

Shopify geçişlerinde ve ürün sayfalarında işe yarayan iki aracın hesaplama çekirdeği. Saf
TypeScript fonksiyonları: bağımlılığı yok, ağ isteği atmaz, tarayıcıda da Node.js’te de çalışır.

[saliherogul.com/araclar](https://saliherogul.com/araclar) sayfasındaki
[301 yönlendirme oluşturucu](https://saliherogul.com/araclar/301-yonlendirme-olusturucu) ve
[ürün JSON-LD üreticisi](https://saliherogul.com/araclar/urun-json-ld) aynı mantıkla çalışıyor;
bu depo o mantığın testleriyle birlikte açık kaynak hali.

## Kurulum

```bash
npm install github:eroguls/shopify-seo-araclari
```

## 301 yönlendirme listesi

Eski adresleri ve yeni karşılıklarını satır satır alır, adresleri normalleştirir, sorunlu satırları
işaretler ve Shopify’ın **URL yönlendirmeleri** içe aktarma biçiminde (`Redirect from,Redirect to`)
CSV üretir.

```ts
import { processRedirects } from 'shopify-seo-araclari'

const result = processRedirects(
  ['https://eskisite.com/urun/mavi-gomlek/', '/kategori/gomlek', '/eski-sayfa'].join('\n'),
  ['/products/mavi-gomlek', '/collections/gomlek', ''].join('\n'),
)

result.csv
// Redirect from,Redirect to
// /urun/mavi-gomlek,/products/mavi-gomlek
// /kategori/gomlek,/collections/gomlek

result.counts.pending // 1 → "/eski-sayfa" için hedef yazılmamış
```

| Durum | Anlamı | CSV’ye girer mi? |
| --- | --- | --- |
| `ok` | Hazır | Evet |
| `chain` | Hedef de yönlendiriliyor (A → B → C); son hedefle yazılır (A → C) | Evet |
| `pending` | Hedef boş | Hayır |
| `duplicate` | Aynı kaynak daha önce geçti; ilk satır geçerli | Hayır |
| `self` | Kaynak ve hedef aynı | Hayır |
| `loop` | Yönlendirmeler döngü oluşturuyor (A → B → A) | Hayır |
| `invalid` | Adres okunamadı ya da ana sayfa (`/`) kaynak verildi | Hayır |

Seçenekler: `stripQuery` (sorgu dizesini kaynaktan atar, varsayılan `true`) ve `trailingSlash`
(`remove` ya da `keep`). Tablodan kopyalanan iki sütunlu satırlar (`eski<TAB>yeni`, `eski,yeni`,
`eski;yeni`) da okunur.

## Ürün JSON-LD

schema.org `Product` + `Offer` işaretlemesi üretir. Yalnızca doldurulan alanlar yazılır; GTIN
kontrol basamağı, görsel ve ürün adresleri denetlenir. Türkçe fiyat biçimi (`1.299,90`) okunur.

```ts
import { buildProductJsonLd, EMPTY_PRODUCT } from 'shopify-seo-araclari'

const { script, issues } = buildProductJsonLd({
  ...EMPTY_PRODUCT,
  name: 'Mavi gömlek',
  sku: 'MG-01',
  gtin: '4006381333931',
  images: 'https://cdn.ornek.com/mavi-gomlek.jpg',
  price: '1.299,90',
  currency: 'TRY',
  url: 'https://ornek.com/products/mavi-gomlek',
})
// script → <script type="application/ld+json"> … </script>
// issues → [] (sorun yoksa)
```

`aggregateRating` yalnızca `ratingEnabled: true` verilirse ve puan 1–5 arasında, yorum sayısı
pozitif tam sayıysa eklenir. Bu alanı yalnızca sayfada gerçekten gösterilen yorumlar varsa
kullanın. Temada dinamik kullanım için `LIQUID_EXAMPLE` hazır bir Liquid şablonu verir; daha
ayrıntılı parçalar [shopify-liquid-parcalari](https://github.com/eroguls/shopify-liquid-parcalari)
deposunda.

Üretilen işaretlemeyi Google’ın [Zengin Sonuçlar Testi](https://search.google.com/test/rich-results)
ile kontrol edin.

## Geliştirme

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Lisans

MIT · [Salih Eroğul](https://saliherogul.com), bağımsız Shopify geliştiricisi.
