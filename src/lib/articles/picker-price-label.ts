import { formatCurrency } from '@/lib/utils'

/**
 * Price/unit label for an article in a picker row. A null price renders as an
 * en dash and a null/blank unit omits "/unit"; explicit 0 and explicit units
 * are shown as stored (no hidden 0 or 'st').
 */
export function articlePickerPriceLabel(
  article: { price_excl_vat: number | string | null; unit: string | null },
  currency: string,
): string {
  const price =
    article.price_excl_vat == null || !Number.isFinite(Number(article.price_excl_vat))
      ? '–'
      : formatCurrency(Number(article.price_excl_vat), currency)
  const unit = article.unit?.trim()
  return unit ? `${price}/${unit}` : price
}
