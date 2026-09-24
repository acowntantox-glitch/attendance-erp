/**
 * Small, dependency-free CSV serializer (no existing CSV utility was found in the project).
 * RFC 4180 quoting: a field is quoted only when it contains a comma, quote, or newline, and an
 * embedded quote is doubled — never manual string concatenation of unsafe values.
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Excel/Sheets formula-injection mitigation (OWASP CSV Injection guidance): a field that would
 * open as a spreadsheet and start with `=`, `+`, `-`, or `@` can execute as a formula. Prefixing a
 * single quote neutralizes it as a formula while keeping the visible text intact — this changes
 * only the exported CSV's text, never the underlying stored value. Applied to free-text fields an
 * employee/HR could have typed (name, department, location); never applied to status, dates, or
 * duration fields, which are always drawn from a fixed vocabulary or formatted numbers and can
 * never carry a formula prefix.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@"];
export function neutralizeFormulaInjection(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

export function buildCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\r\n");
}
