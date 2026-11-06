import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createMockRequest,
  parseJsonResponse,
  createQueuedMockSupabase,
} from '@/tests/helpers'

const { supabase: mockSupabase, enqueue, reset, findCall } = createQueuedMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve(mockSupabase),
}))

vi.mock('@/lib/init', () => ({ ensureInitialized: vi.fn() }))

vi.mock('@/lib/auth/require-write', () => ({
  requireWritePermission: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/company/context', () => ({
  requireCompanyId: vi.fn().mockResolvedValue('company-1'),
  getActiveCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

const mockEmit = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/events', () => ({ eventBus: { emit: (...a: unknown[]) => mockEmit(...a) } }))

const mockFetchAllRows = vi.fn()
vi.mock('@/lib/supabase/fetch-all', () => ({
  fetchAllRows: (...a: unknown[]) => mockFetchAllRows(...a),
}))

const mockEnsureArticleNumber = vi.fn().mockResolvedValue('AUTO-1')
vi.mock('@/lib/articles/ensure-article-number', () => ({
  ensureArticleNumber: (...a: unknown[]) => mockEnsureArticleNumber(...a),
}))

const mockCheckRevenueAccount = vi.fn().mockResolvedValue('ok')
vi.mock('@/lib/articles/validate-revenue-account', () => ({
  checkRevenueAccount: (...a: unknown[]) => mockCheckRevenueAccount(...a),
}))

import * as XLSX from 'xlsx'
import { parseArticlesFile } from '@/lib/import/articles/parser'
import { POST } from '../execute/route'

const mockUser = { id: 'user-1', email: 'test@test.se' }

function row(overrides: Record<string, unknown> = {}) {
  return {
    row_index: 2,
    name: 'Konsulttimme',
    name_en: null,
    article_number: null,
    type: 'tjanst',
    unit: 'tim',
    price_excl_vat: 950,
    vat_rate: 25,
    revenue_account: null,
    cost_price: null,
    ean: null,
    housework_type: null,
    notes: null,
    ...overrides,
  }
}

function makeRequest(body: unknown) {
  return createMockRequest('/api/import/articles/execute', { method: 'POST', body })
}

describe('POST /api/import/articles/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
    mockFetchAllRows.mockResolvedValue([])
    mockCheckRevenueAccount.mockResolvedValue('ok')
    mockEnsureArticleNumber.mockResolvedValue('AUTO-1')
  })

  it('returns 401 for unauthenticated requests', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeRequest({ rows: [row()], update_duplicates: false }))
    const { status } = await parseJsonResponse(res)
    expect(status).toBe(401)
  })

  it('returns 400 for an empty rows array', async () => {
    const res = await POST(makeRequest({ rows: [], update_duplicates: false }))
    const { status } = await parseJsonResponse(res)
    expect(status).toBe(400)
  })

  it('creates new articles and emits article.created', async () => {
    enqueue({ data: { id: 'a1', name: 'Konsulttimme', article_number: null } })
    enqueue({ data: { id: 'a2', name: 'Skruv', article_number: 'A-200' } })

    const res = await POST(makeRequest({
      rows: [row(), row({ row_index: 3, name: 'Skruv', article_number: 'A-200', type: 'vara' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.created).toBe(2)
    expect(body.data.failed).toBe(0)
    expect(mockEmit).toHaveBeenCalledTimes(2)
    // The numberless row gets auto-numbered; the one with A-200 does not.
    expect(mockEnsureArticleNumber).toHaveBeenCalledTimes(1)
    // The run is recorded so the import can be undone from the history.
    expect(findCall('register_import_runs', 'insert')).toEqual([
      { company_id: 'company-1', user_id: 'user-1', kind: 'articles', created_ids: ['a1', 'a2'], updated_rows: [] },
    ])
  })

  it('inserts a row without unit and price as null (no st / 0 defaults)', async () => {
    enqueue({ data: { id: 'a1', name: 'Utan pris', article_number: null } })

    const res = await POST(makeRequest({
      rows: [row({ name: 'Utan pris', unit: null, price_excl_vat: null })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.created).toBe(1)
    expect(findCall('articles', 'insert')).toEqual([
      expect.objectContaining({ name: 'Utan pris', unit: null, price_excl_vat: null }),
    ])
  })

  it('skips a duplicate matched by article number when update_duplicates is false', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Existing', article_number: 'A-1' }])

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-1' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.skipped).toBe(1)
    expect(body.data.created).toBe(0)
  })

  it('updates a duplicate matched by article number when update_duplicates is true', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1' }])
    enqueue({ data: { id: 'x', name: 'New name', article_number: 'A-1' } })

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-1', name: 'New name' })],
      update_duplicates: true,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.updated).toBe(1)
    expect(body.data.created).toBe(0)
    // The run keeps what the update changed, so an undo can put it back.
    expect(findCall('register_import_runs', 'insert')).toEqual([
      {
        company_id: 'company-1',
        user_id: 'user-1',
        kind: 'articles',
        created_ids: [],
        updated_rows: [{ id: 'x', before: { name: 'Old' }, after: { name: 'New name' } }],
      },
    ])
  })

  it('merge mode: an unspecified price (null, e.g. a "-" cell) leaves the existing price untouched', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1', price_excl_vat: 500 }])
    enqueue({ data: { id: 'x', name: 'New name', article_number: 'A-1' } })

    await POST(makeRequest({
      rows: [row({ article_number: 'A-1', name: 'New name', price_excl_vat: null })],
      update_duplicates: true,
    }))

    const [payload] = findCall('articles', 'update') as Record<string, unknown>[]
    expect(payload).toMatchObject({ name: 'New name' })
    expect(payload).not.toHaveProperty('price_excl_vat')
  })

  it('merge mode: an explicit 0 price overwrites the existing price', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1', price_excl_vat: 500 }])
    enqueue({ data: { id: 'x', name: 'Old', article_number: 'A-1' } })

    await POST(makeRequest({
      rows: [row({ article_number: 'A-1', name: 'Old', price_excl_vat: 0 })],
      update_duplicates: true,
    }))

    const [payload] = findCall('articles', 'update') as Record<string, unknown>[]
    expect(payload).toMatchObject({ price_excl_vat: 0 })
  })

  it('merge mode: leaves the existing unit untouched even when the file has one', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1', unit: 'st' }])
    enqueue({ data: { id: 'x', name: 'New name', article_number: 'A-1' } })

    await POST(makeRequest({
      rows: [row({ article_number: 'A-1', name: 'New name', unit: 'tim' })],
      update_duplicates: true,
    }))

    const [payload] = findCall('articles', 'update') as Record<string, unknown>[]
    expect(payload).toMatchObject({ name: 'New name' })
    expect(payload).not.toHaveProperty('unit')
  })

  it('a "-" unit cell imports a new article without a unit', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['Benämning', 'Enhet', 'Pris'], ['Ny', '-', '10']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Artiklar')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = parseArticlesFile(buf, 'u.xlsx').rows[0]
    enqueue({ data: { id: 'n1', name: 'Ny', article_number: null } })

    await POST(makeRequest({ rows: [parsed], update_duplicates: false }))

    const [payload] = findCall('articles', 'insert') as Record<string, unknown>[]
    expect(payload).toMatchObject({ name: 'Ny', unit: null })
  })

  describe('parser output fed into merge mode', () => {
    function parseOne(priceCell: string) {
      const ws = XLSX.utils.aoa_to_sheet([['Benämning', 'Artikelnummer', 'Pris'], ['Old', 'A-1', priceCell]])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Artiklar')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      return parseArticlesFile(buf, 'p.xlsx').rows[0]
    }

    async function merge(priceCell: string) {
      mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1', price_excl_vat: 500 }])
      enqueue({ data: { id: 'x', name: 'Old', article_number: 'A-1' } })
      const parsed = parseOne(priceCell)
      await POST(makeRequest({ rows: [parsed], update_duplicates: true }))
      return { parsed, update: (findCall('articles', 'update') as Record<string, unknown>[] | undefined)?.[0] }
    }

    it('"-" leaves the existing price untouched', async () => {
      const { parsed, update } = await merge('-')
      expect(parsed.is_valid).toBe(true)
      expect(update ?? {}).not.toHaveProperty('price_excl_vat')
    })

    it('"0" overwrites with an explicit zero', async () => {
      const { parsed, update } = await merge('0')
      expect(parsed.is_valid).toBe(true)
      expect(update).toMatchObject({ price_excl_vat: 0 })
    })

    it.each(['12.500', '12 5'])('%s is flagged invalid and never becomes a price', async (cell) => {
      const { parsed, update } = await merge(cell)
      expect(parsed.is_valid).toBe(false)
      expect(parsed.price_excl_vat).toBeNull()
      expect(update ?? {}).not.toHaveProperty('price_excl_vat')
    })
  })

  it('rejects a row with an invalid (negative) price before importing or updating anything', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1' }])

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-1', price_excl_vat: -5 })],
      update_duplicates: true,
    }))
    const { status } = await parseJsonResponse(res)

    expect(status).toBe(400)
    expect(findCall('articles', 'update')).toBeUndefined()
    expect(findCall('articles', 'insert')).toBeUndefined()
  })

  it('merge mode: a positive price overwrites the existing price', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Old', article_number: 'A-1', price_excl_vat: 500 }])
    enqueue({ data: { id: 'x', name: 'Old', article_number: 'A-1' } })

    await POST(makeRequest({
      rows: [row({ article_number: 'A-1', name: 'Old', price_excl_vat: 750 })],
      update_duplicates: true,
    }))

    const [payload] = findCall('articles', 'update') as Record<string, unknown>[]
    expect(payload).toMatchObject({ price_excl_vat: 750 })
  })

  it('matches a duplicate by name (case-insensitive)', async () => {
    mockFetchAllRows.mockResolvedValue([{ id: 'x', name: 'Konsulttimme', article_number: null }])

    const res = await POST(makeRequest({
      rows: [row({ name: 'KONSULTTIMME' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.skipped).toBe(1)
  })

  it('treats a 23505 unique violation as a soft skip', async () => {
    enqueue({ data: null, error: { code: '23505', message: 'duplicate key' } })

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-DUP' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.skipped).toBe(1)
    expect(body.data.failed).toBe(0)
  })

  it('drops an inactive/unknown revenue account and records a warning', async () => {
    mockCheckRevenueAccount.mockResolvedValue('activatable')
    enqueue({ data: { id: 'a1', name: 'Konsulttimme', article_number: 'A-1' } })

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-1', revenue_account: '3999' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse(res)

    expect(status).toBe(200)
    expect(body.data.created).toBe(1)
    expect(body.data.warnings.length).toBeGreaterThan(0)
    expect(body.data.warnings[0]).toContain('3999')
  })
})

describe('POST /api/import/articles/execute currency handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
    mockFetchAllRows.mockResolvedValue([])
    mockCheckRevenueAccount.mockResolvedValue('ok')
    mockEnsureArticleNumber.mockResolvedValue('AUTO-1')
  })

  it('imports a valid Valuta code and defaults missing to SEK', async () => {
    // First queued result: lazy currencies reference read.
    enqueue({ data: [{ code: 'SEK' }, { code: 'EUR' }, { code: 'USD' }] })
    enqueue({ data: { id: 'a1', name: 'EU-tjanst', article_number: 'A-1', currency: 'EUR' } })
    enqueue({ data: { id: 'a2', name: 'Svensk tjanst', article_number: 'A-2', currency: 'SEK' } })

    const res = await POST(makeRequest({
      rows: [
        row({ name: 'EU-tjanst', article_number: 'A-1', currency: 'EUR' }),
        row({ row_index: 3, name: 'Svensk tjanst', article_number: 'A-2', currency: null }),
      ],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse<{ data: { created: number; warnings: string[] } }>(res)

    expect(status).toBe(200)
    expect(body.data.created).toBe(2)
    expect(body.data.warnings).toEqual([])

    const inserts = mockSupabase.from.mock.calls.filter((c: unknown[]) => c[0] === 'articles')
    expect(inserts.length).toBeGreaterThan(0)
  })

  it('drops a code missing from the currencies table with a warning', async () => {
    enqueue({ data: [{ code: 'SEK' }, { code: 'EUR' }] })
    enqueue({ data: { id: 'a1', name: 'X', article_number: 'A-1', currency: 'SEK' } })

    const res = await POST(makeRequest({
      rows: [row({ article_number: 'A-1', currency: 'XXX' })],
      update_duplicates: false,
    }))
    const { status, body } = await parseJsonResponse<{ data: { warnings: string[] } }>(res)

    expect(status).toBe(200)
    expect(body.data.warnings.some((w) => w.includes('XXX'))).toBe(true)
  })

  it('rejects a malformed currency shape at validation', async () => {
    const res = await POST(makeRequest({
      rows: [row({ currency: 'EURO' })],
      update_duplicates: false,
    }))
    const { status } = await parseJsonResponse(res)
    expect(status).toBe(400)
  })
})
