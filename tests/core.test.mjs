import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import '../extension/core.js';
import {buildReport} from '../extension/report.js';
import {pageMemory} from '../extension/page-memory.js';
import {importArchive} from '../extension/db.js';
const C=globalThis.BorsaCore,base=Date.parse('2026-11-15T06:00:00Z');
const row=(name,id,rank=1,price='۱٬۰۰۰')=>({key:`ins:${id}`,symbol:name,insCode:String(id),rank,cells:[name,price]});
const a=row('فملی','35425587644337450'),b=row('آباد','11111111111111111'),c=row('بیمه','22222222222222222');
const frame=(n,rows,extra={})=>({at:base+n*1000,seq:n+1,docId:'doc1',rows,headers:['نماد','آخرین'],status:'ok',warnings:[],coverage:'complete_verified',...extra});
test('Persian identity normalization preserves raw values and deterministic sorting',()=>{
  assert.equal(C.normal(' كيان‌ ي '),'کیان ی');assert.deepEqual(C.sortRows([a,c,b]).map(r=>r.symbol),['آباد','بیمه','فملی']);assert.equal(a.cells[1],'۱٬۰۰۰');
});
test('strict numeric parser, units and Excel identifier precision',()=>{
  assert.equal(C.numeric('۱۲۳٬۴۵۶').value,123456);assert.equal(C.numeric('۲٫۵٪').value,.025);assert.equal(C.numeric('1.2M').value,1200000);assert.equal(C.numeric('−12').value,-12);
  for(const value of ['12,34','1e5','=1+1','قیمت ۲۳','35425587644337450'])assert.equal(C.numeric(value).value,null);
});
test('Tehran date rolls over at 20:30 UTC with a Persian day',()=>{
  const t=C.time(Date.parse('2026-11-15T20:30:00Z'));assert.equal(t.day,'2026-11-16');assert.equal(t.jalali,'1405-08-25');assert.match(t.local,/00:00:00/);
});
test('first observation is left censored, not a fabricated new entry',()=>{
  const r=C.step(null,frame(0,[a]));assert.equal(r.events.find(e=>e.key===a.key).type,'FIRST_OBSERVED');assert.equal(r.events.find(e=>e.key===a.key).detail.leftCensored,true);assert.equal(r.state.stats[a.key].entries,1);
});
test('rank changes do not create membership changes',()=>{
  const s=C.step(null,frame(0,[a,b])).state,r=C.step(s,frame(1,[{...b,rank:1},{...a,rank:2}]));
  assert.equal(r.events.filter(e=>/ENTER|EXIT/.test(e.type)).length,0);assert.ok(r.payload.upsert.some(r=>r.key===a.key));
});
test('transient membership remains in raw data without false stable confirmation',()=>{
  let s=null,events=[];for(const f of [frame(0,[a]),frame(1,[]),frame(2,[a]),frame(3,[])]){const r=C.step(s,f);s=r.state;events.push(...r.events);}
  assert.equal(events.filter(e=>e.type==='PRESENT_CONFIRMED'||e.type==='BASELINE_CONFIRMED').length,0);assert.equal(s.stats[a.key].reappearances,1);assert.equal(s.stats[a.key].exits,2);
});
test('stable entry needs both elapsed time and confirmation samples',()=>{
  let s=C.step(null,frame(0,[])).state;
  s=C.step(s,frame(1,[a])).state;s=C.step(s,frame(2,[a])).state;
  const r=C.step(s,frame(3,[a]));assert.equal(r.events.find(e=>e.type==='PRESENT_CONFIRMED').detail.observedSince,base+1000);assert.equal(r.state.stats[a.key].observedSeconds,2);
});
test('offline, partial and unverified empty samples do not generate false exits',()=>{
  for(const status of ['offline','partial','missing_root','empty_unverified','identity_collision']){
    const s=C.step(null,frame(0,[a])).state,r=C.step(s,frame(1,[],{status}));
    assert.equal(r.state.members[a.key].raw,true);assert.equal(r.state.stats[a.key].exits,0);assert.equal(r.events.some(e=>e.type==='EXIT_OBSERVED'),false);
  }
});
test('recovery differences carry uncertain transition interval',()=>{
  let s=C.step(null,frame(0,[a])).state;s=C.step(s,frame(1,[],{status:'missing_root'})).state;
  const r=C.step(s,frame(4,[]));assert.equal(r.events.find(e=>e.type==='CHANGE_ACROSS_GAP').detail.fromAt,base);assert.equal(r.state.stats[a.key].observedSeconds,0);
});
test('long stalls and document refreshes preserve history and exclude unknown duration',()=>{
  const s=C.step(null,frame(0,[a])).state,r=C.step(s,frame(20,[a],{docId:'doc2',seq:1}));
  assert.equal(r.state.stats[a.key].firstAt,base);assert.equal(r.state.stats[a.key].entries,1);assert.equal(r.state.stats[a.key].observedSeconds,0);assert.ok(r.events.some(e=>e.type==='SAMPLING_GAP'));assert.ok(r.events.some(e=>e.type==='DOCUMENT_CHANGED'));
});
test('late observations remain witnesses and cannot rewind membership',()=>{
  let s=C.step(null,frame(0,[a])).state;s=C.step(s,frame(2,[b])).state;
  const r=C.step(s,frame(1,[a]));assert.equal(r.payload.kind,'late');assert.deepEqual(r.state,s);assert.ok(r.events.some(e=>e.type==='LATE_FRAME'));
});
test('schema changes create keyframes and an uncertainty boundary',()=>{
  const s=C.step(null,frame(0,[a])).state,r=C.step(s,frame(1,[a],{headers:['نماد','حجم']}));assert.equal(r.payload.kind,'keyframe');assert.ok(r.events.some(e=>e.type==='SCHEMA_CHANGED'));assert.equal(r.state.stats[a.key].observedSeconds,0);
});
test('duplicate identities and malformed frames fail instead of overwriting',()=>{
  assert.throws(()=>C.step(null,frame(0,[a,a])),/تکراری/);assert.throws(()=>C.validateFrame({...frame(0,[a]),seq:0}));assert.throws(()=>C.settings({statePaths:['x.__proto__.evil']}));
});
test('two tabs are independent state machines',()=>{
  let x=C.step(null,frame(0,[a])).state,y=C.step(null,frame(0,[b])).state;x=C.step(x,frame(1,[c])).state;
  assert.equal(y.members[b.key].raw,true);assert.equal(y.stats[a.key],undefined);assert.equal(x.stats[b.key],undefined);
});
test('1,200 adversarial frames replay exactly, including partials and reordered rows',()=>{
  let seed=17831,s=null,replay={};const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let n=0;n<1200;n++){
    const rows=[a,b,c].filter(()=>rnd()>.3).sort(()=>rnd()-.5).map((r,i)=>({...r,rank:i+1,cells:[r.symbol,String(Math.floor(rnd()*9000))]}));
    const f=frame(n,rows,{status:n%53===0?'partial':'ok',docId:n<600?'first':'second'}),r=C.step(s,f);s=r.state;
    replay=C.replay(replay,{payload:r.payload});assert.deepEqual(Object.values(replay).sort((a,b)=>a.key.localeCompare(b.key)),[...rows].sort((a,b)=>a.key.localeCompare(b.key)));
  }
});
test('memory checkpoint rejects getters, cycles and class instances without evaluating them',()=>{
  globalThis.window={memory:{count:4,arr:[1,'x']}};
  const result=pageMemory('read',['memory']);assert.deepEqual(result.values.memory,{count:4,arr:[1,'x']});
  let calls=0;Object.defineProperty(window,'danger',{get(){calls++;return {};}});assert.equal(pageMemory('read',['danger']).ok,false);assert.equal(calls,0);
  window.cycle={};window.cycle.self=window.cycle;assert.equal(pageMemory('read',['cycle']).ok,false);
  window.map=new Map();assert.equal(pageMemory('read',['map']).ok,false);assert.equal(pageMemory('read',['__proto__.x']).ok,false);
  assert.equal(pageMemory('write',['memory'],{memory:{count:7}}).ok,true);assert.equal(window.memory.count,7);
});
function dataset(){
  const config=C.settings({}),session={id:'session-test',captureId:'capture-test',label:'فیلتر آزمایشی',jalali:'1405-08-24',day:'2026-11-15',declaredVersion:'7',filterFingerprint:'a'.repeat(64),codeHash:'b'.repeat(64),config,url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F'};
  let state=null;const frames=[],events=[];
  for(const [n,rows] of [[0,[a,b]],[1,[b,c]],[2,[b,c]],[3,[b,c]]]){const f=frame(n,rows),r=C.step(state,f,config);state=r.state;frames.push({...f,id:`f${n}`,sessionId:session.id,receivedAt:f.at+10,payload:r.payload});events.push(...r.events.map((e,i)=>({...e,id:`e${n}-${i}`,sessionId:session.id})));}
  return {sessions:[session],frames,events,snapshots:[{id:'snap1',sessionId:session.id,at:base+5000,status:'ok',headers:['نماد','آخرین'],rows:[{...a,cells:['فملی','=HYPERLINK("https://example.com")']},c,b],warnings:[]}]};
}
test('report static snapshots are alphabetical and numeric raw values are retained',async()=>{
  const report=buildReport(dataset(),{mode:'both'}),sheet=report.sheets.find(s=>s.name==='استاتیک');
  assert.deepEqual(sheet.rows.map(r=>r[7]),['آباد','بیمه','فملی']);assert.equal(sheet.rows[0][8],'11111111111111111');assert.ok(sheet.rows[2].some(x=>typeof x==='string'&&x.includes('HYPERLINK')));
  assert.match(report.filename,/BOTH_1405-08-24/);assert.match(report.filename,/_h[0-9a-f]{8}_s[0-9a-f]{8}\.xlsx$/);
  await fs.mkdir(new URL('../test-results/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../test-results/runtime-sample.xlsx',import.meta.url),new Uint8Array(await report.blob.arrayBuffer()));
});
test('full report reconstructs every observed table instead of only changed rows',()=>{
  const report=buildReport(dataset(),{mode:'dynamic',view:'full'});assert.equal(report.sheets.find(s=>s.name==='مشاهدات').rows.length,8);assert.ok(!report.sheets.some(s=>s.name==='استاتیک'));
});
test('time-restricted reports replay preceding keyframes and scope statistics to the range',()=>{
  const report=buildReport(dataset(),{mode:'dynamic',view:'full',fromAt:base+2000,toAt:base+3000});assert.equal(report.sheets.find(s=>s.name==='مشاهدات').rows.length,4);assert.equal(report.sheets.find(s=>s.name==='فریم‌ها').rows.length,2);
  const inventory=report.sheets.find(s=>s.name==='نمادها').rows;assert.equal(inventory.length,2);assert.equal(inventory[0][12],1);
});
test('empty export ranges fail clearly',()=>{assert.throws(()=>buildReport(dataset(),{fromAt:base+90000}),/داده‌ای/);});
test('local date input converts through Asia/Tehran rather than host timezone',()=>{
  assert.equal(C.fromLocal('2026-11-15T09:30:00'),base);assert.equal(C.fromLocal('2026-11-16T00:00'),Date.parse('2026-11-15T20:30:00Z'));assert.throws(()=>C.fromLocal('2026-02-30T09:30'));
});
test('one-click static report selects exactly the requested snapshot',()=>{
  const data=dataset();data.snapshots.push({...data.snapshots[0],id:'snap2',at:base+6000,rows:[a]});
  const report=buildReport(data,{mode:'static',snapshotIds:['snap2']});assert.equal(report.sheets.find(s=>s.name==='استاتیک').rows.length,1);assert.equal(report.sheets.find(s=>s.name==='نمادها').rows.length,1);assert.equal(report.sheets.some(s=>s.name==='مشاهدات'),false);
});
test('invalid archives fail validation before opening a database',async()=>{
  await assert.rejects(importArchive({format:'wrong',schema:1}),/فرمت/);
  await assert.rejects(importArchive({format:'borsa-recorder-archive',schema:1,sessions:[],frames:[{id:'bad',sessionId:'missing'}],events:[],snapshots:[]}),/ارجاع ناقص/);
});
test('a sliced changes report starts with a reconstructable complete range keyframe',()=>{
  const report=buildReport(dataset(),{mode:'dynamic',view:'changes',fromAt:base+2000,toAt:base+3000});const frames=report.sheets.find(s=>s.name==='فریم‌ها');assert.equal(frames.rows[0][8],'range_keyframe');assert.equal(frames.rows[0][12],2);assert.equal(report.sheets.find(s=>s.name==='مشاهدات').rows.length,2);
});
test('Persian filenames fit filesystem byte limits while preserving the hash suffix',()=>{
  const report=buildReport({...dataset(),sessions:dataset().sessions.map(s=>({...s,label:'فیلتر'.repeat(100),declaredVersion:'جدید'.repeat(15)}))});assert.ok(new TextEncoder().encode(report.filename).length<=230);assert.match(report.filename,/_h[0-9a-f]{8}_s[0-9a-f]{8}\.xlsx$/);
});
test('backpressure gaps are excluded from presence durations and remain explicit',()=>{
  const state=C.step(null,frame(0,[a])).state,r=C.step(state,frame(1,[a],{lossInterval:{fromAt:base+100,toAt:base+1000,missedSamples:3}}));assert.equal(r.state.stats[a.key].observedSeconds,0);assert.ok(r.events.some(e=>e.type==='SAMPLING_BACKPRESSURE'));
});
test('configuration rejects string booleans and invalid column mappings',()=>{
  assert.throws(()=>C.settings({trustEmpty:'false'}));assert.throws(()=>C.settings({profile:{symbolColumn:-1}}));assert.throws(()=>C.settings({profile:[]}));
});
