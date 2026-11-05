import type { ArticleType } from '@/types'
import { makeNotice, type ImportNotice } from '@/lib/import/notices'
import { detectArticleColumns } from './column-detector'
import { cellOrNull } from '../shared/column-utils'
import { readBestSheet } from '../shared/workbook-reader'
import type { DetectedArticleColumns, ParsedArticleRow } from './types'
import { ARTICLE_ERR } from './validation-messages'
import { deductionTypeForWorkType, normalizeHouseworkType } from '@/lib/invoices/rot-rut-rules'

const VALID_VAT_RATES = [0, 6, 12, 25] as const

/** Snap an arbitrary VAT percentage to the nearest Swedish statutory rate. */
function snapVatRate(n: number): number {
  let best: number = VALID_VAT_RATES[0]
  let bestDist = Math.abs(n - best)
  for (const r of VALID_VAT_RATES) {
    const d = Math.abs(n - r)
    if (d < bestDist) {
      best = r
      bestDist = d
    }
  }
  return best
}

/**
 * Normalize a VAT cell to one of {0,6,12,25}. Handles "25%", "25", "0,25"
 * (fraction), and Swedish decimal commas. Returns the snapped rate plus an
 * optional human note when the raw value was non-empty but not already valid
 * (e.g. a Fortnox `momskod` letter code or an unsupported percentage).
 */
function normalizeVatRate(raw: string | null): { rate: number; note: string | null } {
  if (!raw) return { rate: 25, note: null }
  const cleaned = raw
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3})/g, '') // dot thousand-separator
    .replace(',', '.') // Swedish decimal comma
    .trim()
  let n = parseFloat(cleaned)
  // Unparseable (e.g. a Fortnox `momskod` like "MP1") → default with a note.
  if (Number.isNaN(n)) {
    return { rate: 25, note: `Kunde inte tolka momssats "${raw}": satt till 25 %` }
  }
  // Fraction form (0.25 → 25).
  if (n > 0 && n < 1) n = n * 100
  const snapped = snapVatRate(n)
  const wasValid = (VALID_VAT_RATES as readonly number[]).includes(Math.round(n))
  return {
    rate: snapped,
    note: wasValid ? null : `Momssats ${raw} avrundades till ${snapped} %`,
  }
}

function normalizeArticleType(value: string | null): ArticleType {
  if (!value) return 'tjanst'
  const lower = value.toLowerCase().trim()
  if (
    lower === 'vara' || lower === 'varor' || lower === 'produkt' ||
    lower === 'product' || lower === 'goods' || lower === 'artikel' ||
    lower === 'lagervara' || lower === 'stock'
  ) {
    return 'vara'
  }
  // Everything else (tjänst/service/…) maps to the DB default.
  return 'tjanst'
}

const INCL_VAT_HEADER_RE = /brutto|inkl|incl|gross/i

/**
 * Parse an article-register file (Excel or CSV) into structured rows.
 *
 * Prices are read as EXCLUDING VAT (what the `articles` table stores). When the
 * matched price header looks like an incl-VAT column a file-level warning is
 * emitted rather than silently converting (the rate isn't reliably known here).
 *
 * @param buffer - Raw file buffer
 * @param filename - Original filename
 * @param columnOverrides - Optional manual column mapping
 */
const PLACEHOLDER_RE = /^[-\u2013\u2014]$/
// Space, nbsp and narrow nbsp are the only accepted thousands separators
// between spaces; tabs and newlines are never part of a number.
const SPACE_GROUPED_RE = /^[-+]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/
// Dot as thousands separator only with a decimal comma, or with two or more
// dot groups, and a first group of 1-3 digits not starting with 0.
const DOT_THOUSANDS_COMMA_RE = /^[-+]?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/
const DOT_THOUSANDS_MULTI_RE = /^[-+]?[1-9]\d{0,2}(?:\.\d{3}){2,}$/
// A single d.ddd without a comma can be 12.500 (12 500) or 12.5: ambiguous.
const AMBIGUOUS_DOT_RE = /^[-+]?\d{1,3}\.\d{3}$/
const PLAIN_RE = /^[-+]?\d+(?:[.,]\d+)?$/

