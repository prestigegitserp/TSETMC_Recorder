/* Integration contracts run the real worker in V8 with Chrome/IDB boundaries mocked.
   They do not claim a live Chrome or live TSETMC integration test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const root=new URL('../extension/',import.meta.url),stamp=Date.parse('2026-11-15T06:00:00Z');
function event(){return {listeners:[],addListener(fn){this.listeners.push(fn);}};}
const clone=v=>v===undefined?undefined:structuredClone(v);
function environment(){
  const maps=Object.fromEntries(['captures','sessions','frames','events','states','snapshots','checkpoints','jobs','profiles'].map(n=>[n,new Map()]));
  const local={},session={},tabs=new Map([[1,{id:1,windowId:9,url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F',autoDiscardable:true}],[2,{id:2,windowId:9,url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F',autoDiscardable:true}]]);
  const storage=data=>({async get(keys){if(keys===null)return clone(data);if(typeof keys==='string')return {[keys]:clone(data[keys])};return Object.fromEntries(keys.map(k=>[k,clone(data[k])]));},async set(values){Object.assign(data,clone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}});
  const chosen={rootSelector:'#data',rowSelector:':scope > tr',cellSelector:':scope > td',symbolColumn:0};
  const e={maps,local,session,tabs,failCommit:false};
  e.db={stores:Object.keys(maps),async openDB(){return {};},async get(n,id){return clone(maps[n].get(id));},async all(n){return [...maps[n].values()].map(clone);},async put(n,x){maps[n].set(x.id,clone(x));return x;},async bySession(n,id){return [...maps[n].values()].filter(x=>x.sessionId===id).map(clone);},async commitFrame(s,f,events,state,capture){
    if(e.failCommit){e.failCommit=false;throw Error('SIMULATED_DISK_FAILURE');}
    maps.sessions.set(s.id,clone(s));maps.frames.set(f.id,clone(f));events.forEach((x,i)=>maps.events.set(`${f.id}:e${i}`,clone({...x,id:`${f.id}:e${i}`,sessionId:s.id,frameId:f.id})));maps.states.set(s.id,clone({...state,id:s.id}));if(capture)maps.captures.set(capture.id,clone(capture));
  }};
  e.chrome={runtime:{id:'testextension',getURL:p=>`chrome-extension://testextension/${p}`,onInstalled:event(),onStartup:event(),onMessage:event(),async sendMessage(){return {accepted:true};}},storage:{local:storage(local),session:storage(session)},alarms:{async create(){},onAlarm:event()},action:{onClicked:event()},offscreen:{async hasDocument(){return true;}},downloads:{onChanged:event(),async download(){return 1;}},scripting:{async executeScript(){return [{result:{ok:true,values:{}}}];}},tabs:{onRemoved:event(),onUpdated:event(),async get(id){const t=tabs.get(id);if(!t)throw Error('Missing tab');return clone(t);},async query(){return [...tabs.values()].map(clone);},async update(id,delta){Object.assign(tabs.get(id),delta);return clone(tabs.get(id));},async reload(){},async create(){},async sendMessage(id,msg){
    if(msg.type==='PROBE')return {ok:true,result:{current:{status:e.probeStatus||'ok'},discovery:{ambiguous:false,candidates:[{profile:chosen}]}}};
    return {ok:true,result:{started:true,running:true,online:true,docId:`d${id}`}};
  }}};
  return e;
}
async function load(e){
  const context=vm.createContext({chrome:e.chrome,console:{log(){},warn(){},error(){}},crypto:webcrypto,TextEncoder,structuredClone,URL,Intl,Date,setTimeout,clearTimeout});
  const cache=new Map();
  async function module(name){
    if(cache.has(name))return cache.get(name);
    if(name==='db.js'){const m=new vm.SyntheticModule(Object.keys(e.db),function(){for(const [k,v]of Object.entries(e.db))this.setExport(k,v);},{context});cache.set(name,m);return m;}
    const code=await fs.readFile(new URL(name,root),'utf8'),m=new vm.SourceTextModule(code,{context,identifier:name});cache.set(name,m);await m.link(spec=>module(spec.replace('./','')));return m;
  }
  const m=await module('worker.js');await m.evaluate();
  const listeners=e.chrome.runtime.onMessage.listeners.slice(-1),sender={id:'testextension',url:'chrome-extension://testextension/dashboard.html'};
  return async(msg,source=sender)=>new Promise((resolve,reject)=>{let responded=false;const handled=listeners[0](msg,source,r=>{responded=true;resolve(clone(r));});if(handled===false&&!responded)reject(Error('Unhandled message'));});
}
const source=id=>({id:'testextension',tab:{id},frameId:0,url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F'});
const row=(symbol,id)=>({key:`ins:${id}`,symbol,insCode:String(id),rank:1,cells:[symbol,'100']});
const obs=(captureId,seq,rows,extra={})=>({type:'INGEST',envelope:{captureId,frame:{at:stamp+seq*1000,seq,docId:'first',headers:['نماد','قیمت'],rows,status:'ok',warnings:[],url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F',...extra}}});
test('worker start, simultaneous independent tabs, reload resume and stop contracts',async()=>{
  const e=environment(),send=await load(e),a=await send({type:'START_TAB',tabId:1,label:'الف',config:{}}),b=await send({type:'START_TAB',tabId:2,label:'ب',config:{}});
  assert.equal(a.ok,true);assert.equal(b.ok,true);assert.notEqual(a.result.captureId,b.result.captureId);assert.equal(e.tabs.get(1).autoDiscardable,false);
  const results=await Promise.all([send(obs(a.result.captureId,1,[row('فملی','11111111111111111')]),source(1)),send(obs(b.result.captureId,1,[row('آباد','22222222222222222')]),source(2))]);assert.ok(results.every(r=>r.ok));
  const states=[...e.maps.states.values()];assert.equal(states.length,2);assert.equal(Object.keys(states[0].members).length,1);assert.equal(Object.keys(states[1].members).length,1);
  const resumed=await send({type:'HELLO',docId:'after-refresh'},source(1));assert.equal(resumed.binding.captureId,a.result.captureId);
  const stopped=await send({type:'STOP_TAB',tabId:1});assert.equal(stopped.ok,true);assert.equal(e.tabs.get(1).autoDiscardable,true);assert.equal(e.session['binding.1'],undefined);assert.equal(e.maps.frames.size,2);
});
test('durable ACK is withheld on failed commit; retry is idempotent',async()=>{
  const e=environment(),send=await load(e),started=await send({type:'START_TAB',tabId:1,label:'آزمون',config:{}}),capture=started.result.captureId,msg=obs(capture,1,[row('فملی','11111111111111111')]);
  e.failCommit=true;const failed=await send(msg,source(1));assert.equal(failed.ok,false);assert.match(failed.error,/DISK_FAILURE/);assert.equal(e.maps.frames.size,0);
  assert.equal((await send(msg,source(1))).ok,true);assert.equal((await send(msg,source(1))).result.duplicate,true);assert.equal(e.maps.frames.size,1);assert.equal([...e.maps.sessions.values()][0].frames,1);
});
test('concurrent messages in the same capture serialize without lost counters',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'ترتیب',config:{}}),id=start.result.captureId;
  const results=await Promise.all(Array.from({length:25},(_,n)=>send(obs(id,n+1,[row('فملی','11111111111111111')]),source(1))));assert.ok(results.every(r=>r.ok));assert.equal([...e.maps.sessions.values()][0].frames,25);assert.equal([...e.maps.states.values()][0].lastSeq,25);
});
test('worker recreation reads persistent binding and state rather than empty globals',async()=>{
  const e=environment();let send=await load(e);const start=await send({type:'START_TAB',tabId:1,label:'بازیابی',config:{}}),id=start.result.captureId;
  await send(obs(id,1,[row('فملی','11111111111111111')]),source(1));send=await load(e);const hello=await send({type:'HELLO',docId:'second'},source(1));assert.equal(hello.binding.captureId,id);
  await send(obs(id,1,[row('فملی','11111111111111111')],{docId:'second',at:stamp+20000}),source(1));assert.equal(e.maps.frames.size,2);assert.equal([...e.maps.states.values()][0].stats['ins:11111111111111111'].entries,1);assert.ok([...e.maps.events.values()].some(x=>x.type==='DOCUMENT_CHANGED'));
});
test('filter code/name segmentation remains distinct even on identical URLs',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'پایه',config:{}}),id=start.result.captureId;
  await send(obs(id,1,[row('فملی','11111111111111111')],{observedName:'فیلتر یک',observedCode:'x=1'}),source(1));
  await send(obs(id,2,[row('فملی','11111111111111111')],{observedName:'فیلتر دو',observedCode:'x=2'}),source(1));
  assert.equal(e.maps.sessions.size,2);assert.equal(new Set([...e.maps.sessions.values()].map(s=>s.filterFingerprint)).size,2);
});
test('page cannot invoke control commands or impersonate another tab capture',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'خصوصی',config:{}}),id=start.result.captureId;
  assert.equal((await send({type:'LIST'},source(1))).ok,false);assert.equal((await send(obs(id,1,[]),source(2))).ok,false);assert.equal((await send({type:'HELLO'}, {...source(1),url:'https://evil.example'})).ok,false);
});
test('default memory guard prevents refresh without a usable memory contract',async()=>{
  const e=environment(),send=await load(e);await send({type:'START_TAB',tabId:1,label:'حافظه',config:{}});const r=await send({type:'REFRESH_TAB',tabId:1});assert.equal(r.ok,false);assert.match(r.error,/حفاظت حافظه/);
});
test('switching A to B and back to A cannot invent continuous time in A',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'کل',config:{}}),id=start.result.captureId,r=row('فملی','11111111111111111');
  await send(obs(id,1,[r],{observedName:'A'}),source(1));await send(obs(id,2,[r],{observedName:'B'}),source(1));await send(obs(id,3,[r],{observedName:'A'}),source(1));
  const a=[...e.maps.sessions.values()].find(s=>s.observedName==='A'),s=e.maps.states.get(a.id);assert.equal(s.stats[r.key].observedSeconds,0);assert.equal([...e.maps.events.values()].filter(e=>e.type==='FILTER_IDENTITY_SEGMENT').length,2);
});
test('late messages from an old filter cannot replace the current active filter',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'کل',config:{}}),id=start.result.captureId,r=row('فملی','11111111111111111');
  await send(obs(id,1,[r],{observedName:'A'}),source(1));await send(obs(id,3,[r],{observedName:'B'}),source(1));const active=e.maps.captures.get(id).activeSessionId;
  await send(obs(id,2,[r],{observedName:'A'}),source(1));assert.equal(e.maps.captures.get(id).activeSessionId,active);assert.equal([...e.maps.frames.values()].find(f=>f.seq===2).payload.kind,'late');
});
test('a known empty table can start recording without claiming a healthy empty filter',async()=>{
  const e=environment();e.probeStatus='empty_unverified';const send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'فعلاً بدون خروجی',config:{profile:{rootSelector:'#data',rowSelector:'tr',symbolColumn:0}}});assert.equal(start.ok,true);
  const r=await send(obs(start.result.captureId,1,[],{status:'empty_unverified'}),source(1));assert.equal(r.ok,true);assert.equal([...e.maps.states.values()][0].lastGoodAt,null);
});
test('realistic dashboard sender with tab data can list and start capture',async()=>{
  const e=environment(),send=await load(e),sender={id:'testextension',url:'chrome-extension://testextension/dashboard.html?window=9',frameId:0,tab:{id:99}};
  assert.equal((await send({type:'LIST'},sender)).ok,true);assert.equal((await send({type:'START_TAB',tabId:1,label:'نسخه دو',config:{}},sender)).ok,true);
});
test('double start clicks are serialized and cannot create two captures for one tab',async()=>{
  const e=environment(),send=await load(e),msg={type:'START_TAB',tabId:1,label:'تکرار',config:{}};
  const results=await Promise.all([send(msg),send(msg)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(e.maps.captures.size,1);
});
test('temporary missing filter-name binding does not create a new filter session',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'فیلتر',config:{}}),id=start.result.captureId,r=row('فملی','11111111111111111');
  await send(obs(id,1,[r],{observedName:'A',observedCode:'x=1'}),source(1));
  await send(obs(id,2,[r],{status:'filter_identity_unverified',warnings:['FILTER_NAME_BINDING_MISSING','FILTER_CODE_BINDING_MISSING']}),source(1));assert.equal(e.maps.sessions.size,1);
});
test('sampler storage errors are scoped to the owning tab and visible in history',async()=>{
  const e=environment(),send=await load(e),start=await send({type:'START_TAB',tabId:1,label:'خطای ذخیره',config:{}}),id=start.result.captureId;
  assert.equal((await send({type:'HEALTH',captureId:id,error:'SIMULATED_DISK_FAILURE',docId:'d1'},source(1))).ok,true);assert.equal(e.session['binding.1'].lastStatus,'sampler_error');assert.ok([...e.maps.events.values()].some(e=>e.type==='SAMPLER_STATUS'));
  assert.equal((await send({type:'HEALTH',captureId:id,error:'foreign'},source(2))).ok,false);
});
