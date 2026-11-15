import {importArchive} from './db.js';
const C=globalThis.BorsaCore,$=s=>document.querySelector(s),drafts=new Map(),tabSelection=new Set(),sessionSelection=new Set();
let state={tabs:[],sessions:[],jobs:[],profiles:[]},initialWindow=new URL(location.href).searchParams.get('window'),messageTimer;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
async function call(type,data={}){const r=await chrome.runtime.sendMessage({channel:globalThis.BorsaProtocol.channel,type,...data});if(!r?.ok)throw Error(r?.error||'افزونه پاسخ نداد.');return r.result;}
function toast(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'';clearTimeout(messageTimer);messageTimer=setTimeout(()=>{$('#message').textContent='';},error?25000:9000);}
function getDraft(tab){
  if(tab.binding)return {...tab.binding.config,label:tab.binding.label};
  const cached=drafts.get(tab.id),base={...C.defaults,...tab.draft,label:tab.draft?.label||''};
  if(!cached)return base;
  return (tab.draft?.mappingRevision||0)>(cached.mappingRevision||0)?{...cached,profile:tab.draft.profile,mappingRevision:tab.draft.mappingRevision}:cached;
}
function remember(){for(const row of document.querySelectorAll('#tabRows tr[data-tab]')){const id=Number(row.dataset.tab),tab=state.tabs.find(t=>t.id===id);if(!tab)continue;drafts.set(id,{...getDraft(tab),label:row.querySelector('.labelInput').value,version:row.querySelector('.versionInput').value,intervalMs:Number(row.querySelector('.intervalInput').value)});}}
function visibleTabs(){const w=$('#windowFilter').value;return state.tabs.filter(t=>w==='all'||String(t.windowId)===w);}
function visibleSessions(){return state.sessions.filter(s=>(!$('#dayFrom').value||s.day>=$('#dayFrom').value)&&(!$('#dayTo').value||s.day<=$('#dayTo').value)).sort((a,b)=>b.startedAt-a.startedAt);}
function button(text,fn){const b=el('button',text);b.addEventListener('click',()=>fn().catch(e=>toast(e.message,true)));return b;}
function renderTabs(){
  const body=$('#tabRows');body.replaceChildren();
  for(const tab of visibleTabs()){
    const d=getDraft(tab),row=el('tr');row.dataset.tab=tab.id;
    const select=el('input');select.type='checkbox';select.checked=tabSelection.has(tab.id);select.addEventListener('change',()=>select.checked?tabSelection.add(tab.id):tabSelection.delete(tab.id));row.append(el('td'));row.lastChild.append(select);
    const name=el('td'),title=el('div',`تب ${tab.id} · پنجره ${tab.windowId}`,'subtitle'),input=el('input');input.className='labelInput';input.type='text';input.placeholder='نام واقعی فیلتر';input.value=d.label;input.disabled=!!tab.binding;name.append(title,input);
    if(!tab.binding&&state.profiles?.length){const saved=el('select');saved.add(new Option('استفاده از تنظیمات ذخیره‌شدهٔ روزهای قبل',''));for(const p of state.profiles)saved.add(new Option(`${p.label} · v${p.config.version} · ${new URL(p.scope).hostname}`,p.id));saved.onchange=()=>{remember();const p=state.profiles.find(p=>p.id===saved.value);if(p){drafts.set(tab.id,{...p.config,label:p.label,mappingRevision:Date.now()});renderTabs();}};name.append(saved);}
    name.append(el('div',tab.title,'subtitle'));row.append(name);
    const ver=el('input');ver.className='versionInput';ver.value=d.version;ver.size=5;ver.style.width='65px';ver.disabled=!!tab.binding;const vtd=el('td');vtd.append(ver);row.append(vtd);
    const interval=el('input');interval.className='intervalInput';interval.type='number';interval.min=100;interval.max=60000;interval.step=100;interval.value=d.intervalMs;interval.disabled=!!tab.binding;const itd=el('td');itd.append(interval);row.append(itd);
    const status=el('td');status.append(el('span',tab.binding?tab.binding.lastStatus:'متوقف',`tag ${tab.binding&&!['ok','empty'].includes(tab.binding.lastStatus)?'warn':''}`));
    if(tab.binding)status.append(el('div',`${tab.binding.lastRows??'—'} نماد · آخرین دریافت ${tab.binding.lastSeen?C.time(tab.binding.lastSeen).local.slice(11):'—'}`,'subtitle'));
    if(d.profile?.rootSelector)status.append(el('div','جدول مشخص شده','subtitle'));else status.append(el('div','جدول: تشخیص خودکار','subtitle'));
    row.append(status);
    const ops=el('td'),wrap=el('div',undefined,'rowTools');
    wrap.append(button('پیش‌نمایش',()=>preview(tab)),button('انتخاب F8',()=>call('PICK_TAB',{tabId:tab.id})),button('تنظیمات',async()=>settings(tab)),button('عکس + Excel',async()=>{remember();await saveDraft(tab);const r=await call('SNAPSHOT_TAB',{tabId:tab.id});await call('EXPORT',{options:{sessionIds:[r.sessionId],snapshotIds:[r.id],format:'xlsx',mode:'static',view:'changes'}});toast(`${r.rows} نماد؛ کیفیت ${r.status}؛ عکس داده ذخیره و ساخت Excel شروع شد.`);await refresh();}),button('شناسایی',async()=>{const result=await call('DIAG_TAB',{tabId:tab.id});downloadJSON(result,`BORSA_DIAGNOSTIC_tab${tab.id}_${C.time(Date.now()).jalali}.json`);toast('گزارش شناسایی شامل ساختار جدول و نمونهٔ محدود داده ذخیره شد.');}));
    if(tab.binding)wrap.append(button('رفرش کنترل‌شده',async()=>{await call('REFRESH_TAB',{tabId:tab.id});toast('درخواست رفرش ثبت شد.');}));
    ops.append(wrap);row.append(ops);body.append(row);
  }
  if(!body.children.length){const row=el('tr'),cell=el('td','هیچ تب TSETMC در این پنجره پیدا نشد. دیده‌بان را باز کن و بازخوانی بزن.');cell.colSpan=6;row.append(cell);body.append(row);}
}
function renderSessions(){
  const body=$('#sessionRows');body.replaceChildren();
  for(const s of visibleSessions()){
    const row=el('tr'),c=el('input');c.type='checkbox';c.checked=sessionSelection.has(s.id);c.addEventListener('change',()=>c.checked?sessionSelection.add(s.id):sessionSelection.delete(s.id));const td=el('td');td.append(c);row.append(td);
    const name=el('td');name.append(el('b',s.observedName?`${s.label} / ${s.observedName}`:s.label),el('div',`${s.jalali} | ${s.day}`,'subtitle'));row.append(name,el('td',`${C.time(s.startedAt).local.slice(11)} — ${C.time(s.endedAt).local.slice(11)}`),el('td',`${s.frames} فریم / ${s.snapshots} عکس`),el('td',`${s.declaredVersion} · ${s.filterFingerprint?.slice(0,12)}`));body.append(row);
  }
}
function renderJobs(){
  const out=$('#jobs');out.replaceChildren();
  const names={queued:'در صف',building:'در حال ساخت',downloading:'در حال ذخیره فایل',complete:'ذخیره شد',error:'خطا'};
  state.jobs.slice(0,8).forEach(j=>out.append(el('div',`${C.time(j.at).local} · ${names[j.status]||j.status} · ${j.error||j.filename||j.options.format}`,'job')));
}
async function refresh(){
  remember();state=await call('LIST');
  const filter=$('#windowFilter'),old=filter.value,ws=[...new Set(state.tabs.map(t=>t.windowId))];filter.replaceChildren(new Option('همهٔ پنجره‌ها','all'));ws.forEach(w=>filter.add(new Option(`پنجره ${w}`,String(w))));
  if(initialWindow&&ws.includes(Number(initialWindow))){filter.value=initialWindow;initialWindow=null;}else filter.value=ws.includes(Number(old))?old:'all';
  renderTabs();renderSessions();renderJobs();
  $('#activeCount').textContent=String(state.tabs.filter(t=>t.binding).length);$('#sessionCount').textContent=String(state.sessions.length);
  const estimate=await navigator.storage.estimate();$('#spaceCount').textContent=`${((estimate.usage||0)/1048576).toFixed(1)} MB`;
  const items=await chrome.storage.local.get(null);$('#pendingCount').textContent=String(Object.keys(items).filter(k=>k.startsWith('pending.')).length);
}
async function saveDraft(tab){if(tab.binding)return;const d=getDraft(tab);await call('SAVE_DRAFT',{tabId:tab.id,label:d.label,config:d});}
function modal(title){$('#modalTitle').textContent=title;$('#modalBody').replaceChildren();$('#modal').showModal();return $('#modalBody');}
async function preview(tab){
  remember();const d=getDraft(tab),p=await call('PROBE_TAB',{tabId:tab.id,profile:d.profile,config:d}),body=modal(`پیش‌نمایش تب ${tab.id}`);
  let choices=d.profile?[{profile:d.profile,...p.current,sample:p.current.rows.slice(0,8),count:p.current.rows.length}]:p.discovery.candidates;
  if(!choices.length){body.append(el('p','جدول تشخیص داده نشد. «انتخاب F8» را بزن و روی خانهٔ نماد یک سطر کلیک کن.','warnText'));return;}
  if(p.discovery.ambiguous&&!d.profile)body.append(el('p','چند جدول مشابه پیدا شده است؛ جدول صحیح را از نمونه‌ها انتخاب کن.','warnText'));
  for(const [index,x] of choices.entries()){
    body.append(el('h3',`جدول ${index+1} · ${x.count} سطر · ${x.status||'کاندیدا'}`),el('p',(x.warnings||[]).join(' | '),'warnText'));
    const wrap=el('div',undefined,'tableWrap preview'),table=el('table'),head=el('tr');x.headers.forEach(h=>head.append(el('th',h)));table.append(head);
    for(const r of x.sample){const row=el('tr');r.cells.forEach(c=>row.append(el('td',c)));table.append(row);}wrap.append(table);body.append(wrap);
    if(!tab.binding)body.append(button('انتخاب همین جدول و ذخیره',async()=>{drafts.set(tab.id,{...d,profile:x.profile});await saveDraft(tab);$('#modal').close();toast('ساختار جدول ذخیره شد.');await refresh();}));
    body.append(el('pre',JSON.stringify(x.profile,null,2)));
  }
}
function settings(tab){
  remember();const d=C.settings(getDraft(tab)),body=modal(`تنظیمات فیلتر · تب ${tab.id}`),grid=el('div',undefined,'configGrid'),controls={};
  const field=(key,title,type='text',value=d[key])=>{const label=el('label',title),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value??'';input.disabled=!!tab.binding;label.append(input);grid.append(label);controls[key]=input;return input;};
  const check=(key,title)=>{const label=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=!!d[key];input.disabled=!!tab.binding;label.append(input,el('span',title));grid.append(label);controls[key]=input;};
  field('label','نام فیلتر','text',getDraft(tab).label);field('version','نسخهٔ کد فیلتر');field('intervalMs','دورهٔ نمونه‌برداری، میلی‌ثانیه','number');field('stableMs','زمان پایداری برای تأیید، میلی‌ثانیه','number');field('minConfirmations','حداقل نمونهٔ تأیید','number');field('maxGapMs','مرز وقفهٔ ثبت، میلی‌ثانیه','number');
  field('eodTime','ساعت عکس خودکار به وقت تهران','time');check('eodEnabled','عکس و خروجی استاتیک خودکار حین ضبط');
  field('marketStart','آغاز بازهٔ رصد و رفرش','time');field('marketEnd','پایان بازهٔ رصد و رفرش','time');field('staleMs','توقف ساعت منبع تا مشکوک‌شدن، ms','number');
  check('refreshEnabled','رفرش خودکار فقط در توقف ساعت منبعِ متصل');check('protectMemory','حفاظت از حافظه: رفرش بدون پشتیبان معتبر متوقف شود');check('restoreMemory','اجازهٔ بازیابی مسیرهای حافظهٔ انتخاب‌شده');check('trustEmpty','جدول خالی پایدار را خروجی معتبر فرض کن (نیازمند اطمینان از ساختار)');check('captureTitles','ثبت Tooltip سلول‌ها');check('captureColors','ثبت رنگ متن سلول‌ها (هزینهٔ پردازشی بیشتر)');
  const statePaths=field('statePaths','مسیرهای حافظه در window؛ با ویرگول جدا کن','text',d.statePaths.join(', '));statePaths.parentElement.className='wide';
  const code=field('code','اختیاری: متن کامل کد برای SHA256 و ثبت نسخهٔ دقیق','textarea');code.parentElement.className='wide';
  const profile=field('profile','ساختار جدول JSON؛ در حالت تشخیص خودکار null بگذار','textarea',JSON.stringify(d.profile,null,2));profile.parentElement.className='wide';profile.style.minHeight='230px';
  body.append(grid,el('p','حافظه فقط متغیرهای عمومی window و JSON ساده را پشتیبانی می‌کند. بازیابی، مصرف‌شدن حافظه توسط فیلتر را تضمین نمی‌کند. نام/کد/ساعت منبع را می‌توان با filterNameSelector، filterCodeSelector و sourceTimeSelector در ساختار جدول متصل کرد.','warnText'));
  if(tab.binding)body.append(el('p','برای تغییر تنظیمات، ابتدا ضبط این تب را متوقف کن. تاریخچه باقی می‌ماند.','warnText'));
  else body.append(button('ذخیرهٔ تنظیمات',async()=>{
    const result={...d};for(const [key,input] of Object.entries(controls)){result[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;}
    result.statePaths=result.statePaths.split(',').map(x=>x.trim()).filter(Boolean);result.profile=JSON.parse(result.profile);const checked=C.settings(result);drafts.set(tab.id,checked);await saveDraft(tab);$('#modal').close();toast('تنظیمات ذخیره شد.');await refresh();
  }));
  if(tab.binding)body.append(button('پشتیبان حافظه همین لحظه',async()=>{const r=await call('CHECKPOINT_TAB',{tabId:tab.id});toast(r.ok?'پشتیبان حافظه ذخیره شد.':`پشتیبان ناموفق: ${r.error}`,!r.ok);}));
}
async function bulk(type){
  remember();const selected=visibleTabs().filter(t=>tabSelection.has(t.id));if(!selected.length)throw Error('حداقل یک تب را انتخاب کن.');
  const results=await Promise.allSettled(selected.map(async tab=>{
    const d=getDraft(tab);if(type!=='STOP_TAB')await saveDraft(tab);
    if(type==='START_TAB'&&tab.binding)return 'از قبل فعال';
    return call(type,{tabId:tab.id,label:d.label,config:d});
  }));
  const failed=results.flatMap((r,i)=>r.status==='rejected'?[`تب ${selected[i].id}: ${r.reason.message}`]:[]);
  for(const [i,r]of results.entries())if(r.status==='fulfilled'&&r.value?.warning)failed.push(`تب ${selected[i].id}: ${r.value.warning}`);
  if(type==='SNAPSHOT_TAB'){
    const shots=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    if(shots.length)await call('EXPORT',{options:{sessionIds:[...new Set(shots.map(s=>s.sessionId))],snapshotIds:shots.map(s=>s.id),format:'xlsx',mode:'static',view:'changes'}});
  }
  toast(`${results.length-failed.length} تب انجام شد.${failed.length?'\n'+failed.join('\n'):''}`,!!failed.length);await refresh();
}
function downloadJSON(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function exportSelected(format){
  const sessionIds=visibleSessions().filter(s=>sessionSelection.has(s.id)).map(s=>s.id);if(!sessionIds.length)throw Error('حداقل یک نشست از بازهٔ نمایش‌داده‌شده را انتخاب کن.');
  const fromAt=$('#timeFrom').value?C.fromLocal($('#timeFrom').value):null,toAt=$('#timeTo').value?C.fromLocal($('#timeTo').value)+999:null;
  if(fromAt&&toAt&&fromAt>toAt)throw Error('ابتدای بازه بعد از انتهای آن است.');
  await call('EXPORT',{options:{sessionIds,format,mode:$('#exportMode').value,view:$('#exportView').value,fromAt,toAt}});toast('ساخت فایل شروع شد؛ نتیجه در فهرست خروجی‌ها نمایش داده می‌شود.');await refresh();
}
$('#reload').onclick=()=>refresh().catch(e=>toast(e.message,true));$('#windowFilter').onchange=()=>{remember();renderTabs();};
$('#selectTabs').onclick=()=>{visibleTabs().forEach(t=>tabSelection.add(t.id));remember();renderTabs();};
$('#selectSessions').onclick=()=>{visibleSessions().forEach(s=>sessionSelection.add(s.id));renderSessions();};
$('#startSelected').onclick=()=>bulk('START_TAB').catch(e=>toast(e.message,true));$('#stopSelected').onclick=()=>bulk('STOP_TAB').catch(e=>toast(e.message,true));$('#snapshotSelected').onclick=()=>bulk('SNAPSHOT_TAB').catch(e=>toast(e.message,true));
$('#dayFrom').onchange=renderSessions;$('#dayTo').onchange=renderSessions;$('#exportXlsx').onclick=()=>exportSelected('xlsx').catch(e=>toast(e.message,true));$('#exportJson').onclick=()=>exportSelected('json').catch(e=>toast(e.message,true));$('#closeModal').onclick=()=>$('#modal').close();
$('#importJson').onchange=async e=>{
  try{let count=0;for(const file of e.target.files){if(file.size>100*1024*1024)throw Error('هر فایل واردشده حداکثر ۱۰۰ مگابایت است.');count+=await importArchive(JSON.parse(await file.text()));}toast(`${count} رکورد جدید وارد شد؛ ضبط زنده یا حافظهٔ فیلتر از روی آرشیو فعال نمی‌شود.`);await refresh();}catch(error){toast(error.message,true);}finally{e.target.value='';}
};
setInterval(()=>{$('#clock').textContent=C.time(Date.now()).jalali+' · '+C.time(Date.now()).local.slice(11,19);},1000);
setInterval(()=>{if(!$('#modal').open&&!document.activeElement?.matches('input,textarea,select'))refresh().catch(e=>toast(e.message,true));},5000);
refresh().catch(e=>toast(e.message,true));