interface StrictAmount {
  value: number | null
  invalid: boolean
  ambiguous: boolean
}

/**
 * Strict whole-cell amount parse for article prices (unlike the lenient
 * parseFloat-based opening-balance parseAmount).
 *
 * - A real numeric spreadsheet value (`numeric`) is used as is: the cell text
 *   is only its display format (12.5 with format 0.000 reads "12.500").
 * - Blank or a lone placeholder (-, en dash, em dash) is null (unspecified).
 * - Otherwise the whole text must be a number: plain digits with a decimal
 *   comma or dot, correctly grouped space/nbsp thousands, or dot thousands
 *   (see the regexes above). A single d.ddd is ambiguous and rejected.
 * - Anything else is invalid and never a number.
 */
function parseStrictAmount(raw: string | null, numeric: number | null = null): StrictAmount {
  if (numeric !== null && Number.isFinite(numeric)) {
    return { value: Math.round(numeric * 100) / 100, invalid: false, ambiguous: false }
  }
  if (raw === null) return { value: null, invalid: false, ambiguous: false }
  const str = raw.trim()
  if (str === '' || PLACEHOLDER_RE.test(str)) return { value: null, invalid: false, ambiguous: false }
  if (AMBIGUOUS_DOT_RE.test(str)) return { value: null, invalid: false, ambiguous: true }

  let normalized: string
  if (DOT_THOUSANDS_COMMA_RE.test(str) || DOT_THOUSANDS_MULTI_RE.test(str)) {
    normalized = str.replace(/\./g, '').replace(',', '.')
  } else if (SPACE_GROUPED_RE.test(str)) {
    normalized = str.replace(/[ \u00a0\u202f]/g, '').replace(',', '.')
  } else if (PLAIN_RE.test(str)) {
    normalized = str.replace(',', '.')
  } else {
    return { value: null, invalid: true, ambiguous: false }
  }
  const num = Number(normalized)
  if (!Number.isFinite(num)) return { value: null, invalid: true, ambiguous: false }
  return { value: Math.round(num * 100) / 100, invalid: false, ambiguous: false }
}

