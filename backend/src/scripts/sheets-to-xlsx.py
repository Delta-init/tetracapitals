"""A sheets JSON ({title, notes, sheets: [{name, columns, rows}]}) → an Excel workbook (the user, 2026-10-24).

   python3 src/scripts/sheets-to-xlsx.py <file.json> <out.xlsx>   (needs openpyxl)

The first sheet gets the title and notes above its table; every sheet a dark header, frozen top row, filters and
column widths to fit. Numbers stay numbers.
"""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
HEAD, FILL = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F3A5F")

wb = Workbook()
wb.remove(wb.active)
for i, sheet in enumerate(data["sheets"]):
    ws = wb.create_sheet(sheet["name"][:31])
    top = 1
    if i == 0:
        ws.append([data.get("title", "")])
        ws["A1"].font = Font(bold=True, size=14)
        for note in data.get("notes", []):
            ws.append([note])
            ws.cell(ws.max_row, 1).font = Font(italic=True, color="666666")
        ws.append([])
        top = ws.max_row + 1
    ws.append(sheet["columns"])
    for c in ws[top]:
        c.font, c.fill, c.alignment = HEAD, FILL, Alignment(vertical="center", wrap_text=True)
    for row in sheet["rows"]:
        ws.append(row)
    ws.freeze_panes = ws.cell(top + 1, 1)
    if sheet["rows"]:
        ws.auto_filter.ref = f"A{top}:{get_column_letter(len(sheet['columns']))}{ws.max_row}"
    for col in range(1, len(sheet["columns"]) + 1):
        cells = [ws.cell(r, col).value for r in range(top, ws.max_row + 1)]
        ws.column_dimensions[get_column_letter(col)].width = min(45, max(9, *(len(str(v)) + 2 for v in cells if v is not None)))
    for r in range(top + 1, ws.max_row + 1):
        for c in ws[r]:
            if isinstance(c.value, float):
                c.number_format = "#,##0.00"
wb.save(dst)
print(f"Saved {dst}: " + ", ".join(f"{s['name']} {len(s['rows'])}" for s in data["sheets"]))
