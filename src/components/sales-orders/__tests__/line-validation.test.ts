import { describe, it, expect } from 'vitest'
import { hasLineWithMissingPrice, isValidUnitPriceInput } from '../line-validation'

describe('isValidUnitPriceInput', () => {
  it('rejects empty and non-numeric input', () => {
    expect(isValidUnitPriceInput('')).toBe(false)
    expect(isValidUnitPriceInput('   ')).toBe(false)
    expect(isValidUnitPriceInput('abc')).toBe(false)
    expect(isValidUnitPriceInput('NaN')).toBe(false)
    expect(isValidUnitPriceInput('Infinity')).toBe(false)
  })

  it('accepts an explicit zero and decimal comma', () => {
    expect(isValidUnitPriceInput('0')).toBe(true)
    expect(isValidUnitPriceInput('0,00')).toBe(true)
    expect(isValidUnitPriceInput('950')).toBe(true)
    expect(isValidUnitPriceInput('12,5')).toBe(true)
  })
})

describe('hasLineWithMissingPrice', () => {
  it('flags a product line with an empty price', () => {
    expect(hasLineWithMissingPrice([{ line_type: 'product', unit_price: '' }])).toBe(true)
  })

  it('ignores text lines and allows explicit 0', () => {
    expect(
      hasLineWithMissingPrice([
        { line_type: 'text', unit_price: '' },
        { line_type: 'product', unit_price: '0' },
      ]),
    ).toBe(false)
  })
})
