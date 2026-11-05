import { describe, expect, it } from 'vitest'
import { CreateArticleSchema, CreateInvoiceItemSchema, UpdateArticleSchema } from '../schemas'

const article = (overrides: Record<string, unknown> = {}) => ({
  name: 'Catalog item',
  price_excl_vat: 125,
  ...overrides,
})

describe('article catalog nullability', () => {
  it('accepts explicit null for the required catalog price and optional unit', () => {
    expect(
      CreateArticleSchema.safeParse(article({ price_excl_vat: null, unit: null })).success,
    ).toBe(true)
    expect(CreateArticleSchema.safeParse(article({ unit: null })).success).toBe(true)
  })

  it('keeps catalog price required while accepting zero and positive amounts', () => {
    expect(CreateArticleSchema.safeParse({ name: 'Missing price' }).success).toBe(false)
    for (const price of [0, 125.5]) {
      expect(CreateArticleSchema.safeParse(article({ price_excl_vat: price })).success).toBe(true)
    }
  })

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '125'])(
    'rejects invalid catalog price %s',
    (price) => {
      expect(CreateArticleSchema.safeParse(article({ price_excl_vat: price })).success).toBe(false)
    },
  )

  it.each(['', ' ', '   ', '\t'])('rejects nonnull blank catalog unit %j', (unit) => {
    expect(CreateArticleSchema.safeParse(article({ unit })).success).toBe(false)
  })

  it('preserves omitted patch fields and carries explicit null as a clear', () => {
    const omitted = UpdateArticleSchema.parse({ name: 'Renamed' })
    expect(omitted).not.toHaveProperty('unit')
    expect(omitted).not.toHaveProperty('price_excl_vat')

    const cleared = UpdateArticleSchema.parse({ unit: null, price_excl_vat: null })
    expect(cleared).toHaveProperty('unit', null)
    expect(cleared).toHaveProperty('price_excl_vat', null)
  })

  it('keeps invoice row unit and unit price concrete values required', () => {
    const invoiceRow = { description: 'Service', quantity: 1, unit: 'st', unit_price: 125 }
    const { unit, unit_price: unitPrice, ...withoutUnitAndPrice } = invoiceRow
    expect(CreateInvoiceItemSchema.safeParse(invoiceRow).success).toBe(true)
    expect(CreateInvoiceItemSchema.safeParse({ ...invoiceRow, unit: null }).success).toBe(false)
    expect(CreateInvoiceItemSchema.safeParse({ ...invoiceRow, unit_price: null }).success).toBe(false)
    expect(CreateInvoiceItemSchema.safeParse(withoutUnitAndPrice).success).toBe(false)
    expect(CreateInvoiceItemSchema.safeParse({ ...withoutUnitAndPrice, unit }).success).toBe(false)
    expect(CreateInvoiceItemSchema.safeParse({ ...withoutUnitAndPrice, unit_price: unitPrice }).success).toBe(false)
  })
})
