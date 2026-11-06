/**
 * True when a product line's unit price text is a finite number. An empty
 * string (an article without a price was picked) or garbage is invalid; an
 * explicitly typed 0 is valid. Accepts a decimal comma like the form's parser.
 */
export function isValidUnitPriceInput(value: string): boolean {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return false
  return Number.isFinite(Number(normalized))
}

/** True when any product line lacks a valid unit price. Text lines are ignored. */
export function hasLineWithMissingPrice(
  lines: ReadonlyArray<{ line_type: string; unit_price: string }>,
): boolean {
  return lines.some((l) => l.line_type === 'product' && !isValidUnitPriceInput(l.unit_price))
}
