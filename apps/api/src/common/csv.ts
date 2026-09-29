/**
 * RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @,
 * tab, CR) are prefixed with an apostrophe — exported data is untrusted
 * (customer names, notes) and must never execute in Excel.
 */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A filename-safe slug for Content-Disposition. */
export const csvName = (base: string) => `${base.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.csv`;
