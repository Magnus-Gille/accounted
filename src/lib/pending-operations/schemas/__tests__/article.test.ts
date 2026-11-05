import { describe, it, expect } from 'vitest'
import { CreateArticleParamsSchema, UpdateArticleParamsSchema } from '../article'

const base = { name: 'EU-konsulting', price_excl_vat: 950 }

describe('CreateArticleParamsSchema currency', () => {
  it('accepts and normalizes an ISO code to upper case', () => {
    const parsed = CreateArticleParamsSchema.parse({ ...base, currency: 'eur' })
    expect(parsed.currency).toBe('EUR')
  })

  it('treats empty string and null as unset (commit defaults to SEK)', () => {
    expect(CreateArticleParamsSchema.parse({ ...base, currency: '' }).currency).toBeUndefined()
    expect(CreateArticleParamsSchema.parse({ ...base, currency: null }).currency).toBeUndefined()
    expect(CreateArticleParamsSchema.parse(base).currency).toBeUndefined()
  })

  it('rejects non-ISO shapes', () => {
    expect(() => CreateArticleParamsSchema.parse({ ...base, currency: 'EURO' })).toThrow()
    expect(() => CreateArticleParamsSchema.parse({ ...base, currency: 'E1' })).toThrow()
  })
})

describe('UpdateArticleParamsSchema currency', () => {
  const id = { article_id: '3a9ac4d2-163a-4d43-8fa3-1b32827505fa' }

  it('accepts a currency-only update', () => {
    const parsed = UpdateArticleParamsSchema.parse({ ...id, currency: 'usd' })
    expect(parsed.currency).toBe('USD')
  })

  it('leaves currency undefined when omitted (sparse update must not touch it)', () => {
    const parsed = UpdateArticleParamsSchema.parse({ ...id, name: 'Nytt namn' })
    expect(parsed.currency).toBeUndefined()
  })
})

describe('CreateArticleParamsSchema housework_type', () => {
  it('normalizes a work-type code or bare kind to upper case', () => {
    expect(CreateArticleParamsSchema.parse({ ...base, housework_type: 'stad' }).housework_type).toBe('STAD')
    expect(CreateArticleParamsSchema.parse({ ...base, housework_type: 'rut' }).housework_type).toBe('RUT')
  })

  it('treats empty, whitespace and null as unset', () => {
    expect(CreateArticleParamsSchema.parse({ ...base, housework_type: '' }).housework_type).toBeUndefined()
    expect(CreateArticleParamsSchema.parse({ ...base, housework_type: '  ' }).housework_type).toBeUndefined()
    expect(CreateArticleParamsSchema.parse({ ...base, housework_type: null }).housework_type).toBeUndefined()
  })

  it('rejects free text: the flag would otherwise be silently dead on invoice lines', () => {
    expect(() => CreateArticleParamsSchema.parse({ ...base, housework_type: 'Snickeri' })).toThrow()
    expect(() => CreateArticleParamsSchema.parse({ ...base, housework_type: '1' })).toThrow()
  })
})

describe('UpdateArticleParamsSchema housework_type', () => {
  const id = { article_id: '3a9ac4d2-163a-4d43-8fa3-1b32827505fa' }

  it('accepts a housework_type-only update and normalizes it', () => {
    expect(UpdateArticleParamsSchema.parse({ ...id, housework_type: 'malning' }).housework_type).toBe('MALNING')
  })

  it('leaves housework_type undefined when omitted (sparse update)', () => {
    expect(UpdateArticleParamsSchema.parse({ ...id, name: 'Nytt namn' }).housework_type).toBeUndefined()
  })

  it('null, empty and whitespace-only clear the flag (commit drops only undefined keys)', () => {
    expect(UpdateArticleParamsSchema.parse({ ...id, housework_type: null }).housework_type).toBeNull()
    expect(UpdateArticleParamsSchema.parse({ ...id, housework_type: '' }).housework_type).toBeNull()
    expect(UpdateArticleParamsSchema.parse({ ...id, housework_type: '  ' }).housework_type).toBeNull()
  })

  it('rejects free text on update too', () => {
    expect(() => UpdateArticleParamsSchema.parse({ ...id, housework_type: 'Snickeri' })).toThrow()
  })
})

describe('UpdateArticleParamsSchema unit', () => {
  const articleId = { article_id: '0b9c1a2e-5d4f-4e6a-9b8c-7d6e5f4a3b21' }

  it('leaves the unit untouched when omitted (key absent from the parsed update)', () => {
    const parsed = UpdateArticleParamsSchema.parse({ ...articleId, name: 'X' })
    expect(parsed.unit).toBeUndefined()
  })

  it('null clears the unit to not specified', () => {
    expect(UpdateArticleParamsSchema.parse({ ...articleId, unit: null }).unit).toBeNull()
  })

  it('empty or whitespace-only string also clears it', () => {
    expect(UpdateArticleParamsSchema.parse({ ...articleId, unit: '' }).unit).toBeNull()
    expect(UpdateArticleParamsSchema.parse({ ...articleId, unit: '  ' }).unit).toBeNull()
  })

  it('sets a trimmed unit and still rejects an over-long one', () => {
    expect(UpdateArticleParamsSchema.parse({ ...articleId, unit: ' tim ' }).unit).toBe('tim')
    expect(() => UpdateArticleParamsSchema.parse({ ...articleId, unit: 'x'.repeat(33) })).toThrow()
  })
})
