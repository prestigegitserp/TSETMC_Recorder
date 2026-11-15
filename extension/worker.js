import './core.js';
import './protocol.js';
import * as DB from './db.js';
import {pageMemory} from './page-memory.js';
const C=globalThis.BorsaCore,P=globalThis.BorsaProtocol,chains=new Map();
let offscreenOpening;
const allowed=P.allowedSite;
const bkey=id=>`binding.${id}`,dkey=id=>`draft.${id}`;
async function binding(id){return (await chrome.storage.session.get(bkey(id)))[bkey(id)]||null;}
async function bindings(){return Object.values(await chrome.storage.session.get(null)).filter(x=>x&&x.captureId&&Number.isInteger(x.tabId));}
async function saveBinding(b){await chrome.storage.session.set({[bkey(b.tabId)]:b});}
async function patchBinding(tabId,fn){return serial(`binding:${tabId}`,async()=>{const b=await binding(tabId);if(!b)return null;const next=fn(b);if(next)await saveBinding(next);return next;});}
async function saveProfile(label,config,url){
  if(!label?.trim())return;
  const u=new URL(url),scope=u.origin+u.pathname,id=(await C.sha(JSON.stringify([label,config.version,config.code,scope]))).slice(0,32);
  await DB.put('profiles',{id,label,scope,config,updatedAt:Date.now()});
}
function serial(key,fn){const old=chains.get(key)||Promise.resolve();const next=old.catch(()=>{}).then(fn);chains.set(key,next);next.finally(()=>{if(chains.get(key)===next)chains.delete(key);}).catch(()=>{});return next;}
function timed(promise,label,ms=8000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const e=Error(`مهلت پاسخ صفحه تمام شد: ${label}`);e.code='PAGE_TIMEOUT';reject(e);},ms);})]).finally(()=>clearTimeout(timer));}
async function inject(tabId){const tab=await chrome.tabs.get(tabId);if(!allowed(tab.url))throw Error('این تب دیگر صفحهٔ TSETMC نیست.');await timed(chrome.scripting.executeScript({target:{tabId},files:['core.js','protocol.js','adapter.js','content.js']}),'تزریق اسکریپت');}
async function tabCall(tabId,message){
  const tab=await chrome.tabs.get(tabId);if(!allowed(tab.url))throw Error('تبِ انتخاب‌شده TSETMC نیست یا به صفحهٔ دیگری رفته است.');
  message={channel:P.channel,...message};
  let answer;
  try{answer=await timed(chrome.tabs.sendMessage(tabId,message),message.type);}catch(e){if(e.code==='PAGE_TIMEOUT')throw e;await inject(tabId);answer=await timed(chrome.tabs.sendMessage(tabId,message),message.type);}
  if(!answer?.ok)throw Error(answer?.error||'صفحه پاسخ نداد.');return answer.result;
}
async function event(captureId,type,detail={},sessionId=''){
  const at=Date.now();await DB.put('events',{id:C.uuid(),captureId,sessionId:sessionId||`system:${captureId}`,type,at,key:'',detail});
}
async function checkpoint(b,reason){
  if(!b.config.statePaths.length)return {ok:false,error:'NO_STATE_CONTRACT'};
  try{
    const [r]=await timed(chrome.scripting.executeScript({target:{tabId:b.tabId},world:'MAIN',func:pageMemory,args:['read',b.config.statePaths,null]}),'پشتیبان حافظه');
    if(!r?.result?.ok){await event(b.captureId,'CHECKPOINT_FAILED',{reason,result:r?.result});return {ok:false,error:'CHECKPOINT_FAILED'};}
    const saved={id:b.captureId,at:Date.now(),reason,paths:b.config.statePaths,values:r.result.values,filterHash:b.codeHash,scope:b.label};
    await DB.put('checkpoints',saved);return {ok:true,at:saved.at};
  }catch(e){await event(b.captureId,'CHECKPOINT_FAILED',{reason,error:e.message});return {ok:false,error:e.message};}
}
async function restore(b,docId){
  const cp=await DB.get('checkpoints',b.captureId);
  if(!cp||!b.config.restoreMemory)return;
  const age=Date.now()-cp.at;
  if(age>300000||cp.filterHash!==b.codeHash||C.time(cp.at).day!==C.time(Date.now()).day){await event(b.captureId,'RESTORE_SKIPPED',{reason:'age/day/hash mismatch',ageMs:age,docId});return;}
  const [r]=await timed(chrome.scripting.executeScript({target:{tabId:b.tabId},world:'MAIN',func:pageMemory,args:['write',b.config.statePaths,cp.values]}),'بازیابی حافظه');
  await event(b.captureId,r?.result?.ok?'RESTORE_ASSIGNED':'RESTORE_FAILED',{docId,checkpointAt:cp.at,ageMs:age,result:r?.result?.errors||[],limit:'Assignment does not prove filter initialization consumed it.'});
}
async function context(capture,f){
  const prior=capture.activeSessionId?await DB.get('sessions',capture.activeSessionId):null;
  const nameMissing=f.warnings?.includes('FILTER_NAME_BINDING_MISSING'),codeMissing=f.warnings?.includes('FILTER_CODE_BINDING_MISSING');
  const codeHash=codeMissing?(prior?.observedCodeHash||''):f.observedCode?await C.sha(f.observedCode):'',observedName=nameMissing?(prior?.observedName||''):C.normal(f.observedName||''),day=C.time(f.at).day;
  const fingerprint=await C.sha(JSON.stringify([capture.label,capture.config.version,capture.codeHash,observedName,codeHash]));
  const id=`${capture.id}:${day}:${fingerprint.slice(0,20)}`;
  let s=await DB.get('sessions',id);
  if(!s)s={id,captureId:capture.id,tabId:capture.tabId,windowId:capture.windowId,label:capture.label,observedName,declaredVersion:capture.config.version,codeHash:capture.codeHash,observedCodeHash:codeHash,filterFingerprint:fingerprint,day,jalali:C.time(f.at).jalali,startedAt:f.at,endedAt:f.at,version:C.version,url:f.url,config:capture.config,frames:0,snapshots:0};
  return s;
}
async function ingest(envelope){
  const f=envelope.frame;C.validateFrame(f);
  return serial(envelope.captureId,async()=>{
    const capture=await DB.get('captures',envelope.captureId);if(!capture)throw Error('شناسهٔ ضبط پیدا نشد؛ صف حذف نشد.');
    const frameId=`${capture.id}:${f.docId}:${f.seq}`;
    if(await DB.get('frames',frameId))return {duplicate:true};
    const session=await context(capture,f),previous=await DB.get('states',session.id);
    const globallyLate=capture.lastObservedAt!==undefined&&f.at<capture.lastObservedAt;
    const switched=!globallyLate&&capture.activeSessionId&&capture.activeSessionId!==session.id;
    if(switched&&previous)previous.gapOpen=true;
    const result=C.step(previous,{...f,forcedLate:globallyLate},capture.config);
    const frame={id:frameId,sessionId:session.id,at:f.at,receivedAt:Date.now(),docId:f.docId,seq:f.seq,headers:f.headers,status:f.status,warnings:f.warnings||[],coverage:f.coverage,sourceTime:f.sourceTime,sourceChangedAt:f.sourceChangedAt,visibility:f.visibility,url:f.url,reason:f.reason,mode:'dynamic',segmentBoundary:!!switched,rejectedRows:f.rejectedRows||[],lossInterval:f.lossInterval||null,payload:result.payload};
    session.endedAt=Math.max(session.endedAt,f.at);session.startedAt=Math.min(session.startedAt,f.at);session.frames++;
    if(switched)result.events.unshift({at:f.at,type:'FILTER_IDENTITY_SEGMENT',key:'',detail:{previousSession:capture.activeSessionId,newSession:session.id}});
    if(!globallyLate){capture.activeSessionId=session.id;capture.lastObservedAt=f.at;}
    await DB.commitFrame(session,frame,result.events,result.state,capture);
    // Durable acknowledgment happens after the entire IndexedDB transaction commits.
    const b=await binding(capture.tabId);
    if(b?.captureId===capture.id&&!globallyLate)await patchBinding(capture.tabId,current=>current.captureId===capture.id?{...current,lastSeen:Date.now(),lastFrameAt:f.at,lastStatus:f.status,docId:f.docId,lastRows:f.rows.length,lastSessionId:session.id}:current);
    return {frameId,sessionId:session.id};
  });
}
async function drain(captureId){
  const data=await chrome.storage.local.get(null);
  const keys=Object.keys(data).filter(k=>k.startsWith('pending.')&&(!captureId||data[k]?.captureId===captureId)).sort((a,b)=>(data[a]?.frame?.at||0)-(data[b]?.frame?.at||0)||(data[a]?.frame?.seq||0)-(data[b]?.frame?.seq||0));
  for(const key of keys){
    try{await ingest(data[key]);await chrome.storage.local.remove(key);}catch(e){console.warn('Pending observation retained:',e.message);}
  }
}
async function start(tabId,label,config){
  if(!label?.trim())throw Error('برای هر تب نام فیلتر وارد کن.');
  const tab=await chrome.tabs.get(tabId);if(!allowed(tab.url))throw Error('فقط صفحات دامنهٔ TSETMC مجاز هستند.');
  if(await binding(tabId))throw Error('این تب در حال ضبط است؛ ابتدا توقف را بزن.');
  config=C.settings(config);
  let probe=await tabCall(tabId,{type:'PROBE',profile:config.profile,config});
  if(!config.profile){
    if(!probe.discovery.candidates.length)throw Error('جدول تشخیص داده نشد؛ F8 یا تنظیم ساختار را استفاده کن.');
    if(probe.discovery.ambiguous)throw Error('چند جدول مشابه پیدا شد؛ با F8 جدول درست را انتخاب کن.');
    config.profile=probe.discovery.candidates[0].profile;
    probe=await tabCall(tabId,{type:'PROBE',profile:config.profile,config});
  }
  if(!['ok','empty','empty_unverified','partial'].includes(probe.current.status))throw Error(`شروع ضبط ممکن نیست: ${probe.current.status}؛ پیش‌نمایش/ساختار را بررسی کن.`);
  const id=C.uuid(),codeHash=config.code?await C.sha(config.code):'';
  const capture={id,tabId,windowId:tab.windowId,label:label.trim(),config,codeHash,createdAt:Date.now(),originalAutoDiscardable:tab.autoDiscardable};
  await DB.put('captures',capture);
  const b={captureId:id,tabId,windowId:tab.windowId,label:capture.label,config,codeHash,originalAutoDiscardable:tab.autoDiscardable,lastSeen:Date.now(),lastStatus:'starting',lastRefresh:0,refreshAttempts:[],lastCheckpoint:0};
  await saveBinding(b);
  try{
    await chrome.tabs.update(tabId,{autoDiscardable:false});
    await tabCall(tabId,{type:'START',binding:b});
    await saveProfile(capture.label,config,tab.url);
    await event(id,'CAPTURE_STARTED',{config:{...config,code:config.code?'[stored locally]':''},tabId,windowId:tab.windowId});
  }catch(e){await chrome.tabs.sendMessage(tabId,{type:'STOP'}).catch(()=>{});await chrome.storage.session.remove(bkey(tabId));await chrome.tabs.update(tabId,{autoDiscardable:tab.autoDiscardable!==false}).catch(()=>{});throw e;}
  return b;
}
async function stop(tabId){
  const b=await binding(tabId);if(!b)return;
  await patchBinding(tabId,current=>({...current,phase:'stopping'}));
  let stopped=null;
  try{stopped=await tabCall(tabId,{type:'STOP',captureId:b.captureId});if(stopped?.unsaved)await event(b.captureId,'STOP_UNSAVED_DATA',{unsaved:stopped.unsaved});}catch(e){await event(b.captureId,'STOP_WITHOUT_PAGE_ACK',{error:e.message});}
  await checkpoint(b,'stop');await drain(b.captureId);
  await chrome.storage.session.remove(bkey(tabId));
  try{await chrome.tabs.update(tabId,{autoDiscardable:b.originalAutoDiscardable!==false});}catch{}
  await event(b.captureId,'CAPTURE_STOPPED');
  await serial(b.captureId,async()=>{const cap=await DB.get('captures',b.captureId);if(cap)await DB.put('captures',{...cap,stoppedAt:Date.now()});});
  return {stopped:true,warning:stopped?.unsaved?`${stopped.unsaved} بسته هنوز فقط در حافظهٔ تب است؛ خطای ذخیره را برطرف کن.`:''};
}
async function snapshot(tabId,reason='button'){
  let b=await binding(tabId),capture;
  if(!b){
    const draft=(await chrome.storage.session.get(dkey(tabId)))[dkey(tabId)];
    if(!draft?.label)throw Error('اول نام فیلتر و تنظیمات تب را ذخیره کن.');
    const tab=await chrome.tabs.get(tabId),config=C.settings(draft);
    if(!config.profile){const p=await tabCall(tabId,{type:'PROBE'});if(p.discovery.ambiguous||!p.discovery.candidates.length)throw Error('برای عکس داده، جدول را با F8 مشخص کن.');config.profile=p.discovery.candidates[0].profile;}
    capture={id:C.uuid(),label:draft.label,tabId,windowId:tab.windowId,config,codeHash:config.code?await C.sha(config.code):'',createdAt:Date.now()};
    await DB.put('captures',capture);
  }else capture=await DB.get('captures',b.captureId);
  return serial(capture.id,async()=>{
    const f=await tabCall(tabId,{type:'SNAPSHOT',config:capture.config,reason});
    const session=await context(capture,f),snap={id:C.uuid(),sessionId:session.id,at:f.at,docId:f.docId,headers:f.headers,status:f.status,warnings:f.warnings||[],coverage:f.coverage,sourceTime:f.sourceTime,url:f.url,reason,mode:'static',rejectedRows:f.rejectedRows||[],rows:C.sortRows(f.rows)};
    const db=await DB.openDB(),tx=db.transaction(['sessions','snapshots'],'readwrite'),done=DB.completion(tx);
    session.snapshots++;session.endedAt=Math.max(session.endedAt,f.at);tx.objectStore('sessions').put(session);tx.objectStore('snapshots').put(snap);await done;return {id:snap.id,sessionId:session.id,status:snap.status,rows:snap.rows.length};
  });
}
async function guardedRefresh(tabId,automatic=false){
  const b=await binding(tabId);if(!b)throw Error('تب در حال ضبط نیست.');
  const pulse=await tabCall(tabId,{type:'FLUSH'});if(pulse.unsaved||pulse.pending)throw Error('رفرش متوقف شد: داده در صف ذخیره/انتقال است؛ ابتدا منتظر تخلیهٔ صف بمان.');
  const now=Date.now();b.refreshAttempts=(b.refreshAttempts||[]).filter(t=>now-t<3600000);
  const cooldown=60000*2**Math.min(b.refreshAttempts.length,3);
  if(now-b.lastRefresh<cooldown||b.refreshAttempts.length>=3)throw Error('توقف موقت رفرش برای جلوگیری از حلقهٔ بارگذاری.');
  const cp=await checkpoint(b,'before_reload');
  if(b.config.protectMemory&&(!cp.ok||!b.config.restoreMemory))throw Error('حفاظت حافظه فعال است؛ رفرش فقط با قرارداد حافظه و بازیابی فعال، یا خاموش‌کردن آگاهانهٔ حفاظت، انجام می‌شود.');
  await event(b.captureId,'RELOAD_REQUESTED',{automatic,checkpoint:cp,filterMemoryProtected:cp.ok&&b.config.restoreMemory});
  await patchBinding(tabId,current=>({...current,lastRefresh:now,refreshAttempts:[...(current.refreshAttempts||[]).filter(t=>now-t<3600000),now]}));await chrome.tabs.reload(tabId);
}
async function ensureOffscreen(){
  if(await chrome.offscreen.hasDocument())return;
  if(!offscreenOpening)offscreenOpening=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'Generate local XLSX/JSON archives and download without a remote server.'}).finally(()=>{offscreenOpening=null;});
  await offscreenOpening;
}
async function exportJob(options){
  if(!Array.isArray(options.sessionIds)||!options.sessionIds.length)throw Error('حداقل یک نشست را انتخاب کن.');
  const job={id:C.uuid(),at:Date.now(),status:'queued',options};await DB.put('jobs',job);await ensureOffscreen();
  await chrome.runtime.sendMessage({target:'offscreen',type:'RUN_EXPORT',jobId:job.id});return job;
}
async function reconcileDownload(job,item){
  if(!item||!['complete','interrupted'].includes(item.state))return;
  const latest=await DB.get('jobs',job.id);if(!latest)return;
  await DB.put('jobs',{...latest,status:item.state==='complete'?'complete':'error',error:item.error||'',updatedAt:Date.now()});
  await chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE',jobId:job.id}).catch(()=>{});
}
async function watchdog(){
  await drain();
  const current=await bindings();
  for(const item of current){
    try{
      let b=await binding(item.tabId);if(!b)continue;
      const tab=await chrome.tabs.get(b.tabId);if(!allowed(tab.url))continue;
      const t=C.time(Date.now()),within=t.clock>=b.config.marketStart&&t.clock<=b.config.marketEnd;
      const pulse=await tabCall(b.tabId,{type:'PULSE'}).catch(()=>null);
      b=await binding(b.tabId);if(!b)continue;
      if(b.phase==='stopping')continue;
      if(!pulse){
        await event(b.captureId,'WATCHDOG_NO_RESPONSE',{lastSeen:b.lastSeen,discarded:!!tab.discarded,tabStatus:tab.status});
      }else if(!pulse.running)await tabCall(b.tabId,{type:'START',binding:b});
      if(Date.now()-b.lastCheckpoint>15000&&b.config.statePaths.length){const cp=await checkpoint(b,'watchdog');b=await patchBinding(b.tabId,current=>({...current,lastCheckpoint:Date.now(),lastCheckpointOK:cp.ok}));if(!b)continue;}
      if(b.config.refreshEnabled&&within&&pulse?.running&&pulse.online&&!pulse.unsaved&&!pulse.pending&&b.lastStatus==='source_stalled'){
        try{await guardedRefresh(b.tabId,true);}catch(e){await event(b.captureId,'AUTO_RELOAD_HELD',{reason:e.message});}
      }
      if(b.config.eodEnabled&&t.clock>=b.config.eodTime&&b.eodDay!==t.day&&Date.now()-(b.eodAttemptAt||0)>60000){
        await patchBinding(b.tabId,current=>({...current,eodAttemptAt:Date.now()}));
        const snap=await snapshot(b.tabId,'scheduled_eod');
        if(!['ok','empty'].includes(snap.status)){await event(b.captureId,'EOD_UNCERTAIN',{snapshotId:snap.id,status:snap.status});continue;}
        b=await patchBinding(b.tabId,current=>({...current,eodDay:t.day}));if(!b)continue;
        await exportJob({sessionIds:[snap.sessionId],snapshotIds:[snap.id],format:'xlsx',mode:'static',view:'changes'});
      }
    }catch(e){console.warn('Watchdog:',e.message);}
  }
  // Resume export jobs interrupted by service worker/offscreen teardown, never erase data.
  const jobs=await DB.all('jobs');
  for(const job of jobs.filter(j=>j.status==='downloading')){try{const [item]=await chrome.downloads.search({id:job.downloadId});await reconcileDownload(job,item);}catch{}}
  for(const job of jobs.filter(j=>j.status==='queued'||j.status==='building'&&Date.now()-(j.updatedAt||j.at)>180000)){
    try{await ensureOffscreen();await chrome.runtime.sendMessage({target:'offscreen',type:'RUN_EXPORT',jobId:job.id});}catch{}
  }
}
async function initialize(){await DB.openDB();await chrome.alarms.create('borsa-watchdog',{periodInMinutes:.5});await drain();}
chrome.runtime.onInstalled.addListener(()=>{initialize().catch(console.error);});
chrome.runtime.onStartup.addListener(()=>{initialize().catch(console.error);});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='borsa-watchdog')watchdog().catch(console.error);});
chrome.action.onClicked.addListener(async tab=>{
  const url=chrome.runtime.getURL('dashboard.html'),existing=(await chrome.tabs.query({url:url+'*'}))[0];
  if(existing)await chrome.tabs.update(existing.id,{active:true});else await chrome.tabs.create({url:url+`?window=${tab.windowId}`});
});
chrome.tabs.onRemoved.addListener(async tabId=>{const b=await binding(tabId);if(b){await event(b.captureId,'TAB_CLOSED',{lastSeen:b.lastSeen});await chrome.storage.session.remove(bkey(tabId));}});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
  if(change.status==='loading')serial(`tab:${tabId}`,async()=>{const b=await binding(tabId);if(b)await event(b.captureId,'TAB_LOADING',{lastSeen:b.lastSeen});}).catch(console.error);
  if(change.autoDiscardable===true)binding(tabId).then(b=>{if(b)chrome.tabs.update(tabId,{autoDiscardable:false}).catch(()=>{});});
});
chrome.downloads.onChanged.addListener(async delta=>{
  if(!delta.state||!['complete','interrupted'].includes(delta.state.current))return;
  const job=(await DB.all('jobs')).find(j=>j.downloadId===delta.id);if(!job)return;
  await reconcileDownload(job,{state:delta.state.current,error:delta.error?.current});
});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.target==='offscreen')return false;
  (async()=>{
    const role=P.authorize(m,sender,chrome.runtime.id),content=role==='content';
    if(m.type==='HELLO'){
      if(!content)throw Error('پیام مخصوص صفحه است.');const b=await binding(sender.tab.id);
      if(b&&b.phase!=='stopping'){await drain(b.captureId);if(b.docId&&b.docId!==m.docId)await restore(b,m.docId);await patchBinding(sender.tab.id,current=>({...current,docId:m.docId,browserDocumentId:sender.documentId||'',phase:current.phase||'recording'}));}
      const current=await binding(sender.tab.id);return {binding:current?.phase==='stopping'?null:current,draft:(await chrome.storage.session.get(dkey(sender.tab.id)))[dkey(sender.tab.id)]};
    }
    if(m.type==='INGEST'){
      if(!content)throw Error('پیام مخصوص صفحه است.');const cap=await DB.get('captures',m.envelope?.captureId);
      if(!cap||cap.tabId!==sender.tab.id)throw Error('ضبط متعلق به این تب نیست.');return ingest(m.envelope);
    }
    if(m.type==='MAP'){
      if(!content)throw Error('پیام مخصوص صفحه است.');const id=sender.tab.id,b=await binding(id),draft=(await chrome.storage.session.get(dkey(id)))[dkey(id)]||{};
      const config=C.settings({...draft,...b?.config,profile:m.profile,mappingRevision:Date.now()});await chrome.storage.session.set({[dkey(id)]:config});
      if(b){await patchBinding(id,current=>({...current,config}));await serial(b.captureId,async()=>{const cap=await DB.get('captures',b.captureId);await DB.put('captures',{...cap,config});});await saveProfile(b.label,config,sender.url);await event(b.captureId,'MAPPING_CHANGED',{profile:m.profile});}
      return {config};
    }
    if(m.type==='LIST'){
      const tabs=(await chrome.tabs.query({})).filter(t=>allowed(t.url)),bs=await bindings(),drafts=await chrome.storage.session.get(null);
      return {tabs:tabs.map(t=>({id:t.id,windowId:t.windowId,title:t.title,url:t.url,active:t.active,discarded:t.discarded,binding:bs.find(b=>b.tabId===t.id)||null,draft:drafts[dkey(t.id)]||null})),profiles:await DB.all('profiles'),sessions:await DB.all('sessions'),jobs:(await DB.all('jobs')).sort((a,b)=>b.at-a.at).slice(0,20)};
    }
    if(m.type==='SAVE_DRAFT'){
      const tab=await chrome.tabs.get(m.tabId);if(!allowed(tab.url))throw Error('تب TSETMC نیست.');
      if(await binding(m.tabId))throw Error('برای تغییر نام/نسخه/تنظیمات، ابتدا ضبط تب را متوقف کن.');
      const config=C.settings({...m.config,label:m.label});await chrome.storage.session.set({[dkey(m.tabId)]:config});await saveProfile(m.label,config,tab.url);return {saved:true};
    }
    if(m.type==='START_TAB')return serial(`control:${m.tabId}`,()=>start(m.tabId,m.label,m.config));
    if(m.type==='STOP_TAB')return serial(`control:${m.tabId}`,()=>stop(m.tabId));
    if(m.type==='PROBE_TAB')return tabCall(m.tabId,{type:'PROBE',profile:m.profile,config:m.config});
    if(m.type==='PICK_TAB'){await chrome.tabs.update(m.tabId,{active:true});return tabCall(m.tabId,{type:'PICK'});}
    if(m.type==='SNAPSHOT_TAB')return snapshot(m.tabId);
    if(m.type==='REFRESH_TAB')return guardedRefresh(m.tabId,false);
    if(m.type==='DIAG_TAB'){const b=await binding(m.tabId),draft=(await chrome.storage.session.get(dkey(m.tabId)))[dkey(m.tabId)];return tabCall(m.tabId,{type:'DIAGNOSTIC',config:b?.config||draft});}
    if(m.type==='EXPORT')return exportJob(m.options);
    if(m.type==='CHECKPOINT_TAB'){const b=await binding(m.tabId);if(!b)throw Error('ضبط شروع نشده است.');return checkpoint(b,'button');}
    if(m.type==='DOWNLOAD'){
      if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw Error('بارگیری فقط از خروجی‌ساز داخلی مجاز است.');
      const job=await DB.get('jobs',m.jobId);if(!job)throw Error('کار خروجی پیدا نشد.');
      if(!String(m.url).startsWith(`blob:chrome-extension://${chrome.runtime.id}/`))throw Error('نشانی فایل نامعتبر.');
      const downloadId=await chrome.downloads.download({url:m.url,filename:`BORSA/${C.safeFilename(m.filename)}`,conflictAction:'uniquify',saveAs:false});
      await DB.put('jobs',{...job,status:'downloading',downloadId,filename:m.filename,updatedAt:Date.now()});return {downloadId};
    }
    throw Error('فرمان ناشناخته.');
  })().then(result=>reply({ok:true,...(m.type==='HELLO'?result:{result})})).catch(e=>reply({ok:false,error:e.message,code:e.code||'REQUEST_FAILED'}));return true;
});
// Worker globals are disposable; all authoritative state lives in IndexedDB/session storage.
initialize().catch(console.error);
