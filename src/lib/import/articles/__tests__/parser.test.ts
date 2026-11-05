import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseArticlesFile } from '../parser'

function buildXlsx(rows: (string | number)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Artiklar')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parseArticlesFile', () => {
  it('parses a basic Swedish article register', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Artikelnummer', 'Pris', 'Moms', 'Enhet', 'Typ'],
      ['Konsulttimme', 'A-100', '950', '25', 'tim', 'tjänst'],
      ['Skruv', 'A-200', '2,50', '25', 'st', 'vara'],
    ])

    const result = parseArticlesFile(buffer, 'artiklar.xlsx')

    expect(result.total_rows).toBe(2)
    expect(result.rows[0].name).toBe('Konsulttimme')
    expect(result.rows[0].article_number).toBe('A-100')
    expect(result.rows[0].price_excl_vat).toBe(950)
    expect(result.rows[0].vat_rate).toBe(25)
    expect(result.rows[0].unit).toBe('tim')
    expect(result.rows[0].type).toBe('tjanst')
    expect(result.rows[1].type).toBe('vara')
    expect(result.rows[1].price_excl_vat).toBe(2.5)
    expect(result.rows[0].is_valid).toBe(true)
    // A clean, valid VAT rate is not flagged as adjusted.
    expect(result.rows[0].vat_rate_adjusted).toBe(false)
  })

  it('detects Fortnox-style export headers', () => {
    const buffer = buildXlsx([
      ['Artikelnummer', 'Benämning', 'Försäljningspris', 'Momskod', 'Försäljningskonto', 'Enhet'],
      ['100', 'Webdesign', '1 200', '25', '3001', 'st'],
    ])

    const result = parseArticlesFile(buffer, 'fortnox.xlsx')
    const r = result.rows[0]
    expect(r.article_number).toBe('100')
    expect(r.name).toBe('Webdesign')
    expect(r.price_excl_vat).toBe(1200) // "1 200" → 1200
    expect(r.vat_rate).toBe(25)
    expect(r.revenue_account).toBe('3001')
  })

  it('parses Swedish decimal prices', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris'],
      ['A', '1 234,56'],
      ['B', '1.234,50'],
      ['C', '500'],
    ])

    const result = parseArticlesFile(buffer, 'priser.xlsx')
    expect(result.rows[0].price_excl_vat).toBe(1234.56)
    expect(result.rows[1].price_excl_vat).toBe(1234.5)
    expect(result.rows[2].price_excl_vat).toBe(500)
  })

  it('snaps VAT to the nearest statutory rate and warns', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Moms'],
      ['A', '25%'],
      ['B', '7'],   // → 6
      ['C', ''],    // → 25 default
    ])

    const result = parseArticlesFile(buffer, 'moms.xlsx')
    expect(result.rows[0].vat_rate).toBe(25)
    expect(result.rows[1].vat_rate).toBe(6)
    expect(result.rows[2].vat_rate).toBe(25)
    // The "7" → 6 snap should surface a file-level warning.
    expect(result.warnings.some((w) => w.includes('momssats'))).toBe(true)
    // Per-row flag: only the snapped row (7 → 6) is marked adjusted.
    expect(result.rows[0].vat_rate_adjusted).toBe(false) // "25%" is already valid
    expect(result.rows[1].vat_rate_adjusted).toBe(true)  // 7 → 6
    expect(result.rows[2].vat_rate_adjusted).toBe(false) // empty → default 25
  })

  it('defaults an unparseable momskod to 25 with a warning', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Momskod'],
      ['A', 'MP1'],
    ])

    const result = parseArticlesFile(buffer, 'momskod.xlsx')
    expect(result.rows[0].vat_rate).toBe(25)
    expect(result.rows[0].vat_rate_adjusted).toBe(true)
    expect(result.warnings.some((w) => w.toLowerCase().includes('moms'))).toBe(true)
  })

  it('normalizes article type and falls back to tjanst', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Typ'],
      ['A', 'Produkt'],
      ['B', 'service'],
      ['C', ''],
    ])

    const result = parseArticlesFile(buffer, 'typ.xlsx')
    expect(result.rows[0].type).toBe('vara')
    expect(result.rows[1].type).toBe('tjanst')
    expect(result.rows[2].type).toBe('tjanst')
  })

  it('keeps unit and price null (not specified) when the file has neither', () => {
    const buffer = buildXlsx([
      ['Benämning'],
      ['A'],
    ])
    const result = parseArticlesFile(buffer, 'unit.xlsx')
    expect(result.rows[0].unit).toBeNull()
    expect(result.rows[0].price_excl_vat).toBeNull()
    expect(result.rows[0].is_valid).toBe(true)
  })

  it('keeps blank unit/price cells null but an explicit 0 price as 0', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Enhet', 'Pris'],
      ['Blank', '', ''],
      ['Zero', 'st', '0'],
    ])
    const result = parseArticlesFile(buffer, 'blank.xlsx')
    expect(result.rows[0]).toMatchObject({ unit: null, price_excl_vat: null })
    expect(result.rows[1]).toMatchObject({ unit: 'st', price_excl_vat: 0 })
  })

  it('keeps class 1-3 posting accounts and drops a class-4 account', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Försäljningskonto'],
      ['A', '3001'],
      ['B', '1930'],
      ['C', '4000'],
    ])

    const result = parseArticlesFile(buffer, 'konto.xlsx')
    expect(result.rows[0].revenue_account).toBe('3001')
    expect(result.rows[1].revenue_account).toBe('1930')
    expect(result.rows[2].revenue_account).toBeNull()
    expect(result.warnings.some((w) => w.toLowerCase().includes('bokföringskonto'))).toBe(true)
  })

  it('treats a blank cost price as null (not 0)', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Inköpspris'],
      ['A', ''],
      ['B', '100'],
    ])
    const result = parseArticlesFile(buffer, 'cost.xlsx')
    expect(result.rows[0].cost_price).toBeNull()
    expect(result.rows[1].cost_price).toBe(100)
  })

  it('warns when the price column looks incl-VAT', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris inkl moms'],
      ['A', '125'],
    ])
    const result = parseArticlesFile(buffer, 'brutto.xlsx')
    expect(result.warnings.some((w) => w.toLowerCase().includes('inkl'))).toBe(true)
  })

  it('skips rows with empty name and preserves row_index', () => {
    const buffer = buildXlsx([
      ['Benämning'],
      ['A'],
      [''],
      ['C'],
    ])
    const result = parseArticlesFile(buffer, 'sparse.xlsx')
    expect(result.total_rows).toBe(2)
    expect(result.rows.map((r) => r.name)).toEqual(['A', 'C'])
    expect(result.rows[0].row_index).toBe(2)
    expect(result.rows[1].row_index).toBe(4)
  })

  it('flags a negative price as invalid', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris'],
      ['A', '-50'],
    ])
    const result = parseArticlesFile(buffer, 'neg.xlsx')
    expect(result.rows[0].is_valid).toBe(false)
    expect(result.rows[0].validation_errors).toContain('Priset kan inte vara negativt')
  })

  describe('strict price parsing', () => {
    const parsePrices = (cells: string[]) =>
      parseArticlesFile(
        buildXlsx([['Benämning', 'Pris'], ...cells.map((c, i) => [`A${i}`, c])]),
        'strict.xlsx',
      ).rows

    it('treats blank and lone placeholders as unspecified (null, valid)', () => {
      for (const r of parsePrices(['', '-', '\u2013', '\u2014', ' - '])) {
        expect(r.price_excl_vat).toBeNull()
        expect(r.is_valid).toBe(true)
      }
    })

    it('parses full numeric values including explicit zero', () => {
      const rows = parsePrices(['0', '0,00', '1 234,50', '1\u00a0234,5', '1.234,50', '12.5', '950'])
      expect(rows.map((r) => r.price_excl_vat)).toEqual([0, 0, 1234.5, 1234.5, 1234.5, 12.5, 950])
      expect(rows.every((r) => r.is_valid)).toBe(true)
    })

    it('rejects partially numeric cells as invalid, never as a number', () => {
      for (const r of parsePrices(['125abc', '1,2,3', 'abc', '12 kr'])) {
        expect(r.price_excl_vat).toBeNull()
        expect(r.is_valid).toBe(false)
        expect(r.validation_errors).toContain('Priset är inte ett giltigt belopp')
      }
    })

    it('keeps a negative price numeric and flagged negative', () => {
      const [r] = parsePrices(['-50'])
      expect(r.price_excl_vat).toBe(-50)
      expect(r.validation_errors).toContain('Priset kan inte vara negativt')
    })

    it('treats a single d.ddd dot value without comma as ambiguous, never a number', () => {
      for (const r of parsePrices(['12.500', '2.500', '0.005', '123.456'])) {
        expect(r.price_excl_vat).toBeNull()
        expect(r.is_valid).toBe(false)
        expect(r.validation_errors).toContain(
          'Priset är tvetydigt (punkt som tusentalsavgränsare eller decimal?)',
        )
      }
    })

    it('reads dot as thousands only with a decimal comma or 2+ groups', () => {
      const rows = parsePrices(['1.234,50', '1.234.567', '12.5', '12.50', '12.5000', '1234.567', '12,500'])
      expect(rows.map((r) => r.price_excl_vat)).toEqual([1234.5, 1234567, 12.5, 12.5, 12.5, 1234.57, 12.5])
      expect(rows.every((r) => r.is_valid)).toBe(true)
    })

    it('rejects malformed dot groups', () => {
      for (const r of parsePrices(['01.234.567', '0.123,45', '1.23.456'])) {
        expect(r.price_excl_vat).toBeNull()
        expect(r.is_valid).toBe(false)
      }
    })

    it('accepts only correctly grouped space separators and rejects tabs/newlines', () => {
      const ok = parsePrices(['1 234', '1\u00a0234,50', '1\u202f234 567', ' 950 ', '1 234.50'])
      expect(ok.map((r) => r.price_excl_vat)).toEqual([1234, 1234.5, 1234567, 950, 1234.5])
      for (const r of parsePrices(['12 5', '12\n5', '12\t5', '1 23', '1234 567'])) {
        expect(r.price_excl_vat).toBeNull()
        expect(r.is_valid).toBe(false)
      }
    })

    it('uses the true numeric value of an xlsx number cell, not its display text', () => {
      const ws = XLSX.utils.aoa_to_sheet([['Benämning', 'Pris'], ['A', 12.5], ['B', '12.500']])
      ws.B2.z = '0.000' // displays "12.500"
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Artiklar')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      const rows = parseArticlesFile(buf, 'num.xlsx').rows
      expect(rows[0]).toMatchObject({ price_excl_vat: 12.5, is_valid: true })
      // A text cell "12.500" stays ambiguous.
      expect(rows[1]).toMatchObject({ price_excl_vat: null, is_valid: false })
    })

    it('does not trust the numeric guess of a CSV "12.500"', () => {
      const csv = new TextEncoder().encode('Benämning;Pris\nA;12.500\nB;12.5\n')
      const rows = parseArticlesFile(csv.buffer as ArrayBuffer, 'p.csv').rows
      expect(rows[0]).toMatchObject({ price_excl_vat: null, is_valid: false })
      expect(rows[1]).toMatchObject({ price_excl_vat: 12.5, is_valid: true })
    })

    it('applies the same strictness to cost price', () => {
      const rows = parseArticlesFile(
        buildXlsx([['Benämning', 'Pris', 'Inköpspris'], ['A', '10', '-'], ['B', '10', '5x'], ['C', '10', '0']]),
        'cost.xlsx',
      ).rows
      expect(rows[0].cost_price).toBeNull()
      expect(rows[1].cost_price).toBeNull()
      expect(rows[1].validation_errors).toContain('Inköpspriset är inte ett giltigt belopp')
      expect(rows[2].cost_price).toBe(0)
    })
  })

  it('returns a warning when zero rows match', () => {
    const buffer = buildXlsx([['Benämning']])
    const result = parseArticlesFile(buffer, 'empty.xlsx')
    expect(result.total_rows).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('preserves Swedish characters when reading a UTF-8 CSV', () => {
    const csv = new TextEncoder().encode(
      'Benämning,Enhet\nMöbel,st\nKärra,st\n',
    ).buffer
    const result = parseArticlesFile(csv, 'artiklar.csv')
    expect(result.rows[0].name).toBe('Möbel')
    expect(result.rows[1].name).toBe('Kärra')
  })
})

