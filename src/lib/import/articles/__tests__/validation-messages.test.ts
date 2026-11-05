import { describe, it, expect } from 'vitest'
import { ARTICLE_ERR, revalidateAfterPriceEdit } from '../validation-messages'

describe('revalidateAfterPriceEdit', () => {
  it('clears a price error when the price is fixed', () => {
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.priceInvalid], 100)).toEqual({
      is_valid: true,
      validation_errors: [],
    })
  })

  it('keeps an unresolved cost-price error when the sales price changes', () => {
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.costAmbiguous], 100)).toEqual({
      is_valid: false,
      validation_errors: [ARTICLE_ERR.costAmbiguous],
    })
    expect(revalidateAfterPriceEdit([ARTICLE_ERR.costInvalid, ARTICLE_ERR.priceInvalid], null)).toEqual({
      is_valid: false,
      validation_errors: [ARTICLE_ERR.costInvalid],
    })
  })

  it('adds a negative price error alongside a kept cost error', () => {
    const r = revalidateAfterPriceEdit([ARTICLE_ERR.costNegative], -5)
    expect(r.is_valid).toBe(false)
    expect(r.validation_errors).toEqual([ARTICLE_ERR.priceNegative, ARTICLE_ERR.costNegative])
  })
})
