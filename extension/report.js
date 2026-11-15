import './core.js';
import {workbook} from './xlsx.js';
const C=globalThis.BorsaCore;
const label=s=>s.observedName?`${s.label} / ${s.observedName}`:s.label;
const time=at=>at===null||at===undefined?'':C.time(at).local;
const js=x=>JSON.stringify(x??null);
const quality=s=>['ok','empty'].includes(s)?s:{value:s,style:4};
export function buildReport(data,options={}){
  const mode=options.mode||'both',view=options.view||'changes';
  const from=options.fromAt===null||options.fromAt===undefined?-Infinity:Number(options.fromAt),to=options.toAt===null||options.toAt===undefined?Infinity:Number(options.toAt);
  if(Number.isNaN(from)||Number.isNaN(to)||from>to)throw Error('بازهٔ زمانی نامعتبر است.');
  const inRange=f=>f.at>=from&&f.at<=to;
  const extent=times=>times.reduce(([min,max],v)=>[Math.min(min,v),Math.max(max,v)],[Infinity,-Infinity]);
  const frames=(mode==='static'?[]:data.frames||[]).sort((a,b)=>a.at-b.at||a.receivedAt-b.receivedAt||a.id.localeCompare(b.id));
  const snaps=(data.snapshots||[]).filter(s=>inRange(s)&&(!options.snapshotIds||options.snapshotIds.includes(s.id))).sort((a,b)=>a.at-b.at);
  if(frames.length>250000)throw Error('بیش از ۲۵۰ هزار فریم در انتخاب؛ تعداد نشست‌های خروجی Excel را کم کن یا آرشیو JSON بگیر.');
  const sessions=data.sessions.filter(s=>(mode!=='static'&&frames.some(f=>f.sessionId===s.id&&inRange(f)))||(mode!=='dynamic'&&snaps.some(f=>f.sessionId===s.id)));
  if(!sessions.length)throw Error('برای حالت و بازهٔ انتخابی داده‌ای ثبت نشده است.');
  const sessionMap=Object.fromEntries(sessions.map(s=>[s.id,s])),columns=[],colMap=new Map();
  const addColumns=headers=>headers.forEach((h,i)=>{const k=`${i+1} | ${h}`;if(!colMap.has(k)){colMap.set(k,columns.length);columns.push(k);}});
  if(mode!=='static')frames.filter(inRange).forEach(f=>addColumns(f.headers));
  if(mode!=='dynamic')snaps.forEach(s=>addColumns(s.headers));
  if(columns.length>3000)throw Error('تنوع ساختار زیاد است؛ نشست‌ها را جدا یا به صورت JSON خروجی بگیر.');
  const baseHeaders=['فیلتر','تاریخ شمسی','زمان تهران','UTC','Epoch ms','Session ID','شناسه ثبت','نماد','InsCode (متن)','هویت نماد','رتبه روی صفحه','نوع فریم','کیفیت','هش ساختار','زمان منبع'];
  const makeRow=(s,f,r,kind)=>{
    const values=Array(columns.length).fill('');
    r.cells.forEach((raw,i)=>{const ix=colMap.get(`${i+1} | ${f.headers[i]||`ستون ${i+1}`}`);if(ix===undefined)return;const n=C.numeric(raw);values[ix]=n.value===null?raw:n.unit==='%'?{value:n.value,style:5}:n.value;});
    const t=C.time(f.at);
    return [label(s),t.jalali,t.local,t.utc,f.at,s.id,f.id,r.symbol,String(r.insCode||''),r.key,r.rank,kind,quality(f.status),C.hash(js(f.headers)),f.sourceTime||'',...values,js(r.cells),js(f.headers),js(r.titles||[]),js(r.colors||[])];
  };
  const staticRows=[],dynamicRows=[],frameRows=[],qualityRows=[],summaryRows=[],symbolRows=[];
  let total=0;
  const push=(rows,row)=>{if(++total>200000)throw Error('بیش از ۲۰۰ هزار سطر؛ بازه/نشست را محدود کن یا خروجی تغییرات/JSON بگیر. هیچ داده‌ای حذف نشده است.');rows.push(row);};
  for(const s of sessions){
    const ownFrames=frames.filter(f=>f.sessionId===s.id),ownSnaps=snaps.filter(f=>f.sessionId===s.id),observed=ownFrames.filter(inRange);
    let replay={},stats=null,seeded=false;const rawInventory=new Map();
    for(const f of ownFrames){
      replay=C.replay(replay,f);const rows=f.payload.kind==='late'?f.payload.upsert:Object.values(replay);
      if(!inRange(f)||mode==='static')continue;
      for(const row of rows){const old=rawInventory.get(row.key);rawInventory.set(row.key,{...row,firstAt:old?.firstAt??f.at,lastAt:f.at});}
      if(f.segmentBoundary&&stats)stats.gapOpen=true;
      if(f.payload.kind!=='late')stats=C.step(stats,{...f,rows},s.config).state;
      const boundary=!seeded&&f.payload.kind==='delta';
      const kind=boundary?'range_keyframe':f.payload.kind,upsert=boundary?rows:f.payload.upsert,removed=boundary?[]:f.payload.removed;
      if(f.payload.kind!=='late')seeded=true;
      const shown={...f,status:f.payload.kind==='late'?'late':f.status};
      frameRows.push([label(s),C.time(f.at).jalali,time(f.at),f.receivedAt-f.at,s.id,f.id,f.docId,f.seq,kind,quality(shown.status),f.visibility,rows.length,upsert.length,removed.length,js(removed),js(f.payload.order),js(f.headers),f.sourceTime||'',js(f.warnings),time(f.receivedAt)]);
      for(const r of view==='full'?rows:upsert)push(dynamicRows,makeRow(s,shown,r,kind));
      if(!['ok','empty'].includes(f.status)||f.warnings?.length)qualityRows.push([label(s),time(f.at),s.id,f.id,quality(f.status),f.coverage||'',js(f.warnings),f.sourceTime||'',js(f.rejectedRows||[])]);
    }
    if(mode!=='dynamic')for(const snap of ownSnaps){
      for(const r of C.sortRows(snap.rows))push(staticRows,makeRow(s,snap,r,'static'));
      if(!['ok','empty'].includes(snap.status)||snap.warnings?.length)qualityRows.push([label(s),time(snap.at),s.id,snap.id,quality(snap.status),snap.coverage||'',js(snap.warnings),snap.sourceTime||'',js(snap.rejectedRows||[])]);
    }
    for(const raw of C.sortRows([...rawInventory.values()])){
      const stat=stats?.stats[raw.key];
      symbolRows.push([label(s),s.jalali,s.id,raw.symbol,raw.insCode,raw.key,time(raw.firstAt),time(raw.lastAt),stat?.entries??'',stat?.exits??'',stat?.reappearances??'',stat?.confirmedEntries??'',stat?Math.round(stat.observedSeconds*1000)/1000:'',stat?.uncertainTransitions??'',stat?(stats.members[raw.key]?.raw?'آخرین مشاهدهٔ سالم حاضر؛ پایان سانسورشده':'آخرین مشاهدهٔ سالم غایب'):'فقط در نمونهٔ نامطمئن مشاهده شده','فقط بازهٔ خروجی؛ شروع حضور ممکن است قبل از بازه باشد']);
    }
    if(!ownFrames.length){
      const inventory=new Map();for(const snap of ownSnaps)for(const r of snap.rows){const x=inventory.get(r.key);inventory.set(r.key,{...r,firstAt:x?.firstAt||snap.at,lastAt:snap.at});}
      for(const r of C.sortRows([...inventory.values()]))symbolRows.push([label(s),s.jalali,s.id,r.symbol,r.insCode,r.key,time(r.firstAt),time(r.lastAt),'','','','','','','فقط عکس داده','مدت حضور از عکس محاسبه نمی‌شود']);
    }
    const times=[...observed,...ownSnaps].map(f=>f.at);
    const [begin,end]=extent(times);
    const cadence=observed.slice(1).map((f,i)=>f.docId===observed[i].docId?f.at-observed[i].at:null).filter(v=>v!==null&&v>=0).sort((a,b)=>a-b);
    const q=p=>cadence.length?cadence[Math.min(cadence.length-1,Math.floor((cadence.length-1)*p))]:'';
    const bad=observed.filter(f=>!['ok','empty'].includes(f.status)).length;
    summaryRows.push([label(s),s.jalali,s.day,s.declaredVersion,s.id,s.captureId,s.filterFingerprint,s.codeHash||'وارد نشده',s.observedCodeHash||'متصل نشده',time(begin),time(end),observed.length,ownSnaps.length,bad,s.config.intervalMs,s.config.stableMs,s.config.minConfirmations,s.url,q(.5),q(.95),cadence.at(-1)??'',observed.length?{value:bad/observed.length,style:5}:'']);
  }
  const sheets=[];
  const add=(name,headers,rows,note)=>{for(let i=0;i<Math.max(1,rows.length);i+=50000)sheets.push({name:i?`${name}_${Math.floor(i/50000)+1}`:name,title:`بورسا | ${name}`,headers,rows:rows.slice(i,i+50000),note});};
  add('خلاصه',['فیلتر','روز شمسی','روز میلادی تهران','نسخه اعلامی','Session ID','Capture ID','اثر انگشت SHA256','هش کد اعلامی','هش کد مشاهده‌شده','اولین زمان بازه','آخرین زمان بازه','فریم در بازه','عکس در بازه','فریم نامطمئن','دوره درخواستی ms','پایداری ms','حداقل تأیید','صفحه','میانه فاصله واقعی ms','صدک ۹۵ فاصله ms','بیشینه فاصله ms','سهم فریم نامطمئن'],summaryRows,'ثبت محلیِ مشاهدات دیده‌بان؛ زمان اولین حضور، الزاماً زمان شروع واقعی سیگنال نیست.');
  add('نمادها',['فیلتر','روز شمسی','Session ID','نماد','InsCode','هویت','اولین مشاهدهٔ خام در بازه','آخرین مشاهدهٔ خام در بازه','نوبت حضور سالم شامل شروع','غیبت مشاهده‌شده','بازگشت','حضور تأییدشده','ثانیه حضور تخمینی در بازه','تغییر میان وقفه','آخرین وضعیت','دامنه آمار'],symbolRows,'آمار فقط در بازهٔ انتخابی محاسبه می‌شود؛ حضور در اولین نمونه، ورود تازه به فیلتر محسوب نمی‌شود.');
  const rowHeaders=[...baseHeaders,...columns,'متن خام سلول‌ها JSON','عناوین اصلی JSON','Tooltip JSON','رنگ‌ها JSON'];
  if(mode!=='dynamic')add('استاتیک',rowHeaders,staticRows,'در هر عکس داده، نمادها الفبایی هستند و رتبهٔ اصلی روی صفحه جدا حفظ شده است.');
  if(mode!=='static'){
    add('مشاهدات',rowHeaders,dynamicRows,view==='full'?'تمام سطرهای هر فریمِ ضبط‌شده؛ تغییرات بین دو نمونه قابل بازسازی نیست.':'سطرهای تغییرکرده و کلیدفریم‌ها؛ حذف‌ها و ترتیب کامل در فریم‌ها ثبت شده‌اند.');
    add('فریم‌ها',['فیلتر','روز شمسی','زمان تهران','تأخیر دریافت ms','Session ID','Frame ID','Document ID','Sequence','نوع','کیفیت','وضعیت تب','سطرهای مشاهده','Upsert','Removed','کلیدهای حذف‌شده JSON','ترتیب کلیدها JSON','عناوین JSON','زمان منبع','هشدارها JSON','زمان دریافت'],frameRows,'keyframe و range_keyframe جایگزین وضعیت؛ delta اعمال تغییر؛ late فقط شاهد دیررس. range_keyframe شروع قابل‌بازسازیِ بازهٔ خروجی است.');
  }
  const events=[...(data.events||[]).filter(e=>sessionMap[e.sessionId]),...(data.systemEvents||[]).filter(e=>sessions.some(s=>s.captureId===e.captureId&&s.day===C.time(e.at).day))].filter(inRange).sort((a,b)=>a.at-b.at);
  add('رویدادها',['فیلتر','زمان تهران','Session ID','نوع','کلید نماد','Frame ID','جزئیات JSON'],events.map(e=>[sessionMap[e.sessionId]?label(sessionMap[e.sessionId]):e.captureLabel||e.captureId||'',time(e.at),e.sessionId,e.type,e.key,e.frameId||'',js(e.detail)]),'ENTER_OBSERVED خام؛ PRESENT_CONFIRMED پس از پایداری؛ CHANGE_ACROSS_GAP زمان دقیق خروج/ورود را ادعا نمی‌کند.');
  add('کیفیت',['فیلتر','زمان تهران','Session ID','شناسه ثبت','وضعیت','پوشش','هشدارها','زمان منبع','سطرهای برخورد هویت JSON'],qualityRows,'بدون اتصال ساعت منبع، تازگی داده اثبات نشده است. جدول ناقص/مجازی، قطع ارتباط و غیبت واقعی نماد را یکی ندان.');
  add('تعاریف',['موضوع','تعریف'],[
    ['نسخه','BORSA Recorder 2.0.0 — داده محلی، بدون ارسال اینترنتی'],
    ['استاتیک','نمادها داخل هر Snapshot ID الفبایی هستند؛ زمان و رتبهٔ اصلی مستقل‌اند.'],
    ['داینامیک','MutationObserver + نمونه‌برداری دوره‌ای؛ فاصلهٔ واقعی را از فریم‌ها بخوان. مرورگر تضمین زمان‌بندی بلادرنگ نمی‌دهد.'],
    ['هویت فیلتر','نام/نسخه/هش کد اعلامی و انتخابگر نام/کد در صورت اتصال. تغییر پنهان فیلتر بدون این اتصال قابل تشخیص تضمینی نیست.'],
    ['هویت نماد','InsCode به صورت متن؛ در نبود آن نماد نرمال‌شده با هشدار. برخورد هویت، فریم را نامطمئن می‌کند.'],
    ['مدت حضور','تخمین با فرض ثبات بین نمونه‌های سالم؛ وقفه، رفرش و تغییر ساختار مستثنی. معیار پیوستگی واقعی تیک‌به‌تیک نیست.'],
    ['سانسور','حضور در اولین نمونه ممکن است زودتر شروع شده باشد؛ حضور در آخرین نمونه زمان پایان واقعی ندارد.'],
    ['جدول مجازی','فقط DOM بارگذاری‌شده ضبط می‌شود؛ نمایش همه/قالب غیرمجازی را انتخاب و سپس پوشش را راستی‌آزمایی کن.'],
    ['اعداد','متن خام حفظ می‌شود؛ فقط قالب صریح عدد، هزارگان، درصد و K/M/B تبدیل می‌شود. واحد قیمت حدس زده نمی‌شود؛ شناسه طولانی متن است.'],
    ['زمان','UTC و Epoch مرجع مطلق؛ ساعت و تقویم شمسی/میلادی بر اساس Asia/Tehran. زمان منبع جدا و نیازمند انتخابگر.'],
    ['حافظه','سابقه ضبط در پایگاه افزونه مستقل است؛ بازیابی حافظه داخلی فیلتر فقط برای مسیرهای window سازگار با JSON و با تنظیم صریح.'],
    ['پشتیبان','XLSX گزارش است؛ JSON آرشیو کامل مشاهده‌ها، تنظیمات و رویدادها برای ادغام/بازیابی است.'],
    ['حجم','هر برگه تا ۵۰ هزار ردیف؛ هر گزارش تا ۲۰۰ هزار ردیف داده. عبور باعث خطای آشکار می‌شود؛ دادهٔ ذخیره‌شده حذف نمی‌شود.'],
    ['امنیت Excel','OOXML واقعی، بدون ماکرو یا فرمول. متن آغازشده با = به صورت متن ذخیره می‌شود.'],
    ['بازه خروجی',`${Number.isFinite(from)?time(from):'ابتدا'} تا ${Number.isFinite(to)?time(to):'انتها'}`],['زمان ساخت',time(Date.now())]
  ],'کیفیت ضبط و قطع داده را همراه با زمان حضور و غیبت تحلیل کن.');
  const dates=sessions.map(s=>s.jalali).sort(),names=[...new Set(sessions.map(label))],times=[...frames.filter(f=>sessionMap[f.sessionId]&&inRange(f)),...snaps.filter(f=>sessionMap[f.sessionId])].map(f=>f.at);
  const stamp=at=>C.time(at).local.slice(11).replace(/[:.]/g,'');
  const [begin,end]=extent(times);
  const versions=C.safeName([...new Set(sessions.map(s=>s.declaredVersion))].join('+'),16);
  const filename=C.safeFilename(`BORSA_${mode.toUpperCase()}_${dates[0]}_${stamp(begin)}_to_${dates.at(-1)}_${stamp(end)}_${C.safeName(names.join('+'),52)}_v${versions}_h${C.hash(sessions.map(s=>s.filterFingerprint).join('|'))}_s${C.hash(sessions.map(s=>s.id).join('|'))}.xlsx`);
  return {blob:workbook(sheets,{title:'BORSA TSETMC capture'}),filename,sheets};
}