describe('parseArticlesFile currency (Valuta) column', () => {
  it('parses and normalizes a Valuta column', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Försäljningspris', 'Valuta'],
      ['EU-konsulting', '950', 'eur'],
      ['Svensk tjänst', '500', 'SEK'],
      ['Utan valuta', '100', ''],
    ])

    const result = parseArticlesFile(buffer, 'valuta.xlsx')

    expect(result.detected_columns.currency_col).toBe(2)
    expect(result.rows[0].currency).toBe('EUR')
    expect(result.rows[1].currency).toBe('SEK')
    // Blank cell = not specified: the execute route imports it as SEK.
    expect(result.rows[2].currency).toBeNull()
    expect(result.warnings).toEqual([])
  })

  it('drops malformed currency codes with a warning', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris', 'Valuta'],
      ['A', '100', 'EURO'],
      ['B', '200', 'EUR'],
    ])

    const result = parseArticlesFile(buffer, 'valuta.xlsx')

    expect(result.rows[0].currency).toBeNull()
    expect(result.rows[1].currency).toBe('EUR')
    expect(result.warnings.some((w) => w.includes('valutakod'))).toBe(true)
  })

  it('does not let Valuta steal the price or VAT columns', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Valuta', 'Försäljningspris', 'Moms %'],
      ['A', 'EUR', '100', '25'],
    ])

    const result = parseArticlesFile(buffer, 'valuta.xlsx')

    expect(result.detected_columns.currency_col).toBe(1)
    expect(result.rows[0].price_excl_vat).toBe(100)
    expect(result.rows[0].vat_rate).toBe(25)
  })
})

