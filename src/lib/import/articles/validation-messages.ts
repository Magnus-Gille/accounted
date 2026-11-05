/** Row validation messages for article import (shared by parser and edit step). */
export const ARTICLE_ERR = {
  priceInvalid: 'Priset är inte ett giltigt belopp',
  priceAmbiguous: 'Priset är tvetydigt (punkt som tusentalsavgränsare eller decimal?)',
  priceNegative: 'Priset kan inte vara negativt',
  costInvalid: 'Inköpspriset är inte ett giltigt belopp',
  costAmbiguous: 'Inköpspriset är tvetydigt (punkt som tusentalsavgränsare eller decimal?)',
  costNegative: 'Inköpspriset kan inte vara negativt',
} as const

const COST_ERRORS: ReadonlySet<string> = new Set([
  ARTICLE_ERR.costInvalid,
  ARTICLE_ERR.costAmbiguous,
  ARTICLE_ERR.costNegative,
])

/**
 * Apply an edited sales price to a row: price errors are recomputed from the
 * new value, while cost-price errors are kept (the edit step has no cost-price
 * editor, so such a row stays invalid until it is removed).
 */
export function revalidateAfterPriceEdit(
  existingErrors: readonly string[],
  price: number | null,
): { is_valid: boolean; validation_errors: string[] } {
  const errors = existingErrors.filter((e) => COST_ERRORS.has(e))
  if (price !== null && price < 0) errors.unshift(ARTICLE_ERR.priceNegative)
  return { is_valid: errors.length === 0, validation_errors: errors }
}
