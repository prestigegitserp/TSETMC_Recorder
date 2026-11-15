/* DOM adapters deliberately freeze the chosen table. No execution of filter code. */
(() => {
  'use strict';
  const C=globalThis.BorsaCore, A={};
  const text=e=>(e?.innerText||e?.textContent||'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').trim();
  const shown=e=>e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden';
  A.headerTexts=root=>{
    if(!root)return [];
    if(root.matches('table')&&root.tHead){
      const grid=[];
      for(const [r,row]of [...root.tHead.rows].entries()){
        grid[r]||=[];let col=0;
        for(const cell of row.cells){while(grid[r][col]!==undefined)col++;const value=text(cell);
          for(let rr=r;rr<r+cell.rowSpan;rr++){grid[rr]||=[];for(let cc=col;cc<col+cell.colSpan;cc++)grid[rr][cc]=value;}col+=cell.colSpan;
        }
      }
      const width=grid.reduce((n,row)=>Math.max(n,row.length),0);
      return Array.from({length:width},(_,col)=>{const labels=[];for(const row of grid){const value=row[col];if(value&&labels.at(-1)!==value)labels.push(value);}return labels.join(' / ');});
    }
    return [...root.querySelectorAll('[role="columnheader"]')].map(text);
  };
  A.path=e=>{
    if(!e||e.nodeType!==1)return '';
    if(e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length===1)return `#${CSS.escape(e.id)}`;
    const parts=[];
    for(let n=e;n&&n!==document.documentElement;n=n.parentElement){
      if(n.id){parts.unshift(`#${CSS.escape(n.id)}`);break;}
      const tag=n.tagName.toLowerCase(), siblings=n.parentElement?[...n.parentElement.children].filter(x=>x.tagName===n.tagName):[];
      parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(n)+1})`:''));
      if(parts.length>9)break;
    }
    return parts.join(' > ');
  };
  A.cells=(row,p={})=>{
    if(p.cellSelector)return [...row.querySelectorAll(p.cellSelector)];
    if(row.matches('tr'))return [...row.children].filter(x=>x.matches('td,th'));
    const role=[...row.querySelectorAll('[role="gridcell"], [role="cell"], .ag-cell')];
    return role.length?role:[...row.children].filter(e=>!e.matches('script,style')&&!e.hasAttribute('data-borsa-ui'));
  };
  A.rowFor=el=>{
    const known=el.closest('tr,[role="row"],.ag-row');if(known&&A.cells(known).length>=2)return known;
    for(let n=el.parentElement,depth=0;n&&depth<6;n=n.parentElement,depth++){
      const cells=A.cells(n);
      if(cells.length>=3 && cells.length<=100 && cells.filter(x=>/\d|[۰-۹]/.test(text(x))).length>=2 && n.parentElement?.children.length>=2)return n;
    }
    return null;
  };
  A.mapping=(row,cell)=>{
    let root=row.parentElement;const cells=A.cells(row);
    const headerTable=row.querySelector('th')?row.closest('table'):null;
    if(headerTable)root=headerTable.tBodies[0]||headerTable;
    const index=cells.findIndex(x=>x===cell||x.contains(cell));
    let symbolColumn=index;
    if(symbolColumn<0)symbolColumn=cells.findIndex(x=>/[\u0600-\u06ffA-Za-z]/.test(text(x))&&!/^[-+\d۰-۹.,%٪\s]+$/.test(text(x)));
    return {rootSelector:A.path(root),rowSelector:root===headerTable?'tbody > tr':`:scope > ${row.tagName.toLowerCase()}`,
      cellSelector:row.matches('tr')?':scope > td, :scope > th':row.querySelector('.ag-cell')?'.ag-cell':row.querySelector('[role="gridcell"]')?'[role="gridcell"]':':scope > *',
      symbolColumn:Math.max(0,symbolColumn),identityColumn:null,headerSelector:'',filterNameSelector:'',filterCodeSelector:'',sourceTimeSelector:'',emptySelector:'',coverage:'unverified_dom'};
  };
  A.discover=()=>{
    const candidates=[],seen=new Set();
    const anchors=[...document.querySelectorAll('a[href*="i="],a[href*="/instInfo/"],a[href*="/instinfo/"],[data-inscode],[data-ins-code]')].filter(shown).slice(0,1500);
    for(const el of anchors){
      const row=A.rowFor(el);if(!row||seen.has(row.parentElement))continue;seen.add(row.parentElement);
      const cells=A.cells(row),idx=cells.findIndex(c=>c===el||c.contains(el)),p=A.mapping(row,cells[idx]||el);
      const sample=A.read(p,{trustEmpty:false,captureTitles:false,captureColors:false});
      const score=sample.rows.length*5+sample.rows.filter(r=>r.insCode).length*10;
      if(sample.rows.length)candidates.push({profile:p,score,count:sample.rows.length,headers:sample.headers,sample:sample.rows.slice(0,8),warnings:sample.warnings});
    }
    for(const root of document.querySelectorAll('table,[role="grid"]')){
      if(!shown(root))continue;
      const heads=[...root.querySelectorAll('th,[role="columnheader"]')],symbolHead=heads.find(e=>/^(نماد|symbol)$/i.test(C.normal(text(e))));
      const row=[...root.querySelectorAll('tbody > tr,[role="row"]')].find(r=>A.cells(r).length>=3&&!r.querySelector('th,[role="columnheader"]')&&shown(r));
      if(!symbolHead)continue;
      if(!row&&root.matches('table')){
        const p=A.mapping(symbolHead.closest('tr'),symbolHead),result=A.read(p,{});
        candidates.push({profile:p,score:20,count:0,headers:result.headers,sample:[],status:result.status,warnings:result.warnings});continue;
      }
      if(!row||seen.has(row.parentElement))continue;
      const symbolIndex=A.headerTexts(root).findIndex(h=>C.normal(h).split(' / ').at(-1)==='نماد'||h.toLowerCase()==='symbol');
      const p=A.mapping(row,A.cells(row)[symbolIndex]);p.symbolColumn=Math.max(0,symbolIndex);
      const result=A.read(p,{});if(result.rows.length)candidates.push({profile:p,score:result.rows.length*5+20,count:result.rows.length,headers:result.headers,sample:result.rows.slice(0,8),warnings:result.warnings});
    }
    candidates.sort((a,b)=>b.score-a.score);
    return {candidates:candidates.slice(0,8),ambiguous:candidates.length>1&&candidates[1].score>=candidates[0].score*.85};
  };
  A.read=(p,cfg={})=>{
    const out={headers:[],rows:[],rejectedRows:[],status:'missing_root',warnings:[],coverage:'unverified_dom',sourceTime:'',observedName:'',observedCode:'',totalRows:null};
    if(!p?.rootSelector)return out;
    let roots;
    try {roots=document.querySelectorAll(p.rootSelector);}catch(e){out.status='selector_error';out.warnings.push(e.message);return out;}
    if(roots.length!==1){out.warnings.push(`ROOT_COUNT:${roots.length}`);return out;}
    const root=roots[0];
    const value=selector=>{if(!selector)return '';const el=document.querySelector(selector);return el?String('value' in el?el.value:text(el)):'';};
    try{
      out.sourceTime=value(p.sourceTimeSelector);out.observedName=value(p.filterNameSelector);out.observedCode=value(p.filterCodeSelector);
      if(p.filterNameSelector&&!document.querySelector(p.filterNameSelector))out.warnings.push('FILTER_NAME_BINDING_MISSING');
      if(p.filterCodeSelector&&!document.querySelector(p.filterCodeSelector))out.warnings.push('FILTER_CODE_BINDING_MISSING');
      const headerRoot=root.closest('table,[role="grid"],.ag-root')||root.parentElement;
      const headerEls=p.headerSelector?[...document.querySelectorAll(p.headerSelector)]:[...headerRoot.querySelectorAll('thead th,[role="columnheader"]')];
      out.headers=p.headerSelector?headerEls.map(text):A.headerTexts(headerRoot);
      const rawRows=[...root.querySelectorAll(p.rowSelector||':scope > *')].filter(r=>shown(r)&&!r.hasAttribute('data-borsa-ui'));
      const seen=new Set();let duplicates=0,skipped=0;
      for(const [index,row] of rawRows.entries()){
        if(row.matches('thead tr')||row.querySelector('[role="columnheader"],th'))continue;
        const cells=A.cells(row,p);
        if(cells.length<2) {skipped++;continue;}
        const strings=cells.map(text),symbol=strings[Number(p.symbolColumn)||0];
        if(!symbol||/^(نماد|symbol|جمع|total)$/i.test(C.normal(symbol))||!/[\u0600-\u06ffA-Za-z]/.test(symbol)){skipped++;continue;}
        let insCode='',identitySource='symbol';
        for(const attr of ['data-inscode','data-ins-code','data-instrument-id','inscode']){const v=row.getAttribute(attr);if(v&&/^\d{5,22}$/.test(C.digits(v)))insCode=C.digits(v);}
        if(insCode)identitySource='attribute';
        if(!insCode&&p.identityColumn!==null&&p.identityColumn!==undefined&&/^\d{5,22}$/.test(C.digits(strings[p.identityColumn]||''))){insCode=C.digits(strings[p.identityColumn]);identitySource='selected_column';}
        if(!insCode)for(const link of row.querySelectorAll('a[href]')){
          const href=link.getAttribute('href');let url;try{url=new URL(href,location.href);}catch{continue;}
          if(!['http:','https:'].includes(url.protocol)||!(url.hostname==='tsetmc.com'||url.hostname.endsWith('.tsetmc.com')))continue;
          const match=(url.searchParams.get('i')||'').match(/^\d{5,22}$/)||url.pathname.match(/\/(?:instInfo|instrument)\/(\d{5,22})(?:\/|$)/i);
          if(match){insCode=match[1]||match[0];identitySource='instrument_link';break;}
        }
        if(!insCode&&p.rowIdIsInsCode===true&&/^\d{5,22}$/.test(row.id)){insCode=row.id;identitySource='selected_row_id';}
        const key=insCode?`ins:${insCode}`:`sym:${C.normal(symbol)}`;
        if(seen.has(key)){duplicates++;out.rejectedRows.push({key,symbol,insCode,rank:index+1,cells:strings});continue;}seen.add(key);
        const record={key,symbol,insCode,identitySource,rank:out.rows.length+1,domRank:index+1,cells:strings};
        if(cfg.captureTitles)record.titles=cells.map(e=>e.getAttribute('title')||'');
        if(cfg.captureColors)record.colors=cells.map(e=>getComputedStyle(e).color);
        out.rows.push(record);
      }
      if(!out.headers.length){
        const heading=rawRows.find(r=>r.querySelector('th')||/نماد/.test(text(r))&&A.cells(r,p).some(c=>C.normal(text(c))==='نماد'));
        out.headers=heading?A.cells(heading,p).map(text):[];
      }
      const max=Math.max(out.headers.length,...out.rows.map(r=>r.cells.length),0);
      out.headers=Array.from({length:max},(_,i)=>out.headers[i]||`ستون ${i+1}`);
      if(!headerEls.length)out.warnings.push('HEADERS_INFERRED_OR_GENERIC');
      if(out.rows.some(r=>!r.insCode))out.warnings.push('SYMBOL_ID_FALLBACK');
      if(skipped)out.warnings.push(`SKIPPED_NONDATA_ROWS:${skipped}`);
      const grid=root.closest('[aria-rowcount],[role="grid"],.ag-root-wrapper');
      const n=grid?.getAttribute('aria-rowcount')||grid?.querySelector('[aria-rowcount]')?.getAttribute('aria-rowcount');
      if(n&&Number(n)>0)out.totalRows=Number(n)-(grid?.querySelector('[role="columnheader"]')?1:0);
      out.coverage=p.coverage||'unverified_dom';
      const virtual=!!root.closest('.ag-center-cols-container,.ReactVirtualized__Grid,[data-virtualized="true"]')||!!root.querySelector('[data-index][style*="translate"]');
      if(virtual)out.warnings.push('VIRTUALIZED_DOM');
      if(duplicates){out.status='identity_collision';out.warnings.push(`DUPLICATE_IDENTITIES:${duplicates}`);}
      else if(out.totalRows!==null&&out.totalRows>out.rows.length || virtual)out.status='partial';
      else if(!out.rows.length)out.status=(p.emptySelector&&document.querySelector(p.emptySelector))||cfg.trustEmpty?'empty':'empty_unverified';
      else out.status='ok';
      if(out.coverage!=='complete_verified')out.warnings.push('DOM_COVERAGE_UNVERIFIED');
      if(!p.sourceTimeSelector)out.warnings.push('SOURCE_FRESHNESS_UNVERIFIED');
      if(!p.filterNameSelector&&!p.filterCodeSelector)out.warnings.push('FILTER_IDENTITY_MANUAL');
      if(p.sourceTimeSelector&&!out.sourceTime)out.warnings.push('SOURCE_CLOCK_MISSING');
      if(out.warnings.includes('FILTER_NAME_BINDING_MISSING')||out.warnings.includes('FILTER_CODE_BINDING_MISSING'))out.status='filter_identity_unverified';
    }catch(e){out.status='selector_error';out.warnings.push(e.message);}
    if(!navigator.onLine){out.status='offline';out.warnings.push('BROWSER_OFFLINE');}
    return out;
  };
  A.diagnostic=(profile,cfg)=>{
    const d=A.discover(),sample=profile?A.read(profile,cfg):null;
    return {format:'borsa-diagnostic-v1',at:new Date().toISOString(),url:location.origin+location.pathname,title:document.title,
      userAgent:navigator.userAgent,online:navigator.onLine,visibility:document.visibilityState,profile,candidates:d.candidates,ambiguous:d.ambiguous,
      observation:sample?{...sample,rows:sample.rows.slice(0,10),observedCode:sample.observedCode?'[code bound; not included]':''}:null,
      resources:performance.getEntriesByType('resource').slice(-60).map(r=>{let path='';try{const u=new URL(r.name);path=u.origin+u.pathname;}catch{}return {path,type:r.initiatorType,durationMs:Math.round(r.duration),responseStatus:r.responseStatus??null};}),
      limits:['No cookies, authorization headers, response bodies or page storage copied.','Only rendered DOM rows are observed.','Candidate rows are capped at eight; chosen-table diagnostic at ten.']};
  };
  globalThis.BorsaAdapter=A;
})();
