/**
 * Strict whole-value amount parsing for article prices, shared by the import
 * parser and the import edit step (kept free of spreadsheet dependencies so
 * the client edit step can use it).
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

export interface StrictAmount {
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
export function parseStrictAmount(raw: string | null, numeric: number | null = null): StrictAmount {
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
