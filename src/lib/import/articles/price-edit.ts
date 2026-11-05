import { parseStrictAmount } from './strict-amount'
import { revalidateAfterPriceEdit } from './validation-messages'

/**
 * One keystroke/paste in the import edit step's price field. The raw text is
 * kept as a draft so the input never loses what the user typed (an
 * intermediate "12," is incomplete, not a value); only the complete text is
 * parsed, strictly, into the row's price and errors.
 */
export function applyPriceEdit(
  existingErrors: readonly string[],
  raw: string,
): {
  draft: string
  price_excl_vat: number | null
  is_valid: boolean
  validation_errors: string[]
} {
  const parsed = parseStrictAmount(raw)
  return { draft: raw, price_excl_vat: parsed.value, ...revalidateAfterPriceEdit(existingErrors, parsed) }
}

/** Text shown in the price input: the user's draft when present, else the stored price. */
export function priceInputValue(draft: string | undefined, price: number | null): string {
  if (draft !== undefined) return draft
  return price == null ? '' : String(price)
}
