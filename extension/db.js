import './core.js';
const DB_NAME='borsa-recorder-v1'; // Keep v1 data when updating the same extension ID.
let opened;
export const stores=['captures','sessions','frames','events','states','snapshots','checkpoints','jobs','profiles'];
export function openDB(){
  if(opened)return opened;
  opened=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,2);
    r.onupgradeneeded=()=>{
      for(const name of stores){if(r.result.objectStoreNames.contains(name))continue;const s=r.result.createObjectStore(name,{keyPath:'id'});if(['frames','events','snapshots'].includes(name))s.createIndex('sessionId','sessionId');}
    };
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opened=null;};resolve(r.result);};r.onerror=()=>{opened=null;reject(r.error);};
    r.onblocked=()=>{opened=null;reject(Error('پایگاه داده توسط نسخهٔ دیگری باز مانده است.'));};
  });return opened;
}
export const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export function completion(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('تراکنش لغو شد.'));});}
export async function get(store,id){const db=await openDB();return request(db.transaction(store).objectStore(store).get(id));}
export async function all(store){const db=await openDB();return request(db.transaction(store).objectStore(store).getAll());}
export async function put(store,value){const db=await openDB(),tx=db.transaction(store,'readwrite'),done=completion(tx);tx.objectStore(store).put(value);await done;return value;}
export async function bySession(store,id){const db=await openDB();return request(db.transaction(store).objectStore(store).index('sessionId').getAll(id));}
export async function commitFrame(session,frame,events,state,capture){
  const db=await openDB(),tx=db.transaction(['captures','sessions','frames','events','states'],'readwrite'),done=completion(tx);
  tx.objectStore('sessions').put(session);tx.objectStore('frames').add(frame);
  events.forEach((e,i)=>tx.objectStore('events').put({...e,id:`${frame.id}:e${i}`,sessionId:session.id,frameId:frame.id}));
  tx.objectStore('states').put({...state,id:session.id});
  if(capture)tx.objectStore('captures').put(capture);
  await done;
}
export async function archive(ids,options={}){
  const db=await openDB(),tx=db.transaction(['sessions','frames','events','snapshots','states','captures','checkpoints','profiles'],'readonly'),done=completion(tx);
  try{
    const sessions=(await Promise.all([...new Set(ids)].map(id=>request(tx.objectStore('sessions').get(id))))).filter(Boolean);
    const readSession=name=>Promise.all(sessions.map(s=>request(tx.objectStore(name).index('sessionId').getAll(s.id)))).then(rows=>rows.flat());
    const captureIds=[...new Set(sessions.map(s=>s.captureId))];
    const [frames,events,snapshots,states,captures,checkpoints,profiles]=await Promise.all([
      options.staticOnly?[]:readSession('frames'),options.staticOnly?[]:readSession('events'),readSession('snapshots'),
      options.staticOnly?[]:Promise.all(sessions.map(s=>request(tx.objectStore('states').get(s.id)))).then(rows=>rows.filter(Boolean)),
      Promise.all(captureIds.map(id=>request(tx.objectStore('captures').get(id)))).then(rows=>rows.filter(Boolean)),
      Promise.all(captureIds.map(id=>request(tx.objectStore('checkpoints').get(id)))).then(rows=>rows.filter(Boolean)),
      request(tx.objectStore('profiles').getAll())
    ]);
    // Capture-scope events belong to the same transaction as the data they describe.
    const systemEvents=(await Promise.all(captureIds.map(id=>request(tx.objectStore('events').index('sessionId').getAll(`system:${id}`))))).flat();
    await done;
    return {format:'borsa-recorder-archive',schema:1,version:globalThis.BorsaCore.version,exportedAt:new Date().toISOString(),consistency:'single_readonly_transaction',sessions,frames,events,snapshots,states,captures,checkpoints,systemEvents,profiles:profiles.filter(p=>sessions.some(s=>s.label===p.label))};
  }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
}
export async function importArchive(data){
  if(data?.format!=='borsa-recorder-archive'||data.schema!==1)throw Error('نسخه یا فرمت آرشیو ناشناخته است.');
  const C=globalThis.BorsaCore;
  const sessionIds=new Set((data.sessions||[]).map(s=>s.id)),captureIds=new Set((data.sessions||[]).map(s=>s.captureId));
  data={...data,events:[...(data.events||[]),...(data.systemEvents||[])],captures:data.captures||[],profiles:data.profiles||[]};
  for(const name of ['sessions','frames','events','snapshots','captures','profiles']){
    if(!Array.isArray(data[name])||data[name].length>2000000)throw Error('آرشیو نامعتبر یا بسیار بزرگ است.');
    for(const x of data[name])if(typeof x.id!=='string'||!x.id||x.id.length>300||(!['sessions','captures','profiles'].includes(name)&&!sessionIds.has(x.sessionId)&&!(name==='events'&&captureIds.has(x.captureId)&&x.sessionId===`system:${x.captureId}`)))throw Error('ارجاع ناقص در آرشیو.');
  }
  for(const s of data.sessions){if(typeof s.label!=='string'||!Number.isFinite(s.startedAt)||!Number.isFinite(s.endedAt)||!Number.isFinite(s.frames)||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||typeof s.filterFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.filterFingerprint)||!s.config)throw Error('فرادادهٔ نشست نامعتبر است.');C.settings(s.config);}
  for(const f of data.frames){
    if(!f.payload||!['keyframe','delta','late'].includes(f.payload.kind)||!Array.isArray(f.payload.removed)||!Array.isArray(f.payload.order)||f.payload.order.length>15000||!Number.isFinite(f.receivedAt))throw Error('ساختار فریم آرشیو نامعتبر است.');
    C.validateFrame({...f,rows:f.payload.upsert});
  }
  for(const s of data.snapshots)C.validateFrame({...s,seq:1,docId:s.docId||'archive'});
  for(const e of data.events)if(typeof e.type!=='string'||!Number.isFinite(e.at))throw Error('رویداد آرشیو نامعتبر است.');
  for(const c of data.captures)if(!captureIds.has(c.id))throw Error('ضبط غیرمرتبط در آرشیو.');
  for(const p of data.profiles){if(typeof p.label!=='string'||!p.config||typeof p.scope!=='string')throw Error('قالب ضبط نامعتبر است.');const u=new URL(p.scope);if(!['http:','https:'].includes(u.protocol)||!(u.hostname==='tsetmc.com'||u.hostname.endsWith('.tsetmc.com')))throw Error('دامنهٔ قالب ضبط مجاز نیست.');C.settings(p.config);}
  // Immutable observations never overwrite a conflicting local observation.
  const db=await openDB(),tx=db.transaction(['sessions','frames','events','snapshots','captures','profiles'],'readwrite'),done=completion(tx);
  let added=0;
  try{
    for(const name of ['sessions','frames','events','snapshots','captures','profiles'])for(const x of data[name]){
      const s=tx.objectStore(name),old=await request(s.get(x.id));
      if(!old){s.add(x);added++;}
      else if(!['sessions','captures','profiles'].includes(name)&&JSON.stringify(old)!==JSON.stringify(x))throw Error(`تعارض داده با شناسه ${x.id}`);
    }
    for(const incoming of data.sessions){
      const s=tx.objectStore('sessions'),current=await request(s.get(incoming.id));
      if(current.filterFingerprint!==incoming.filterFingerprint)throw Error('هویت نشست هم‌شناسه متعارض است.');
      const frames=await request(tx.objectStore('frames').index('sessionId').count(incoming.id));
      const snapshots=await request(tx.objectStore('snapshots').index('sessionId').count(incoming.id));
      s.put({...current,startedAt:Math.min(current.startedAt,incoming.startedAt),endedAt:Math.max(current.endedAt,incoming.endedAt),frames,snapshots});
    }
  }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
  await done;return added;
}
