/* Runtime OOXML writer: offline ZIP STORE, literal strings, typed numbers, RTL. */
const encoder=new TextEncoder();
const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zip(files){
  const chunks=[],directory=[];let offset=0;
  for(const [name,source] of Object.entries(files)){
    const filename=encoder.encode(name),data=encoder.encode(source),crc=crc32(data),head=new Uint8Array(30+filename.length),v=new DataView(head.buffer);
    if(data.length>0xffffffff||offset+data.length>0xffffffff)throw Error('حجم فایل از ZIP32 بیشتر شده است؛ بازه را کوچک‌تر کن.');
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,filename.length,true);head.set(filename,30);
    chunks.push(head,data);const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);directory.push(central);offset+=head.length+data.length;
  }
  const dirSize=directory.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length,true);e.setUint16(10,directory.length,true);e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function column(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function cell(value,r,c,style=0){
  const ref=column(c)+(r+1);
  if(value&&typeof value==='object'&&'value'in value){style=value.style??style;value=value.value;}
  if(value===null||value===undefined||value==='')return `<c r="${ref}" s="${style}"/>`;
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const s=String(value);if(s.length>32767)throw Error('یک سلول بیش از حد Excel است؛ خروجی JSON بگیر.');
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
}
const styles=declaration+`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Tahoma"/><color rgb="FF20364B"/></font><font><b/><sz val="10"/><name val="Tahoma"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="16"/><name val="Tahoma"/><color rgb="FF12344B"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF153E56"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE2BC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment wrapText="1" vertical="center" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"><alignment readingOrder="2" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0"><alignment readingOrder="2" wrapText="1"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
export function workbook(sheets,meta={}){
  const files={},ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships',names=new Set();
  for(const [i,s] of sheets.entries()){
    if(s.rows.length>1048572||s.headers.length>16384)throw Error('حد سطر/ستون Excel رعایت نشده است.');
    if(names.has(s.name)||/[\\/?*\[\]:]/.test(s.name)||s.name.length>31)throw Error('نام برگهٔ نامعتبر.');names.add(s.name);
    const n=Math.max(1,s.headers.length),last=column(n-1),rows=[];
    rows.push(`<row r="1" ht="30" customHeight="1">${cell(s.title||s.name,0,0,2)}</row>`);
    rows.push(`<row r="2" ht="28" customHeight="1">${cell(s.note||'بورسا — زمان‌ها به وقت تهران',1,0)}</row>`);
    rows.push(`<row r="4" ht="35" customHeight="1">${s.headers.map((x,c)=>cell(x,3,c,1)).join('')}</row>`);
    for(const [r,line] of s.rows.entries())rows.push(`<row r="${r+5}" ht="19" customHeight="1">${line.map((x,c)=>cell(x,r+4,c,r%2?3:0)).join('')}</row>`);
    const cols=Array.from({length:n},(_,c)=>`<col min="${c+1}" max="${c+1}" width="${s.widths?.[c]||Math.min(34,Math.max(14,(s.headers[c]?.length||8)+4))}" customWidth="1"/>`).join('');
    const merges=n>1?`<mergeCells count="2"><mergeCell ref="A1:${column(Math.min(n-1,9))}1"/><mergeCell ref="A2:${column(Math.min(n-1,12))}2"/></mergeCells>`:'';
    files[`xl/worksheets/sheet${i+1}.xml`]=declaration+`<worksheet xmlns="${ns}"><dimension ref="A1:${last}${s.rows.length+4}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A4:${last}${Math.max(4,s.rows.length+4)}"/>${merges}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`;
  }
  files['xl/workbook.xml']=declaration+`<workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  files['xl/styles.xml']=styles;
  files['xl/_rels/workbook.xml.rels']=declaration+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`;
  files['_rels/.rels']=declaration+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  files['docProps/core.xml']=declaration+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(meta.title||'BORSA Recorder')}</dc:title><dc:creator>BORSA local recorder</dc:creator><dc:description>${xml(meta.description||'Observed DOM data')}</dc:description></cp:coreProperties>`;
  files['[Content_Types].xml']=declaration+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  return zip(files);
}
