import { describe, it, expect } from 'vitest'
import { applyPriceEdit, priceInputValue } from '../price-edit'
import { ARTICLE_ERR } from '../validation-messages'

/** Simulate typing into the price input, keystroke by keystroke, like the edit step does. */
function type(chars: string, startPrice: number | null = null, startErrors: string[] = []) {
  let draft: string | undefined
  let state = { price_excl_vat: startPrice, is_valid: startErrors.length === 0, validation_errors: startErrors }
  const shown: string[] = []
  for (const ch of chars) {
    const current = priceInputValue(draft, state.price_excl_vat)
    const next = applyPriceEdit(state.validation_errors, current + ch)
    draft = next.draft
    state = { price_excl_vat: next.price_excl_vat, is_valid: next.is_valid, validation_errors: next.validation_errors }
    shown.push(priceInputValue(draft, state.price_excl_vat))
  }
  return { ...state, shown }
}

describe('import edit step price input', () => {
  it('keeps the typed text while a decimal is incomplete and ends at 12.50, not 50', () => {
    const r = type('12,50')
    expect(r.shown).toEqual(['1', '12', '12,', '12,5', '12,50'])
    expect(r.price_excl_vat).toBe(12.5)
    expect(r.is_valid).toBe(true)
  })

  it('marks an incomplete decimal invalid until it is completed', () => {
    const mid = applyPriceEdit([], '12,')
    expect(mid).toMatchObject({ draft: '12,', price_excl_vat: null, is_valid: false })
  })

  it('keeps a malformed paste visible and invalid, then accepts the correction', () => {
    const pasted = applyPriceEdit([], '125abc')
    expect(priceInputValue(pasted.draft, pasted.price_excl_vat)).toBe('125abc')
    expect(pasted).toMatchObject({ price_excl_vat: null, is_valid: false, validation_errors: [ARTICLE_ERR.priceInvalid] })
    const fixed = applyPriceEdit(pasted.validation_errors, '125')
    expect(fixed).toMatchObject({ price_excl_vat: 125, is_valid: true, validation_errors: [] })
  })

  it('shows the stored price when the row has not been edited', () => {
    expect(priceInputValue(undefined, 12.5)).toBe('12.5')
    expect(priceInputValue(undefined, null)).toBe('')
  })

  it('keeps a cost-price error while the sales price is edited', () => {
    const r = applyPriceEdit([ARTICLE_ERR.costInvalid], '100')
    expect(r).toMatchObject({ price_excl_vat: 100, is_valid: false, validation_errors: [ARTICLE_ERR.costInvalid] })
  })
})