export function parseArticlesFile(
  buffer: ArrayBuffer,
  filename: string,
  columnOverrides?: DetectedArticleColumns,
): {
  filename: string
  sheet_name: string
  total_rows: number
  detected_columns: DetectedArticleColumns
  headers: string[]
  preview_rows: string[][]
  rows: ParsedArticleRow[]
  warnings: string[]
  notices: ImportNotice[]
} {
  const { sheetName, rawData, numericData } = readBestSheet(buffer, filename)

  if (rawData.length < 2) {
    const fallbackColumns: DetectedArticleColumns = columnOverrides ?? {
      name_col: 0,
      article_number_col: null,
      name_en_col: null,
      type_col: null,
      unit_col: null,
      price_col: null,
      currency_col: null,
      vat_rate_col: null,
      revenue_account_col: null,
      cost_price_col: null,
      ean_col: null,
      housework_type_col: null,
      notes_col: null,
      confidence: 0,
    }
    return {
      filename,
      sheet_name: sheetName,
      total_rows: 0,
      detected_columns: fallbackColumns,
      headers: rawData[0]?.map((h) => String(h)) || [],
      preview_rows: [],
      rows: [],
      warnings: ['Filen innehåller för få rader.'],
      notices: [makeNotice('legacy', 'notice', { text: 'Filen innehåller för få rader.' })],
    }
  }

  const headers = rawData[0].map((h) => String(h))
  const dataRows = rawData.slice(1)
  const columns = columnOverrides || detectArticleColumns(headers)

  const rows: ParsedArticleRow[] = []
  const warnings: string[] = []
  const notices: ImportNotice[] = []
  const cell = (row: string[], col: number | null): string | null =>
    col !== null ? cellOrNull(row[col]) : null

  // Real numeric value of a spreadsheet cell (rawData row index, header = 0).
  const dataRowStart = 1
  const numericAt = (rowIdx: number, col: number | null): number | null =>
    col !== null ? (numericData[rowIdx]?.[col] ?? null) : null

  // Surface incl-VAT price columns once for the whole file.
  if (columns.price_col !== null && INCL_VAT_HEADER_RE.test(headers[columns.price_col] ?? '')) {
    warnings.push(
      `Priskolumnen "${headers[columns.price_col]}" verkar vara inkl. moms: priser importeras som exkl. moms. Kontrollera värdena.`,
    )
    notices.push(makeNotice('articles_price_incl_vat', 'action', { header: headers[columns.price_col] ?? '' }))
  }

  let vatNoteCount = 0
  let droppedAccountCount = 0
  let droppedCurrencyCount = 0
  let droppedHouseworkCount = 0
  let droppedGoodsHouseworkCount = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const name = cell(row, columns.name_col)
    if (!name) continue // skip empty rows silently

    const articleNumber = cell(row, columns.article_number_col)
    const nameEn = cell(row, columns.name_en_col)
    const type = normalizeArticleType(cell(row, columns.type_col))
    const unitRaw = cell(row, columns.unit_col)
    // Absent unit stays null ("not specified"), never a hidden 'st'.
    const unit = unitRaw

    const priceRaw = cell(row, columns.price_col)
    const {
      value: price,
      invalid: priceInvalid,
      ambiguous: priceAmbiguous,
    } = parseStrictAmount(priceRaw, numericAt(dataRowStart + i, columns.price_col))

    // Keep only well-formed ISO 4217 codes; the execute route validates them
    // against the currencies table. null = column absent/blank (imports as SEK).
    const currencyRaw = cell(row, columns.currency_col)
    let currency: string | null = null
    if (currencyRaw) {
      const normalized = currencyRaw.trim().toUpperCase()
      if (/^[A-Z]{3}$/.test(normalized)) currency = normalized
      else droppedCurrencyCount++
    }

    const { rate: vatRate, note: vatNote } = normalizeVatRate(cell(row, columns.vat_rate_col))
    if (vatNote) vatNoteCount++

    // Keep only well-formed BAS class 1-3 overrides; the execute route validates
    // them further against the chart of accounts.
    const revenueRaw = cell(row, columns.revenue_account_col)
    let revenueAccount: string | null = null
    if (revenueRaw) {
      const digits = revenueRaw.replace(/\s/g, '')
      if (/^[123]\d{3}$/.test(digits)) revenueAccount = digits
      else droppedAccountCount++
    }

    const costRaw = cell(row, columns.cost_price_col)
    const {
      value: costPrice,
      invalid: costInvalid,
      ambiguous: costAmbiguous,
    } = parseStrictAmount(costRaw, numericAt(dataRowStart + i, columns.cost_price_col))

    const ean = cell(row, columns.ean_col)
    // Canonical work-type code / bare ROT-RUT, or null: a boolean "Rot" column
    // ('0'/'1'/'Ja') mapped by the keyword detector must not land as a value
    // the invoice editor can never interpret.
    const houseworkRaw = cell(row, columns.housework_type_col)
    let houseworkType = normalizeHouseworkType(houseworkRaw)
    if (houseworkRaw !== null && houseworkType === null) droppedHouseworkCount++
    // ROT/RUT is computed on labor only (IL 67 kap. 11-19 §§): material never
    // carries the reduction, so a goods row keeps no ROT/RUT flag. The
    // article form offers goods only the grön teknik installation types, so a
    // stored ROT/RUT flag would be one the user can neither see nor clear.
    // Grön teknik is given on arbete OCH material, so a goods row keeps an
    // installation type (INSTALLATION_*).
    if (houseworkType !== null && type === 'vara' && deductionTypeForWorkType(houseworkType) !== 'gron_teknik') {
      houseworkType = null
      droppedGoodsHouseworkCount++
    }
    const notes = cell(row, columns.notes_col)

    const validationErrors: string[] = []
    if (priceInvalid) validationErrors.push(ARTICLE_ERR.priceInvalid)
    if (priceAmbiguous) validationErrors.push(ARTICLE_ERR.priceAmbiguous)
    if (costInvalid) validationErrors.push(ARTICLE_ERR.costInvalid)
    if (costAmbiguous) validationErrors.push(ARTICLE_ERR.costAmbiguous)
    if (price !== null && price < 0) validationErrors.push(ARTICLE_ERR.priceNegative)
    if (costPrice !== null && costPrice < 0) validationErrors.push(ARTICLE_ERR.costNegative)

    rows.push({
      row_index: i + 2, // 1-based + header
      name,
      name_en: nameEn,
      article_number: articleNumber,
      type,
      unit,
      price_excl_vat: price,
      currency,
      vat_rate: vatRate,
      // A note means the rate was snapped or defaulted: flag it for review.
      vat_rate_adjusted: vatNote !== null,
      revenue_account: revenueAccount,
      cost_price: costPrice,
      ean,
      housework_type: houseworkType,
      notes,
      is_valid: validationErrors.length === 0,
      validation_errors: validationErrors,
    })
  }

  if (vatNoteCount > 0) {
    warnings.push(`${vatNoteCount} rad${vatNoteCount === 1 ? '' : 'er'} hade en momssats som avrundades till närmaste giltiga (0/6/12/25 %).`)
    notices.push(makeNotice('articles_vat_rounded', 'notice', { count: vatNoteCount }))
  }
  if (droppedAccountCount > 0) {
    warnings.push(`${droppedAccountCount} rad${droppedAccountCount === 1 ? '' : 'er'} hade ett ogiltigt bokföringskonto (måste vara klass 1-3) som ignorerades.`)
    notices.push(makeNotice('articles_account_dropped', 'notice', { count: droppedAccountCount }))
  }
  if (droppedHouseworkCount > 0) {
    warnings.push(`${droppedHouseworkCount} rad${droppedHouseworkCount === 1 ? '' : 'er'} hade ett ROT/RUT-värde som inte är en arbetstyp (t.ex. 0/1/Ja) och som ignorerades: sätt arbetstyp på artikeln efteråt.`)
    notices.push(makeNotice('articles_housework_dropped', 'notice', { count: droppedHouseworkCount }))
  }
  if (droppedGoodsHouseworkCount > 0) {
    warnings.push(`${droppedGoodsHouseworkCount} ${droppedGoodsHouseworkCount === 1 ? 'vara' : 'varor'} hade ett ROT/RUT-värde som ignorerades: ROT och RUT gäller bara arbetskostnad. Är artikeln arbete, ändra typen till tjänst och sätt arbetstyp.`)
    notices.push(makeNotice('articles_housework_on_goods_dropped', 'notice', { count: droppedGoodsHouseworkCount }))
  }
  if (droppedCurrencyCount > 0) {
    warnings.push(`${droppedCurrencyCount} rad${droppedCurrencyCount === 1 ? '' : 'er'} hade en ogiltig valutakod (måste vara tre bokstäver, t.ex. EUR) som ignorerades: priset importeras som SEK.`)
    notices.push(makeNotice('articles_currency_dropped', 'notice', { count: droppedCurrencyCount }))
  }
  if (rows.length === 0) {
    warnings.push('Inga giltiga artiklar hittades. Kontrollera att namn-/benämningskolumnen är korrekt mappad.')
    notices.push(
      makeNotice('legacy', 'notice', {
        text: 'Inga giltiga artiklar hittades. Kontrollera att namn-/benämningskolumnen är korrekt mappad.',
      })
    )
  }

  return {
    filename,
    sheet_name: sheetName,
    total_rows: rows.length,
    detected_columns: columns,
    headers,
    preview_rows: dataRows.slice(0, 5),
    rows,
    warnings,
    notices,
  }
}
