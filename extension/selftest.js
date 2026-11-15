import {buildReport} from './report.js';
const C=globalThis.BorsaCore,A=globalThis.BorsaAdapter,list=document.querySelector('#results');
const assert=(name,value)=>{const li=document.createElement('li');li.textContent=`${value?'قبول':'خطا'}: ${name}`;li.style.color=value?'#00756e':'#b12b35';list.append(li);if(!value)throw Error(name);};
try{
  const profile={rootSelector:'#fixture tbody',rowSelector:':scope > tr',cellSelector:':scope > td',symbolColumn:0,sourceTimeSelector:'#mockClock',coverage:'complete_verified'};
  const config=C.settings({profile}),first=A.read(profile,config),at=Date.now();
  assert('تشخیص دو سطر و عناوین اصلی',first.rows.length===2&&first.headers.join('|')==='نماد|قیمت|درصد');
  assert('InsCode شانزده/هفده رقمی به عنوان متن',first.rows[0].insCode==='35425587644337450'&&first.rows[1].insCode==='11111111111111111');
  assert('ترتیب فارسی عکس داده',C.sortRows(first.rows)[0].symbol==='آباد');
  const f={...first,at,docId:'synthetic',seq:1},initial=C.step(null,f,config),body=document.querySelector('#fixture tbody');body.prepend(body.lastElementChild);
  const reordered=A.read(profile,config),next=C.step(initial.state,{...reordered,at:at+1000,docId:'synthetic',seq:2},config);
  assert('جابجایی سطر بدون ورود و خروج جعلی',!next.events.some(e=>e.type==='ENTER_OBSERVED'||e.type==='EXIT_OBSERVED'));
  const missing=A.read({...profile,rootSelector:'#not-present'},config);assert('گم‌شدن جدول به عنوان قطعی',missing.status==='missing_root');
  const empty=body.cloneNode(true);body.replaceChildren();assert('جدول خالی بدون ادعای خروج قطعی',A.read(profile,config).status==='empty_unverified');body.replaceChildren(...empty.childNodes);
  const session={id:'DEMO_SYNTHETIC',captureId:'DEMO',label:'دادهٔ ساختگی تست',jalali:C.time(at).jalali,day:C.time(at).day,declaredVersion:'DEMO',filterFingerprint:'0'.repeat(64),config,url:'synthetic fixture — no market data'};
  document.querySelector('#sample').disabled=false;document.querySelector('#sample').onclick=()=>{
    const data={sessions:[session],frames:[{...f,id:'demo-f1',sessionId:session.id,receivedAt:at+1,payload:initial.payload}],events:initial.events.map(e=>({...e,sessionId:session.id})),snapshots:[{...f,id:'demo-s1',sessionId:session.id}]};
    const report=buildReport(data,{mode:'both'}),url=URL.createObjectURL(report.blob),a=document.createElement('a');a.href=url;a.download='DEMO_SYNTHETIC_'+report.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
}catch(e){const p=document.createElement('p');p.textContent=`آزمون متوقف شد: ${e.message}`;list.append(p);}
