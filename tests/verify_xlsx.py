"""Read-only verification of the actual runtime-produced XLSX, using stdlib."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json

path = Path(__file__).resolve().parents[1] / 'test-results/runtime-sample.xlsx'
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with ZipFile(path) as z:
    assert z.testzip() is None, 'ZIP CRC failure'
    for name in z.namelist():
        if name.endswith(('.xml', '.rels')):
            ET.fromstring(z.read(name))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.attrib['name'] for s in wb.findall('s:sheets/s:sheet', ns)]
    assert names == ['خلاصه', 'نمادها', 'استاتیک', 'مشاهدات', 'فریم‌ها', 'رویدادها', 'کیفیت', 'تعاریف']
    static = ET.fromstring(z.read('xl/worksheets/sheet3.xml'))
    data = static.findall('s:sheetData/s:row', ns)[3:]
    def text_at(row, address):
        return row.find(f's:c[@r="{address}"]/s:is/s:t', ns).text
    assert [text_at(row, f'H{i+5}') for i, row in enumerate(data)] == ['آباد', 'بیمه', 'فملی']
    assert static.find('s:sheetViews/s:sheetView', ns).attrib['rightToLeft'] == '1'
    assert static.find('s:autoFilter', ns) is not None
    for name in z.namelist():
        if name.startswith('xl/worksheets/'):
            assert not ET.fromstring(z.read(name)).findall('.//s:f', ns), 'Formula injection'
    assert b'HYPERLINK' in z.read('xl/worksheets/sheet3.xml')
result = {'xlsx_xml_crc': 'passed', 'alphabetical_static': 'passed', 'literal_formula_text': 'passed', 'rtl_freeze_filter': 'passed', 'sheets': names, 'bytes': path.stat().st_size}
(path.parent / 'xlsx-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
