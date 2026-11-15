(() => {
  'use strict';
  const C=globalThis.BorsaCore,A=globalThis.BorsaAdapter,P=globalThis.BorsaProtocol;
  if(globalThis.BorsaRecorder?.version===C.version)return;
  globalThis.BorsaRecorder?.dispose?.();
  const docId=C.uuid(),pending=new Map(),volatile=[],listeners=[],timers=new Set();
  let binding=null,config=C.settings({}),seq=0,recording=false,disposed=false,explicitStop=false;
  let interval=null,debounce=null,writeBusy=false,sendBusy=false,retryMs=1000,helloBusy=false,pendingBytes=0,volatileBytes=0,lastHealthAt=0;
  let lastSignature='',lastSampleAt=0,lastAttemptAt=Date.now(),lossSince=null,lossCount=0;
  let sourceValue='',sourceKey='',sourceChangedAt=Date.now(),picker=null,host=null,box=null;
  function later(fn,ms){const id=setTimeout(()=>{timers.delete(id);if(!disposed)fn();},ms);timers.add(id);return id;}
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
  function banner(message){
    if(disposed||!document.documentElement)return;
    if(!host){
      document.querySelectorAll('[data-borsa-ui="badge"]').forEach(e=>e.remove());
      host=document.createElement('div');host.dataset.borsaUi='badge';host.style.cssText='all:initial;position:fixed;bottom:8px;right:8px;z-index:2147483646;max-width:440px;';
      const shadow=host.attachShadow({mode:'closed'});box=document.createElement('div');box.style.cssText='direction:rtl;font:12px Tahoma,sans-serif;background:#12233bf2;color:#e7f3ff;padding:9px 12px;border:1px solid #5ab9cd;border-radius:8px;';shadow.append(box);document.documentElement.append(host);
    }
    if(box.textContent!==message)box.textContent=message;
  }
  async function send(message,timeoutMs=10000){
    let timeout;
    try{
      return await Promise.race([chrome.runtime.sendMessage({channel:P.channel,...message}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('پاسخ افزونه دیر رسید؛ بسته در صف محفوظ است.')),timeoutMs);})]);
    }catch(e){
      if(/Extension context invalidated/i.test(e.message)){recording=false;clearInterval(interval);banner('بورسا ۲: افزونه به‌روزرسانی شده؛ میز ضبط را باز کن تا اتصال دوباره برقرار شود.');}
      throw e;
    }finally{clearTimeout(timeout);}
  }
  function notifyError(message){
    const captureId=binding?.captureId||volatile[0]?.envelope.captureId;
    if(!captureId||Date.now()-lastHealthAt<30000)return;lastHealthAt=Date.now();
    void send({type:'HEALTH',captureId,status:'sampler_error',error:String(message).slice(0,500),docId,at:Date.now()}).catch(()=>{});
  }
  function health(data,at,cfg){
    const key=cfg.profile?.sourceTimeSelector||'';
    if(data.sourceTime!==sourceValue||key!==sourceKey){sourceValue=data.sourceTime;sourceKey=key;sourceChangedAt=at;}
    const clock=C.time(at).clock,within=clock>=cfg.marketStart&&clock<=cfg.marketEnd;
    if(data.sourceTime&&within&&at-sourceChangedAt>cfg.staleMs&&['ok','empty'].includes(data.status)){data.status='source_stalled';data.warnings.push('SOURCE_CLOCK_STALLED');}
    return data;
  }
  function observation(cfg,mode,reason){
    const at=Date.now(),data=health(A.read(cfg.profile,cfg),at,cfg);
    if(at-lastAttemptAt>Math.max(cfg.maxGapMs,cfg.intervalMs*4))data.warnings.push('LOCAL_SAMPLING_DELAY');lastAttemptAt=at;
    return {...data,at,seq:++seq,docId,visibility:document.visibilityState,url:location.href,mode,reason,sourceChangedAt};
  }
  async function pump(){
    if(sendBusy||disposed)return;sendBusy=true;
    try{
      for(const [key,meta] of pending){
        const envelope=(await chrome.storage.local.get(key))[key];
        if(!envelope){pending.delete(key);pendingBytes-=meta.bytes;continue;}
        const answer=await send({type:'INGEST',envelope});if(!answer?.ok)throw Error(answer?.error||'ثبت تأیید نشد.');
        await chrome.storage.local.remove(key);pending.delete(key);pendingBytes-=meta.bytes;retryMs=1000;
        if(binding?.captureId===envelope.captureId)banner(`بورسا ۲: ${binding.label} | ${envelope.frame.rows.length} نماد | ${envelope.frame.status} | صف ${pending.size} | ${C.time(envelope.frame.at).local.slice(11)}`);
      }
    }catch(e){banner(`بورسا ۲: ${e.message} | ${pending.size} بستهٔ ذخیره‌شده در انتظار انتقال`);later(pump,retryMs);retryMs=Math.min(30000,retryMs*2);}
    finally{sendBusy=false;}
  }
  async function persist(){
    if(writeBusy||disposed)return;writeBusy=true;
    try{
      while(volatile.length){
        const item=volatile[0];await chrome.storage.local.set({[item.key]:item.envelope});
        volatile.shift();volatileBytes-=item.bytes;pending.set(item.key,{bytes:item.bytes});pendingBytes+=item.bytes;item.resolve({durable:true});void pump();
      }
    }catch(e){banner(`بورسا ۲: ذخیرهٔ محلی ناموفق — ${e.message}؛ ${volatile.length} بسته هنوز فقط در حافظه‌اند.`);notifyError(e.message);later(persist,2000);}
    finally{writeBusy=false;}
  }
  function sample(force=false,finalBinding=null){
    const current=finalBinding||binding;
    if(disposed||!current||(!recording&&!finalBinding))return Promise.resolve({skipped:true});
    try{
      if(volatile.length>=8||pending.size+volatile.length>=128||pendingBytes>=32*1024*1024||volatileBytes>=16*1024*1024){lossSince??=Date.now();lossCount++;banner('بورسا ۲: صف پر شده؛ نمونه‌برداری موقتاً متوقف است. وقفه در نمونهٔ بعد ثبت می‌شود.');return Promise.resolve({backpressure:true});}
      const f=observation(config,'dynamic',force?'forced':'observation');
      const signature=JSON.stringify([f.rows,f.headers,f.status,f.warnings,f.sourceTime,f.observedName,f.observedCode,f.rejectedRows]);
      const heartbeat=Math.min(config.heartbeatMs,config.intervalMs);
      if(!force&&signature===lastSignature&&f.at-lastSampleAt<heartbeat)return Promise.resolve({skipped:true});
      if(lossSince!==null){f.warnings.push('STORAGE_BACKPRESSURE_GAP');f.lossInterval={fromAt:lossSince,toAt:f.at,missedSamples:lossCount};lossSince=null;lossCount=0;}
      C.validateFrame(f);
      const envelope={captureId:current.captureId,frame:f},key=`pending.${current.captureId}.${docId}.${String(f.seq).padStart(10,'0')}`;
      const bytes=new TextEncoder().encode(JSON.stringify(envelope)).length;
      if(volatileBytes+bytes>16*1024*1024||pendingBytes+volatileBytes+bytes>32*1024*1024){lossSince??=Date.now();lossCount++;banner('بورسا ۲: سقف بایتی صف پر است؛ وقفهٔ نمونه‌برداری در گزارش ثبت می‌شود.');return Promise.resolve({backpressure:true});}
      lastSignature=signature;lastSampleAt=f.at;
      return new Promise(resolve=>{volatileBytes+=bytes;volatile.push({key,envelope,resolve,bytes});void persist();});
    }catch(e){lossSince??=Date.now();lossCount++;banner(`بورسا ۲: خواندن جدول ناموفق — ${e.message}`);notifyError(e.message);return Promise.resolve({error:e.message});}
  }
  function schedule(){
    if(!recording||disposed)return;
    if(debounce===null)debounce=later(()=>{debounce=null;void sample();},Math.max(config.debounceMs,100));
  }
  function activate(next){
    if(!next||next.phase==='stopping')return;
    const changed=binding?.captureId!==next.captureId;binding=next;config=C.settings(next.config);recording=true;explicitStop=false;
    if(changed){lastSignature='';lastSampleAt=0;sourceKey='';sourceValue='';sourceChangedAt=Date.now();}
    clearInterval(interval);interval=setInterval(()=>{void sample();},config.intervalMs);void sample(true);void pump();
  }
  async function stop(captureId){
    if(captureId&&binding?.captureId!==captureId)return {ignored:true};
    const current=binding;recording=false;explicitStop=true;clearInterval(interval);clearTimeout(debounce);debounce=null;
    if(current){const final=sample(true,current);await Promise.race([final,new Promise(resolve=>later(resolve,5000))]);}
    const unsaved=volatile.length;binding=null;void pump();
    banner(`بورسا ۲: ضبط متوقف | ${pending.size} بستهٔ پایدار منتظر انتقال${unsaved?` | ${unsaved} بسته هنوز ذخیره نشده`:''}`);
    return {stopped:true,pending:pending.size,unsaved};
  }
  function pick(){
    if(picker){picker();return;}
    const rect=document.createElement('div');rect.dataset.borsaUi='picker';rect.style.cssText='position:fixed;border:3px solid #ff9800;background:#ff980022;z-index:2147483647;pointer-events:none;';document.documentElement.append(rect);
    const move=e=>{const r=e.target.getBoundingClientRect();Object.assign(rect.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
    const cleanup=()=>{rect.remove();document.removeEventListener('mousemove',move,true);document.removeEventListener('click',click,true);picker=null;};
    const click=async e=>{
      e.preventDefault();e.stopImmediatePropagation();
      try{const row=A.rowFor(e.target);if(!row){banner('روی خانهٔ نماد یک سطر کلیک کن. Esc: لغو');return;}
        const profile=A.mapping(row,e.target),answer=await send({type:'MAP',profile});
        if(!answer?.ok)throw Error(answer?.error||'انتخاب ذخیره نشد.');config=C.settings(answer.result.config);cleanup();lastSignature='';banner('بورسا ۲: جدول ذخیره شد؛ پیش‌نمایش را بررسی کن.');if(recording)void sample(true);
      }catch(error){banner(`بورسا ۲: ${error.message}`);}
    };
    picker=cleanup;document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);banner('F8: خانهٔ نماد را انتخاب کن؛ در جدول HTML خالی، عنوان نماد. Esc: لغو.');
  }
  listen(document,'keydown',e=>{if(e.key==='F8'){e.preventDefault();e.stopPropagation();pick();}if(e.key==='Escape')picker?.();},true);
  const observer=new MutationObserver(records=>{if(records.some(r=>!(r.target.nodeType===1?r.target:r.target.parentElement)?.closest?.('[data-borsa-ui]')))schedule();});
  observer.observe(document.documentElement||document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','value','aria-rowcount']});
  for(const event of ['online','offline','pageshow'])listen(window,event,()=>{void sample(true);});
  const receive=(msg,sender,reply)=>{
    if(disposed||!P.fromWorker(sender,chrome.runtime.id))return false;
    const known=new Set(['PROBE','START','STOP','CONFIG','PULSE','FLUSH','PICK','DIAGNOSTIC','SNAPSHOT']);if(!known.has(msg?.type))return false;
    (async()=>{
      if(msg.type==='PROBE'){const cfg=C.settings(msg.config||config),profile=msg.profile||cfg.profile;return {discovery:profile?{candidates:[],ambiguous:false}:A.discover(),current:A.read(profile,cfg)};}
      if(msg.type==='START'){activate(msg.binding);return {started:true,docId};}
      if(msg.type==='STOP')return stop(msg.captureId);
      if(msg.type==='CONFIG'){config=C.settings(msg.config);lastSignature='';return {updated:true};}
      if(msg.type==='PULSE'){if(msg.force)void sample(true);return {running:recording,at:Date.now(),docId,online:navigator.onLine,pending:pending.size,unsaved:volatile.length};}
      if(msg.type==='FLUSH'){
        void sample(true);const until=Date.now()+5000;
        while(Date.now()<until&&(volatile.length||pending.size)){void persist();void pump();await new Promise(resolve=>later(resolve,50));}
        return {pending:pending.size,unsaved:volatile.length};
      }
      if(msg.type==='PICK'){pick();return {picking:true};}
      if(msg.type==='DIAGNOSTIC'){const cfg=C.settings(msg.config||config);return {...A.diagnostic(cfg.profile,cfg),recorder:{version:C.version,docId,running:recording,pending:pending.size,unsaved:volatile.length}};}
      if(msg.type==='SNAPSHOT'){const cfg=C.settings(msg.config||config),f=observation(cfg,'static',msg.reason||'button');C.validateFrame(f);return f;}
    })().then(result=>reply({ok:true,result})).catch(e=>reply({ok:false,error:e.message}));return true;
  };
  chrome.runtime.onMessage.addListener(receive);
  async function hello(){
    if(helloBusy||disposed||explicitStop)return;helloBusy=true;
    try{const answer=await send({type:'HELLO',docId,url:location.href});if(!answer?.ok)throw Error(answer?.error||'اتصال تأیید نشد.');
      if(answer.binding)activate(answer.binding);else if(answer.draft)config=C.settings(answer.draft);
    }catch(e){banner(`بورسا ۲: اتصال برقرار نشد — ${e.message}`);}finally{helloBusy=false;}
  }
  function dispose(){disposed=true;recording=false;clearInterval(interval);clearInterval(check);for(const id of timers)clearTimeout(id);observer.disconnect();listeners.forEach(fn=>fn());picker?.();host?.remove();chrome.runtime.onMessage.removeListener(receive);}
  const check=setInterval(()=>{if(!binding&&!explicitStop)void hello();else if(recording){void sample();void pump();}},10000);
  globalThis.BorsaRecorder={version:C.version,docId,dispose,health:()=>({recording,pending:pending.size,unsaved:volatile.length,pendingBytes,volatileBytes})};
  void hello();
})();
