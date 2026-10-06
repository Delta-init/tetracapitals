/* ────────────────────────────────────────────────────────────────────────────
   Excel (.xlsx) downloads for the portal's lists (the user, 2026-10-06): a real
   workbook rather than a CSV — the header row bold and frozen, the columns sized,
   dates as dates and numbers as numbers, so they sort and add up in Excel. Text
   stays text, so a value starting with "=" is never read as a formula.

   write-excel-file loads with the first export, so no page carries it until then.

   downloadExcel({ fileName, sheet, columns, rows })
     columns: [{ header, type?: 'date' | 'datetime' | 'number', width? }]
     rows:    arrays of values in the columns' order — a date as an ISO string or a
              Date, shown in the viewer's own time as the pages show it
──────────────────────────────────────────────────────────────────────────── */

const FORMATS = { date: 'yyyy-mm-dd', datetime: 'dd mmm yyyy hh:mm' };
const WIDTHS = { date: 12, datetime: 18 };
const MAX_TEXT = 32_767;   // Excel's limit for one cell

/** The viewer's wall clock, written as UTC — Excel has no time zones, and the library writes a Date's UTC time. */
function wallClock(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
}

function cellOf(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'date' || type === 'datetime') {
    const d = wallClock(value);
    if (!d) return String(value);
    if (type === 'date') d.setUTCHours(0, 0, 0, 0);
    return { value: d, type: Date, format: FORMATS[type] };
  }
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? { value: n, type: Number } : String(value);
  }
  return { value: String(value).slice(0, MAX_TEXT), type: String };
}

/** Wide enough for the header and the longest value (of the first 500 rows), within reason. */
function widthOf(column, i, rows) {
  if (column.width) return column.width;
  if (WIDTHS[column.type]) return Math.max(WIDTHS[column.type], column.header.length + 2);
  const longest = rows.slice(0, 500).reduce((m, r) => Math.max(m, String(r[i] ?? '').length), column.header.length);
  return Math.min(50, Math.max(8, longest + 2));
}

export async function downloadExcel({ fileName, sheet = 'Sheet1', columns, rows }) {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const data = [
    columns.map(c => ({ value: c.header, fontWeight: 'bold' })),
    ...rows.map(r => columns.map((c, i) => cellOf(r[i], c.type))),
  ];
  const blob = await writeExcelFile(data, {
    sheet: sheet.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31),   // Excel's rules for a sheet name
    columns: columns.map((c, i) => ({ width: widthOf(c, i, rows) })),
    stickyRowsCount: 1,
  }).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
