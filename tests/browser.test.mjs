/* Real, fresh Chromium profile; TSETMC HTTP responses are local fixtures.
   No live site, user profile, cookies or trading endpoint is accessed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
let chromium;
try{({chromium}=await import('playwright'));}catch(e){if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw e;({chromium}=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright'));}
const root=path.resolve(new URL('..',import.meta.url).pathname),output=path.join(root,'test-results/browser');
const fixture=await fs.readFile(new URL('./fixtures/watch.html',import.meta.url),'utf8');
const fixtureUrl='http://old.tsetmc.com/Loader.aspx?ParTree=15131F';
async function poll(fn,predicate,description,timeout=20000){const until=Date.now()+timeout;let value;while(Date.now()<until){value=await fn();if(predicate(value))return value;await new Promise(r=>setTimeout(r,150));}throw Error(`Timed out: ${description}; last=${JSON.stringify(value).slice(0,1000)}`);}
test('native Chromium recorder, IndexedDB and XLSX pipeline',{timeout:180000},async t=>{
  await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(os.tmpdir(),'borsa-native-')),downloads=path.join(output,'downloads');await fs.mkdir(downloads,{recursive:true});
  let context,dashboard,worker,senderShapes=[];const errors=[],results=[];
  try{
    const extension=path.join(root,'extension');
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,downloadsPath:downloads,ignoreDefaultArgs:['--disable-extensions'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-sandbox','--disable-dev-shm-usage']});
    await context.route('http://old.tsetmc.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture}));
    worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});const id=new URL(worker.url()).hostname;
    await worker.evaluate(()=>{globalThis.senderTrace=[];chrome.runtime.onMessage.addListener((m,s)=>{senderTrace.push({type:m.type,url:s.url,frameId:s.frameId,hasTab:!!s.tab,origin:s.origin});return false;});});
    dashboard=await context.newPage();dashboard.on('pageerror',e=>errors.push(e.message));await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
    const api=(type,args={})=>dashboard.evaluate(async({type,args})=>chrome.runtime.sendMessage({channel:'borsa.recorder.v2',type,...args}),{type,args});
    const db=(name)=>dashboard.evaluate(async name=>{const D=await import(chrome.runtime.getURL('db.js'));return D.all(name);},name);
    async function step(name,fn){await t.test(name,fn);results.push(name);}
    await step('dashboard opened as an extension tab is authorized',async()=>{const r=await api('LIST');assert.equal(r.ok,true,r.error);assert.ok(Array.isArray(r.result.tabs));assert.equal(await dashboard.locator('#message').innerText(),'');});
    const a=await context.newPage(),b=await context.newPage();await a.goto(fixtureUrl);await a.evaluate(()=>{document.title='Fixture A';});await b.goto(fixtureUrl);await b.evaluate(()=>{document.title='Fixture B';document.querySelector('#filter-name').value='B';document.querySelector('#filter-code').value='synthetic_B';});
    let tabs=await poll(()=>api('LIST'),r=>r.ok&&r.result.tabs.some(t=>t.title==='Fixture A')&&r.result.tabs.some(t=>t.title==='Fixture B'),'two native tabs');
    const aid=tabs.result.tabs.find(t=>t.title==='Fixture A').id,bid=tabs.result.tabs.find(t=>t.title==='Fixture B').id;
    const profileConfig={rootSelector:'#watch tbody',rowSelector:':scope > tr',cellSelector:':scope > td',symbolColumn:0,identityColumn:null,filterNameSelector:'#filter-name',filterCodeSelector:'#filter-code',coverage:'complete_verified'};
    const config={profile:profileConfig,intervalMs:200,stableMs:500,minConfirmations:2,keyframeMs:1000,protectMemory:false};
    await step('native DOM parses grouped headers and prefers the real instrument link',async()=>{
      const r=await api('PROBE_TAB',{tabId:aid,profile:profileConfig,config});assert.equal(r.ok,true,r.error);assert.deepEqual(r.result.current.headers,['نماد','معامله / قیمت','معامله / درصد']);assert.equal(r.result.current.rows[0].insCode,'35425587644337450');assert.equal(r.result.current.rows[0].identitySource,'instrument_link');
    });
    let ca,cb;
    await step('two tabs with the exact same URL record independently',async()=>{
      const both=await Promise.all([api('START_TAB',{tabId:aid,label:'ساختگی A',config}),api('START_TAB',{tabId:bid,label:'ساختگی B',config})]);assert.ok(both.every(r=>r.ok),JSON.stringify(both));[ca,cb]=both.map(r=>r.result.captureId);assert.notEqual(ca,cb);
      const sessions=await poll(()=>db('sessions'),ss=>ss.some(s=>s.captureId===ca&&s.frames>=3)&&ss.some(s=>s.captureId===cb&&s.frames>=3),'both recording');assert.equal(sessions.length,2);
    });
    await step('row reorder changes rank without false entry/exit',async()=>{
      await a.evaluate(()=>{const body=document.querySelector('#watch tbody');body.append(body.firstElementChild);});
      await poll(()=>db('frames'),fs=>fs.some(f=>f.payload.upsert.some(r=>r.symbol==='فملی'&&r.rank===3)),'reorder captured');
      assert.equal((await db('events')).filter(e=>['ENTER_OBSERVED','EXIT_OBSERVED'].includes(e.type)).length,0);
    });
    await step('disappearance and reappearance are kept without affecting the other tab',async()=>{
      await a.evaluate(()=>{window.savedRow=document.querySelector('#watch tbody tr[data-inscode="11111111111111111"]');savedRow.remove();});
      await poll(()=>db('events'),es=>es.some(e=>e.type==='ABSENT_CONFIRMED'&&e.key==='ins:11111111111111111'),'confirmed disappearance');
      await a.evaluate(()=>document.querySelector('#watch tbody').append(savedRow));
      const states=await poll(()=>db('states'),ss=>ss.some(s=>s.stats['ins:11111111111111111']?.reappearances===1),'reappearance');
      assert.equal(states.filter(s=>s.stats['ins:11111111111111111']?.reappearances===1).length,1);
    });
    await step('storage failure is visible, bounded, and recovers without a false ACK',async()=>{
      await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{globalThis.__testStorageSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw Error('SIMULATED_STORAGE_FAILURE');};}}),aid);
      const health=()=>worker.evaluate(async tabId=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.BorsaRecorder.health()});return r.result;},aid);
      await poll(health,h=>h.unsaved===8,'bounded unsaved queue');
      assert.ok((await health()).volatileBytes<=16*1024*1024);
      assert.ok((await db('events')).some(e=>e.type==='SAMPLER_STATUS'&&e.detail.error.includes('SIMULATED_STORAGE_FAILURE')));
      await worker.evaluate(async tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{chrome.storage.local.set=globalThis.__testStorageSet;delete globalThis.__testStorageSet;}}),aid);
      await poll(health,h=>h.unsaved===0&&h.pending===0,'recovered durable queue');
      await poll(()=>db('events'),es=>es.some(e=>e.type==='SAMPLING_BACKPRESSURE'),'explicit backpressure interval');
    });
    await step('a verified flag cannot pretend a virtualized table is complete',async()=>{
      const virtual={rootSelector:'#virtual',rowSelector:':scope > [role="row"]',cellSelector:'[role="gridcell"]',symbolColumn:0,coverage:'complete_verified'};
      await a.evaluate(()=>document.querySelector('#virtual').classList.remove('hidden'));const r=await api('PROBE_TAB',{tabId:aid,profile:virtual,config:{...config,profile:virtual}});assert.equal(r.result.current.status,'partial');await a.evaluate(()=>document.querySelector('#virtual').classList.add('hidden'));
    });
    await step('archive is a coherent native IndexedDB transaction while writes continue',async()=>{
      const out=await dashboard.evaluate(async()=>{const D=await import(chrome.runtime.getURL('db.js')),ss=await D.all('sessions');return D.archive(ss.map(s=>s.id));});
      assert.equal(out.consistency,'single_readonly_transaction');for(const s of out.sessions)assert.equal(s.frames,out.frames.filter(f=>f.sessionId===s.id).length);
    });
    await step('content-origin messages cannot invoke dashboard control commands',async()=>{
      const denied=await worker.evaluate(async tabId=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:()=>chrome.runtime.sendMessage({type:'LIST'})});return r.result;},aid);assert.equal(denied.ok,false);assert.equal(denied.code,'SENDER_NOT_ALLOWED');
      assert.equal((await api('PROBE_TAB',{tabId:await dashboard.evaluate(()=>chrome.tabs.getCurrent().then(t=>t.id)),profile:profileConfig})).ok,false);
    });
    let snapshot,job;
    await step('offscreen generates a real static XLSX and download completes',async()=>{
      const shot=await api('SNAPSHOT_TAB',{tabId:aid});assert.equal(shot.ok,true,shot.error);snapshot=shot.result;
      const exported=await api('EXPORT',{options:{sessionIds:[snapshot.sessionId],snapshotIds:[snapshot.id],format:'xlsx',mode:'static',view:'changes'}});assert.equal(exported.ok,true,exported.error);job=exported.result;
      const jobs=await poll(()=>db('jobs'),js=>js.some(j=>j.id===job.id&&['complete','error'].includes(j.status)),'XLSX download',40000);const finished=jobs.find(j=>j.id===job.id);assert.equal(finished.status,'complete',finished.error);
      const [item]=await worker.evaluate(async id=>chrome.downloads.search({id}),finished.downloadId);await fs.writeFile(path.join(output,'download-record.json'),JSON.stringify(item,null,2));
    });
    await step('manual refresh keeps historical data and records a new document',async()=>{
      const before=await db('frames'),oldDocs=new Set(before.filter(f=>f.sessionId===snapshot.sessionId).map(f=>f.docId));
      const refreshed=await api('REFRESH_TAB',{tabId:aid});assert.equal(refreshed.ok,true,refreshed.error);
      const fsx=await poll(()=>db('frames'),fs=>fs.some(f=>f.sessionId===snapshot.sessionId&&!oldDocs.has(f.docId)),'resumed after refresh');assert.ok(fsx.length>=before.length);assert.ok((await db('events')).some(e=>e.type==='DOCUMENT_CHANGED'));
    });
    await step('native IndexedDB reimport is idempotent and conflicting changes abort',async()=>{
      const r=await dashboard.evaluate(async()=>{
        const D=await import(chrome.runtime.getURL('db.js')),sessions=await D.all('sessions'),out=await D.archive(sessions.map(s=>s.id));const added=await D.importArchive(out);
        const conflict=structuredClone(out),f=conflict.frames.find(f=>f.payload.upsert.length);f.payload.upsert[0].cells[1]='CONFLICT';let rejected=false;try{await D.importArchive(conflict);}catch{rejected=true;}
        const stored=await D.get('frames',f.id);return {added,rejected,unchanged:stored.payload.upsert[0].cells[1]!=='CONFLICT'};
      });assert.equal(r.added,0);assert.equal(r.rejected,true);assert.equal(r.unchanged,true);
    });
    await step('stop flushes locally durable frames without a null-binding crash',async()=>{
      const stopped=await Promise.all([api('STOP_TAB',{tabId:aid}),api('STOP_TAB',{tabId:bid})]);assert.ok(stopped.every(r=>r.ok),JSON.stringify(stopped));
      await poll(()=>dashboard.evaluate(async()=>Object.keys(await chrome.storage.local.get(null)).filter(k=>k.startsWith('pending.')).length),n=>n===0,'durable queues drained');assert.equal((await api('LIST')).result.tabs.filter(t=>t.binding).length,0);
    });
    await step('worker restart preserves history and remains reachable from dashboard',async()=>{
      senderShapes=await worker.evaluate(()=>senderTrace.filter((s,i,a)=>a.findIndex(x=>x.type===s.type&&x.url===s.url)===i));
      const before=(await db('frames')).length,cdp=await context.newCDPSession(dashboard);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
      const listed=await poll(()=>api('LIST'),r=>r.ok,'worker wake');assert.ok(listed.result.sessions.length>=2);assert.equal((await db('frames')).length,before);await cdp.detach();
    });
    await dashboard.locator('#reload').click();await dashboard.screenshot({path:path.join(output,'dashboard.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    const summary={browser:context.browser().version(),version:'2.0.0',cases:results,senderShapes,fixtureOnly:true,liveTsetmcTested:false,pageErrors:errors};await fs.writeFile(path.join(output,'native-summary.json'),JSON.stringify(summary,null,2));
  }catch(e){if(dashboard)await dashboard.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
  finally{await context?.close();await fs.rm(profile,{recursive:true,force:true});}
});
