/* Runs only on explicit allowlisted global paths, in MAIN world. No eval/getters. */
export function pageMemory(action,paths,values){
  const forbidden=new Set(['__proto__','constructor','prototype','document','location','localStorage','sessionStorage']);
  const valid=p=>typeof p==='string'&&/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(p)&&!p.split('.').some(x=>forbidden.has(x));
  const plain=(v,seen=new Set(),depth=0)=>{
    if(depth>40)throw Error('عمق حافظه بیش از حد است.');
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(typeof v!=='object'||seen.has(v))throw Error('حافظه JSON ساده نیست یا ارجاع حلقوی دارد.');
    if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('Map/Set/Date/DOM و کلاس سفارشی پشتیبانی نمی‌شوند.');
    seen.add(v);const out=Array.isArray(v)?[]:{};
    const entries=Object.entries(Object.getOwnPropertyDescriptors(v));
    if(entries.length>150000)throw Error('تعداد اعضای حافظه بیش از حد است.');
    for(const [k,d] of entries){if(k==='length'&&Array.isArray(v))continue;if(forbidden.has(k)||!('value'in d))throw Error('عضو ناامن یا getter در حافظه.');if(!d.enumerable)continue;out[k]=plain(d.value,seen,depth+1);}
    seen.delete(v);return out;
  };
  if(!Array.isArray(paths)||paths.length>12||paths.some(p=>!valid(p)))return {ok:false,error:'مسیر حافظه نامعتبر'};
  const output={},errors=[];
  for(const path of paths){
    try{
      const parts=path.split('.');let target=window;
      for(const part of parts.slice(0,-1)){const d=Object.getOwnPropertyDescriptor(target,part);if(!d||!('value'in d)||!d.value||typeof d.value!=='object')throw Error('مسیر موجود/قابل‌خواندن نیست');target=d.value;}
      const key=parts.at(-1),descriptor=Object.getOwnPropertyDescriptor(target,key);
      if(action==='read'){
        if(!descriptor||!('value'in descriptor))throw Error('متغیر در window نیست یا getter است');output[path]=plain(descriptor.value);
      }else{
        if(!Object.prototype.hasOwnProperty.call(values||{},path))throw Error('پشتیبان این مسیر موجود نیست');
        const restored=plain(values[path]);
        if(descriptor&&!descriptor.writable)throw Error('متغیر فقط‌خواندنی است');
        if(descriptor&&!('value'in descriptor))throw Error('setter/getter مجاز نیست');
        if(!descriptor&&parts.length!==1)throw Error('ساخت شاخهٔ تو در تو مجاز نیست');
        Object.defineProperty(target,key,descriptor?{...descriptor,value:restored}:{value:restored,writable:true,configurable:true,enumerable:true});
        output[path]=plain(target[key]);
      }
    }catch(e){errors.push({path,error:e.message});}
  }
  if(JSON.stringify(output).length>2*1024*1024)return {ok:false,error:'حافظه بیش از ۲ مگابایت است'};
  return {ok:!errors.length,values:output,errors};
}
