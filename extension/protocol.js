/* Route by verified extension URL first. sender.tab does not mean content script. */
(() => {
  'use strict';
  const channel='borsa.recorder.v2';
  const roles={
    content:new Set(['HELLO','INGEST','MAP']),
    dashboard:new Set(['LIST','SAVE_DRAFT','START_TAB','STOP_TAB','PROBE_TAB','PICK_TAB','SNAPSHOT_TAB','REFRESH_TAB','DIAG_TAB','EXPORT','CHECKPOINT_TAB']),
    offscreen:new Set(['DOWNLOAD','EXPORT_PROGRESS','EXPORT_FINISHED'])
  };
  const allowedSite=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&(u.hostname==='tsetmc.com'||u.hostname.endsWith('.tsetmc.com'));}catch{return false;}};
  function classify(sender,id){
    if(!sender||sender.id!==id)return 'foreign';
    let url;try{url=new URL(sender.url);}catch{return 'unknown';}
    if(url.protocol==='chrome-extension:'&&url.hostname===id){
      if(url.pathname==='/dashboard.html')return 'dashboard';
      if(url.pathname==='/offscreen.html')return 'offscreen';
      return 'extension_other';
    }
    if(allowedSite(sender.url)&&Number.isInteger(sender.tab?.id)&&sender.frameId===0)return 'content';
    return 'foreign';
  }
  function authorize(message,sender,id){
    if(!message||typeof message!=='object'||typeof message.type!=='string')throw Object.assign(Error('ساختار پیام معتبر نیست.'),{code:'INVALID_MESSAGE'});
    const role=classify(sender,id);
    if(!roles[role]?.has(message.type))throw Object.assign(Error(`پیام ${message.type} از این بخش مجاز نیست (${role}).`),{code:'SENDER_NOT_ALLOWED'});
    return role;
  }
  function fromWorker(sender,id){
    if(sender?.id!==id||sender.tab)return false;
    if(!sender.url)return true;
    try{const u=new URL(sender.url);return u.protocol==='chrome-extension:'&&u.hostname===id&&['/worker.js','/'].includes(u.pathname);}catch{return false;}
  }
  globalThis.BorsaProtocol={channel,roles,allowedSite,classify,authorize,fromWorker};
})();
