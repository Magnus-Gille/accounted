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

/** Result of the strict article amount parse (see parseStrictAmount in parser.ts). */
export interface ParsedPriceInput {
  value: number | null
  invalid: boolean
  ambiguous: boolean
}

/**
 * Apply an edited sales price to a row: price errors are recomputed from the
 * strictly parsed edit (malformed or ambiguous text stays an error and never
 * becomes a number), while cost-price errors are kept (the edit step has no
 * cost-price editor, so such a row stays invalid until it is removed).
 */
export function revalidateAfterPriceEdit(
  existingErrors: readonly string[],
  parsed: ParsedPriceInput,
): { is_valid: boolean; validation_errors: string[] } {
  const errors = existingErrors.filter((e) => COST_ERRORS.has(e))
  const priceErrors: string[] = []
  if (parsed.invalid) priceErrors.push(ARTICLE_ERR.priceInvalid)
  if (parsed.ambiguous) priceErrors.push(ARTICLE_ERR.priceAmbiguous)
  if (parsed.value !== null && parsed.value < 0) priceErrors.push(ARTICLE_ERR.priceNegative)
  const all = [...priceErrors, ...errors]
  return { is_valid: all.length === 0, validation_errors: all }
}
