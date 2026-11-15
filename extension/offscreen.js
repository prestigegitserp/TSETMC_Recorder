import * as DB from './db.js';
import './core.js';
import './protocol.js';
import {buildReport} from './report.js';
const C=globalThis.BorsaCore,urls=new Map(),building=new Set();
async function run(id){
  if(building.has(id))return;building.add(id);let job=await DB.get('jobs',id);
  try{
    if(!job||['complete','downloading'].includes(job.status))return;
    job={...job,status:'building',updatedAt:Date.now()};await DB.put('jobs',job);
    const data=await DB.archive(job.options.sessionIds,{staticOnly:job.options.format==='xlsx'&&job.options.mode==='static'}),captures=new Set(data.sessions.map(s=>s.captureId));
    data.systemEvents=(data.systemEvents||[]).filter(e=>captures.has(e.captureId)).map(e=>({...e,captureLabel:data.captures.find(c=>c.id===e.captureId)?.label||''}));
    let blob,filename;
    if(job.options.format==='json'){
      blob=new Blob([JSON.stringify(data)],{type:'application/json'});const days=data.sessions.map(s=>s.jalali).sort();filename=`BORSA_ARCHIVE_${days[0]}_to_${days.at(-1)}_${C.time(Date.now()).local.slice(11).replace(/[:.]/g,'')}_s${C.hash(job.options.sessionIds.join('|'))}.json`;
    }else ({blob,filename}=buildReport(data,job.options));
    const url=URL.createObjectURL(blob);urls.set(id,url);
    const reply=await chrome.runtime.sendMessage({channel:globalThis.BorsaProtocol.channel,type:'DOWNLOAD',jobId:id,url,filename});if(!reply?.ok)throw Error(reply?.error||'بارگیری شروع نشد.');
  }catch(e){await DB.put('jobs',{...job,status:'error',error:e.message,updatedAt:Date.now()});if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id);}}
  finally{building.delete(id);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.target!=='offscreen'||!globalThis.BorsaProtocol.fromWorker(sender,chrome.runtime.id))return false;
  if(m.type==='RUN_EXPORT'){run(m.jobId);reply({accepted:true});}
  if(m.type==='REVOKE'){const url=urls.get(m.jobId);if(url)URL.revokeObjectURL(url);urls.delete(m.jobId);reply({revoked:true});}
  return false;
});
