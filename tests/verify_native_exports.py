from pathlib import Path
from zipfile import ZipFile, is_zipfile
from xml.etree import ElementTree as ET
import json
root=Path(__file__).resolve().parents[1]/'test-results/browser'
record=json.loads((root/'download-record.json').read_text())
candidates=[Path(record['filename'])]+list((root/'downloads').rglob('*'))
files=[]
for p in candidates:
    if p.is_file() and is_zipfile(p) and p not in files: files.append(p)
assert files, 'No real downloaded XLSX file was found'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for p in files:
    with ZipFile(p) as z:
        assert z.testzip() is None
        for name in z.namelist():
            if name.endswith(('.xml','.rels')): ET.fromstring(z.read(name))
        wb=ET.fromstring(z.read('xl/workbook.xml'))
        sheets=wb.findall('s:sheets/s:sheet',ns)
        static=next(i+1 for i,s in enumerate(sheets) if s.attrib['name']=='استاتیک')
        sheet=ET.fromstring(z.read(f'xl/worksheets/sheet{static}.xml'))
        rows=sheet.findall('s:sheetData/s:row',ns)[3:]
        symbols=[r.find(f's:c[@r="H{i+5}"]/s:is/s:t',ns).text for i,r in enumerate(rows)]
        assert symbols==['آباد','بیمه','فملی'], symbols
        assert not sheet.findall('.//s:f',ns)
        assert sheet.find('s:sheetViews/s:sheetView',ns).attrib['rightToLeft']=='1'
print('Native Chromium XLSX verified: ZIP/XML, alphabetical static table, literal cells and RTL.')
