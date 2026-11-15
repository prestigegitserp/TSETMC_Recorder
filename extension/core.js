/* Shared deterministic recording engine; no network, DOM or Chrome dependencies. */
(() => {
  'use strict';
  const C = {};
  C.version = '2.0.0';
  C.defaults = Object.freeze({
    intervalMs: 1000, debounceMs: 180, stableMs: 1500, minConfirmations: 2,
    maxGapMs: 6000, keyframeMs: 60000, heartbeatMs: 1000,
    refreshEnabled: false, staleMs: 120000, protectMemory: true,
    statePaths: [], restoreMemory: false, trustEmpty: false,
    eodEnabled: false, eodTime: '12:35', marketStart: '08:30', marketEnd: '15:30',
    captureTitles: true, captureColors: false, code: '', version: '1', profile: null
  });
  C.normal = s => String(s ?? '').normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200d\u200e\u200f\u0640]/g, '').replace(/\s+/g, ' ').trim();
  C.digits = s => String(s).replace(/[۰-۹٠-٩]/g, ch => String('۰۱۲۳۴۵۶۷۸۹'.includes(ch) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch) : '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
  C.hash = s => {let h = 2166136261; for (const x of String(s)) {h ^= x.codePointAt(0); h = Math.imul(h, 16777619);} return (h >>> 0).toString(16).padStart(8, '0');};
  C.sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
  C.uuid = () => crypto.randomUUID?.()||'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
  C.collator = new Intl.Collator('fa-IR', {numeric: true, sensitivity: 'base'});
  C.sortRows = rows => [...rows].sort((a,b) => C.collator.compare(C.normal(a.symbol), C.normal(b.symbol)) || a.key.localeCompare(b.key));
  C.parts = (at, calendar='gregory') => Object.fromEntries(new Intl.DateTimeFormat(`en-GB-u-ca-${calendar}-nu-latn`, {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p => [p.type,p.value]));
  C.time = at => {const p=C.parts(at), j=C.parts(at,'persian'); return {utc:new Date(at).toISOString(),day:`${p.year}-${p.month}-${p.day}`,jalali:`${j.year}-${j.month}-${j.day}`,local:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${String(new Date(at).getUTCMilliseconds()).padStart(3,'0')}`,clock:`${p.hour}:${p.minute}`,offset:'+03:30'};};
  C.fromLocal = value => {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))throw Error('تاریخ و ساعت نامعتبر است.');
    const [y,m,d,h,mi,se=0]=value.split(/[-T:]/).map(Number),wanted=Date.UTC(y,m-1,d,h,mi,se);let guess=wanted;
    for(let i=0;i<4;i++){const p=C.parts(guess);guess+=wanted-Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));}
    const p=C.parts(guess);if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`!==`${value.length===16?value+':00':value}`)throw Error('تاریخ یا ساعت محلی قابل تبدیل نیست.');return guess;
  };
  C.safeName = (s,max=72) => String(s).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,max) || 'بدون‌نام';
  C.safeFilename = (value,budget=230) => {
    const original=C.safeName(value,1000).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,''),enc=new TextEncoder();
    if(enc.encode(original).length<=budget)return original;
    const tail=original.slice(-38);let prefix='';
    for(const char of original.slice(0,-38)){if(enc.encode(prefix+char+tail).length>budget)break;prefix+=char;}
    return prefix+tail;
  };
  C.numeric = raw => {
    let s=C.digits(raw).trim().replace(/\u2212/g,'-');
    if (!s || s.length>80) return {value:null, unit:''};
    let unit='', factor=1;
    if (/[٪%]$/.test(s)) {unit='%'; factor=.01; s=s.slice(0,-1).trim();}
    else if (/[KMB]$/i.test(s)) {unit=s.slice(-1).toUpperCase(); factor={K:1e3,M:1e6,B:1e9}[unit];s=s.slice(0,-1).trim();}
    s=s.replace(/٬/g,',').replace(/٫/g,'.');
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s)) return {value:null,unit:''};
    const plain=s.replace(/,/g,'');
    if (plain.replace(/[^0-9]/g,'').length>15) return {value:null,unit:'text_precision'};
    const value=Number(plain)*factor;
    return Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER ? {value,unit} : {value:null,unit:'text_precision'};
  };
  C.settings = input => {
    const x={...C.defaults,...input};
    for(const [k,min,max] of [['intervalMs',100,60000],['debounceMs',50,1000],['stableMs',0,60000],['maxGapMs',1000,300000],['keyframeMs',1000,300000],['heartbeatMs',1000,60000],['minConfirmations',1,20],['staleMs',30000,1800000]]) {
      if(!Number.isFinite(Number(x[k]))) throw Error(`تنظیم نامعتبر: ${k}`);
      x[k]=Math.round(Math.min(max,Math.max(min,Number(x[k]))));
    }
    if (!Array.isArray(x.statePaths) || x.statePaths.length>12 || x.statePaths.some(p=>!C.validPath(p))) throw Error('مسیر حافظه نامعتبر است.');
    for (const k of ['eodTime','marketStart','marketEnd']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x[k])) throw Error(`ساعت نامعتبر: ${k}`);
    for(const k of ['refreshEnabled','protectMemory','restoreMemory','trustEmpty','eodEnabled','captureTitles','captureColors'])if(typeof x[k]!=='boolean')throw Error(`گزینهٔ ${k} باید true یا false باشد.`);
    for(const k of ['code','version']){if(typeof x[k]!=='string'&&typeof x[k]!=='number')throw Error(`تنظیم نامعتبر: ${k}`);x[k]=String(x[k]);}
    if(x.code.length>2000000)throw Error('متن کد بیش از ۲ میلیون نویسه است.');
    if(x.profile!==null){
      if(typeof x.profile!=='object'||Array.isArray(x.profile))throw Error('ساختار جدول باید شیء JSON یا null باشد.');
      x.profile={...x.profile};
      for(const k of ['rootSelector','rowSelector','cellSelector','headerSelector','filterNameSelector','filterCodeSelector','sourceTimeSelector','emptySelector'])if(x.profile[k]!==undefined&&(typeof x.profile[k]!=='string'||x.profile[k].length>4096))throw Error(`انتخابگر نامعتبر: ${k}`);
      for(const k of ['symbolColumn','identityColumn'])if(x.profile[k]!==undefined&&x.profile[k]!==null&&(!Number.isInteger(x.profile[k])||x.profile[k]<0||x.profile[k]>255))throw Error(`شمارهٔ ستون نامعتبر: ${k}`);
    }
    return x;
  };
  C.validPath = p => typeof p==='string' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(p) && !p.split('.').some(x=>['__proto__','constructor','prototype','document','location','localStorage','sessionStorage'].includes(x));
  C.validateFrame = f => {
    if(!f || !Number.isFinite(f.at) || !Number.isInteger(f.seq) || f.seq<1 || typeof f.docId!=='string' || f.docId.length>100 || !Array.isArray(f.rows) || f.rows.length>15000 || !Array.isArray(f.headers) || f.headers.length>256 || f.headers.some(h=>typeof h!=='string'||h.length>32767)) throw Error('ساختار فریم نامعتبر است.');
    const ids=new Set();
    for(const r of f.rows) {
      if(typeof r.key!=='string'||!/^ins:\d{5,22}$|^sym:.+/.test(r.key)||r.key.length>256||typeof r.symbol!=='string'||!r.symbol||!Array.isArray(r.cells)||r.cells.length>256||r.cells.some(c=>typeof c!=='string'||c.length>32767)) throw Error('ساختار سطر نامعتبر است.');
      if(ids.has(r.key)) throw Error('هویت تکراری نماد؛ فریم پذیرفته نشد.'); ids.add(r.key);
    }
    if(JSON.stringify(f).length>8*1024*1024) throw Error('حجم فریم بیش از ۸ مگابایت؛ انتخاب جدول را محدود کنید.');
    return true;
  };
  C.emptyState = () => ({rows:{}, members:{}, stats:{}, lastAt:null,lastGoodAt:null,lastDoc:null,lastSeq:0,lastQuality:null,lastKeyAt:0, headers:[],schema:'',gapOpen:false});
  C.step = (previous, f, options={}) => {
    C.validateFrame(f);
    const cfg=C.settings(options), s=structuredClone(previous||C.emptyState()), events=[];
    const emit=(type,key='',detail={})=>events.push({type,key,at:f.at,detail});
    const late=!!f.forcedLate||s.lastAt!==null&&(f.at<s.lastAt || (f.docId===s.lastDoc&&f.seq<=s.lastSeq));
    const schema=JSON.stringify(f.headers);
    const good=['ok','empty'].includes(f.status);
    const generation=s.lastDoc!==null&&s.lastDoc!==f.docId;
    const timedGap=s.lastAt!==null&&f.at-s.lastAt>Math.max(cfg.maxGapMs,cfg.intervalMs*4);
    const schemaChanged=s.schema!==''&&s.schema!==schema;
    const gap=generation||timedGap||s.gapOpen||schemaChanged||!!f.lossInterval;
    if(late) return {state:s,events:[{type:'LATE_FRAME',at:f.at,key:'',detail:{reason:'Stored without changing live state'}}],payload:{kind:'late',upsert:f.rows,removed:[],order:f.rows.map(r=>r.key)},usable:false};
    if(generation) emit('DOCUMENT_CHANGED','',{from:s.lastDoc,to:f.docId,filterMemory:'unverified',fromAt:s.lastAt,toAt:f.at});
    if(timedGap) emit('SAMPLING_GAP','',{fromAt:s.lastAt,toAt:f.at,seconds:(f.at-s.lastAt)/1000});
    if(f.lossInterval)emit('SAMPLING_BACKPRESSURE','',f.lossInterval);
    if(schemaChanged) emit('SCHEMA_CHANGED','',{before:s.headers,after:f.headers});
    if(f.status!==s.lastQuality) emit('QUALITY_CHANGED','',{before:s.lastQuality,after:f.status,warnings:f.warnings||[]});
    const rows=Object.fromEntries(f.rows.map(r=>[r.key,r]));
    const removed=Object.keys(s.rows).filter(k=>!rows[k]);
    const changed=f.rows.filter(r=>JSON.stringify(s.rows[r.key])!==JSON.stringify(r));
    const keyframe=s.lastAt===null||generation||schemaChanged||f.at-s.lastKeyAt>=cfg.keyframeMs;
    const payload={kind:keyframe?'keyframe':'delta',upsert:keyframe?f.rows:changed,removed:keyframe?[]:removed,order:f.rows.map(r=>r.key)};
    if(good) {
      if(s.gapOpen) emit('OBSERVATION_RESUMED','',{fromAt:s.lastGoodAt,toAt:f.at});
      for(const k of new Set([...Object.keys(s.members),...Object.keys(rows)])) {
        const present=!!rows[k]; let m=s.members[k];
        if(!m && !present) continue;
        const baseline=!m && s.lastGoodAt===null;
        if(!m) m=s.members[k]={raw:false,confirmed:false,count:0,since:f.at,baseline,uncertain:gap};
        const stat=s.stats[k] ||= {key:k,symbol:rows[k]?.symbol||k,insCode:rows[k]?.insCode||'',firstAt:null,lastAt:null,entries:0,exits:0,reappearances:0,confirmedEntries:0,observedSeconds:0,uncertainTransitions:0};
        if(present) {
          stat.symbol=rows[k].symbol; stat.insCode=rows[k].insCode||stat.insCode;
          stat.firstAt ??= f.at; stat.lastAt=f.at;
          if(m.raw && !gap && s.lastGoodAt!==null && s.lastQuality && ['ok','empty'].includes(s.lastQuality)) stat.observedSeconds+=(f.at-s.lastAt)/1000;
        }
        if(m.raw!==present || (!m.count&&present)) {
          const ever=stat.entries>0;
          m.raw=present; m.count=1;m.since=f.at;m.uncertain=gap;if(!present)m.baseline=false;
          if(present) {stat.entries++;if(ever)stat.reappearances++;}
          else stat.exits++;
          if(gap)stat.uncertainTransitions++;
          emit(baseline?'FIRST_OBSERVED':gap?'CHANGE_ACROSS_GAP':present?'ENTER_OBSERVED':'EXIT_OBSERVED',k,{present,fromAt:gap?s.lastGoodAt:f.at,toAt:f.at,leftCensored:baseline});
        } else {m.count++; if(gap){m.since=f.at;m.count=1;m.uncertain=true;}}
        if(m.confirmed!==m.raw && m.count>=cfg.minConfirmations && f.at-m.since>=cfg.stableMs) {
          m.confirmed=m.raw;
          if(m.raw)stat.confirmedEntries++;
          emit(m.raw?(m.baseline?'BASELINE_CONFIRMED':'PRESENT_CONFIRMED'):'ABSENT_CONFIRMED',k,{observedSince:m.since,confirmedAt:f.at,uncertain:m.uncertain});
          m.baseline=false;
        }
      }
      s.lastGoodAt=f.at;s.gapOpen=false;
    } else {
      if(!s.gapOpen)emit('OBSERVATION_UNCERTAIN','',{fromAt:s.lastGoodAt,toAt:f.at,status:f.status});
      s.gapOpen=true;
    }
    s.rows=rows;s.lastAt=f.at;s.lastDoc=f.docId;s.lastSeq=f.seq;s.lastQuality=f.status;s.headers=f.headers;s.schema=schema;
    if(keyframe)s.lastKeyAt=f.at;
    return {state:s,events,payload,usable:good};
  };
  C.replay = (state,frame) => {
    if(frame.payload.kind==='late')return state;
    const out=frame.payload.kind==='keyframe'?{}:{...state};
    for(const k of frame.payload.removed)delete out[k];
    for(const r of frame.payload.upsert)out[r.key]=r;
    return out;
  };
  globalThis.BorsaCore=C;
})();
