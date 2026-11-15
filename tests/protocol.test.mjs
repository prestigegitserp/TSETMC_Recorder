import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/protocol.js';
const P=globalThis.BorsaProtocol,id='abcdefghijklmnopabcdefghijklmnop';
const dashboard={id,url:`chrome-extension://${id}/dashboard.html?window=9`,frameId:0,tab:{id:14}};
const content={id,url:'https://old.tsetmc.com/Loader.aspx?ParTree=15131F',frameId:0,tab:{id:7}};
test('dashboard in a browser tab is trusted as dashboard, never as site content',()=>{
  assert.equal(P.classify(dashboard,id),'dashboard');assert.equal(P.authorize({type:'LIST'},dashboard,id),'dashboard');assert.equal(P.authorize({type:'START_TAB'},dashboard,id),'dashboard');
});
test('offscreen download is recognized even if Chrome supplies a tab property',()=>{
  const sender={...dashboard,url:`chrome-extension://${id}/offscreen.html`};assert.equal(P.authorize({type:'DOWNLOAD'},sender,id),'offscreen');assert.throws(()=>P.authorize({type:'LIST'},sender,id));
});
test('content scripts may append observations but cannot invoke dashboard controls',()=>{
  assert.equal(P.authorize({type:'INGEST'},content,id),'content');assert.equal(P.authorize({type:'HELLO'},content,id),'content');assert.throws(()=>P.authorize({type:'START_TAB'},content,id));assert.throws(()=>P.authorize({type:'DOWNLOAD'},content,id));
});
test('foreign extension IDs, misleading domains and subframes stay blocked',()=>{
  for(const sender of [{...dashboard,id:'foreign'},{...content,url:'https://tsetmc.com.evil.example/'},{...content,frameId:3},{...dashboard,url:'https://old.tsetmc.com/dashboard.html'},{...dashboard,url:`chrome-extension://${id}/dashboard.html/extra`}])assert.throws(()=>P.authorize({type:'LIST'},sender,id));
  assert.throws(()=>P.authorize({type:'INGEST'},{...content,frameId:2},id));
});
test('only extension worker contexts may control a content script or exporter',()=>{
  assert.equal(P.fromWorker({id,url:`chrome-extension://${id}/worker.js`},id),true);
  assert.equal(P.fromWorker({id},id),true);assert.equal(P.fromWorker(dashboard,id),false);assert.equal(P.fromWorker(content,id),false);
});
test('missing and unknown messages fail closed with a diagnostic error code',()=>{
  assert.throws(()=>P.authorize(null,dashboard,id),e=>e.code==='INVALID_MESSAGE');assert.throws(()=>P.authorize({type:'ANYTHING'},dashboard,id),e=>e.code==='SENDER_NOT_ALLOWED');
});
