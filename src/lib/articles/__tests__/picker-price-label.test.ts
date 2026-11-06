import { describe, it, expect } from 'vitest'
import { articlePickerPriceLabel } from '../picker-price-label'

describe('articlePickerPriceLabel', () => {
  it('renders an unspecified price as an en dash and omits a missing unit', () => {
    expect(articlePickerPriceLabel({ price_excl_vat: null, unit: null }, 'SEK')).toBe('–')
  })

  it('keeps the unit when only the price is unspecified', () => {
    expect(articlePickerPriceLabel({ price_excl_vat: null, unit: 'tim' }, 'SEK')).toBe('–/tim')
  })

  it('shows an explicit 0 price and an explicit unit', () => {
    const label = articlePickerPriceLabel({ price_excl_vat: 0, unit: 'st' }, 'SEK')
    expect(label).toMatch(/^0\D*kr\/st$|^0\D*SEK\/st$/)
    expect(label.endsWith('/st')).toBe(true)
    expect(label).not.toContain('–')
  })

  it('omits /unit for a blank unit with a real price', () => {
    expect(articlePickerPriceLabel({ price_excl_vat: 950, unit: '' }, 'SEK')).not.toContain('/')
  })
})
