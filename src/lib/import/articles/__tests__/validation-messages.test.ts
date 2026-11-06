import { describe, it, expect } from 'vitest'
import { ARTICLE_ERR, revalidateAfterPriceEdit } from '../validation-messages'
import { parseStrictAmount } from '../strict-amount'

const ok = (value: number | null) => ({ value, invalid: false, ambiguous: false })

describe('revalidateAfterPriceEdit', () => {
  it('clears a price error when the price is fixed', () => {
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.priceInvalid], ok(100))).toEqual({
      is_valid: true,
      validation_errors: [],
    })
  })

  it('keeps an unresolved cost-price error when the sales price changes', () => {
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.costAmbiguous], ok(100))).toEqual({
      is_valid: false,
      validation_errors: [ARTICLE_ERR.costAmbiguous],
    })
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.costInvalid, ARTICLE_ERR.priceInvalid], ok(null))).toEqual({
      is_valid: false,
      validation_errors: [ARTICLE_ERR.costInvalid],
    })
  })

  it('adds a negative price error alongside a kept cost error', () => {
    const r = revalidateAfterPriceEdit([ARTICLE_ERR.costNegative], ok(-5))
    expect(r.is_valid).toBe(false)
    expect(r.validation_errors).toEqual([ARTICLE_ERR.priceNegative, ARTICLE_ERR.costNegative])
  })

  it.each([
    ['125abc', ARTICLE_ERR.priceInvalid],
    ['12 5', ARTICLE_ERR.priceInvalid],
    ['12.500', ARTICLE_ERR.priceAmbiguous],
  ])('keeps an edited malformed price %j invalid and never a number', (raw, error) => {
    const parsed = parseStrictAmount(raw)
    expect(parsed.value).toBeNull()
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.priceInvalid], parsed)).toEqual({
      is_valid: false,
      validation_errors: [error],
    })
  })

  it.each([
    ['125', 125],
    ['0', 0],
    ['1 234,50', 1234.5],
    ['', null],
    ['-', null],
  ])('accepts a well-formed edited price %j', (raw, value) => {
    const parsed = parseStrictAmount(raw)
    expect(parsed.value).toBe(value)
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.priceInvalid], parsed)).toEqual({
      is_valid: true,
      validation_errors: [],
    })
  })
})