describe('parseArticlesFile ROT/RUT (housework) column', () => {
  it('normalizes work-type codes and bare kinds, and drops boolean-style values', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris', 'Husarbete'],
      ['Städning', '450', 'stad'],
      ['Fönsterputs', '500', 'RUT'],
      // A boolean "Rot"/"Husarbete" column exported by other systems: '1'/'0'
      // are not values the invoice editor can interpret, so they must not be
      // stored (this is what produced 178 junk rows on prod).
      ['Bygg', '600', '1'],
      ['Skruv', '2', '0'],
    ])

    const result = parseArticlesFile(buffer, 'husarbete.xlsx')

    expect(result.detected_columns.housework_type_col).toBe(2)
    expect(result.rows[0].housework_type).toBe('STAD')
    expect(result.rows[1].housework_type).toBe('RUT')
    expect(result.rows[2].housework_type).toBeNull()
    expect(result.rows[3].housework_type).toBeNull()
    // Dropping a non-empty value is surfaced, never silent.
    expect(result.warnings.some((w) => w.includes('2 rader hade ett ROT/RUT-värde'))).toBe(true)
  })

  it('drops ROT/RUT on goods rows and counts them: the deduction is on labor only', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris', 'Typ', 'Husarbete'],
      ['Montering', '650', 'tjänst', 'VVS'],
      ['Kakel', '400', 'vara', 'ROT'],
      ['Blandare', '1900', 'vara', 'VVS'],
      ['Kabel', '20', 'vara', ''],
      // Not a work type at all: counted by the existing warning, not this one.
      ['Skruv', '2', 'vara', '1'],
    ])

    const result = parseArticlesFile(buffer, 'artiklar.xlsx')

    expect(result.rows.map((r) => [r.name, r.type, r.housework_type])).toEqual([
      ['Montering', 'tjanst', 'VVS'],
      ['Kakel', 'vara', null],
      ['Blandare', 'vara', null],
      ['Kabel', 'vara', null],
      ['Skruv', 'vara', null],
    ])
    expect(result.warnings.some((w) => w.startsWith('2 varor hade ett ROT/RUT-värde som ignorerades'))).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('1 rad hade ett ROT/RUT-värde som inte är en arbetstyp'))).toBe(true)
    expect(result.notices).toContainEqual({
      code: 'articles_housework_on_goods_dropped',
      severity: 'notice',
      params: { count: 2 },
    })
    expect(result.notices).toContainEqual({
      code: 'articles_housework_dropped',
      severity: 'notice',
      params: { count: 1 },
    })
  })

  it('keeps ROT/RUT on rows without a type column (they import as tjänst)', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris', 'Husarbete'],
      ['Takläggning', '700', 'BYGG'],
    ])

    const result = parseArticlesFile(buffer, 'artiklar.xlsx')

    expect(result.rows[0].type).toBe('tjanst')
    expect(result.rows[0].housework_type).toBe('BYGG')
    expect(result.notices?.some((n) => n.code === 'articles_housework_on_goods_dropped')).toBe(false)
  })

  it('emits structured notices beside the warning strings', () => {
    const buffer = buildXlsx([
      ['Benämning', 'Pris inkl. moms', 'Moms', 'Valuta'],
      ['Konsulttimme', '1187,50', '25', 'EURO'],
      ['Fika', '30', '13', 'SEK'],
    ])

    const result = parseArticlesFile(buffer, 'artiklar.xlsx')

    // The VAT-inclusive price column is money-relevant: an action, and the
    // only one, so it becomes the single attention sentence.
    expect(result.notices).toContainEqual({
      code: 'articles_price_incl_vat',
      severity: 'action',
      params: { header: 'Pris inkl. moms' },
    })
    expect(result.notices?.filter((n) => n.severity === 'action')).toHaveLength(1)
    expect(result.notices).toContainEqual({
      code: 'articles_vat_rounded',
      severity: 'notice',
      params: { count: 1 },
    })
    expect(result.notices).toContainEqual({
      code: 'articles_currency_dropped',
      severity: 'notice',
      params: { count: 1 },
    })
    // The strings are still there for API consumers.
    expect(result.warnings.length).toBe(result.notices?.length)
  })
})
