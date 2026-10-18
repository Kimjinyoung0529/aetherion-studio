/* AETHERION Native Generator 0.3 — direct WebGPU token generation.
 * Model was trained offline with PyTorch; browser inference is handwritten WGSL.
 * Not PrismML Bonsai 2 and not a general-purpose LLM.
 */
'use strict';
const PARTS=['E','P','wq','wk','wv','wo','fc1','fc1b','fc2','fc2b','outb'];
const OFFSETS=[0,3232,4000,4256,4512,4768,5024,5536,5568,6080,6096];
function unpackToyModel(raw){
 if(raw?.version!=='native-generator-0.2'||raw.d_model!==16||raw.ffn!==32||raw.context!==48||raw.vocab?.length!==202)throw Error('학습 모델 구조 불일치');
 const bytes=Uint8Array.from(atob(raw.quantized_weights_b64),x=>x.charCodeAt(0));
 if(bytes.length!==6298)throw Error('모델 가중치 길이 오류');
 const words=new Uint32Array(Math.ceil(bytes.length/4));
 for(let i=0;i<bytes.length;i++)words[i>>>2]|=(bytes[i]<<((i%4)*8));
 const scales=new Float32Array(PARTS.map((name,i)=>{
  if(raw.offsets[name]?.[0]!==OFFSETS[i])throw Error('오프셋 오류 '+name);
  return raw.scales[name];
 }));
 return {raw,bytes,words,scales};
}
function quant(p,name,index){
 const i=PARTS.indexOf(name),info=p.raw.offsets[name];
 if(i<0||index<0||index>=info[1])throw Error('잘못된 가중치 인덱스');
 const n=p.bytes[info[0]+index];
 return (n>=128?n-256:n)*p.scales[i];
}
function normalize16(a){
 let mean=0;for(let i=0;i<16;i++)mean+=a[i];mean/=16;
 let variance=0;for(let i=0;i<16;i++)variance+=(a[i]-mean)**2;
 const inv=1/Math.sqrt(variance/16+0.00001);
 return a.map(v=>(v-mean)*inv);
}
function cpuToyLogits(p,ids){
 const a=ids.slice(-48),T=a.length;
 if(!T)throw Error('토큰 없음');
 const e=pos=>Array.from({length:16},(_,d)=>quant(p,'E',a[pos]*16+d)+quant(p,'P',pos*16+d));
 const linear=(name,input)=>{
  const v=new Array(16);
  for(let row=0;row<16;row++){let z=0;for(let col=0;col<16;col++)z+=quant(p,name,row*16+col)*input[col];v[row]=z;}
  return v;
 };
 const residual=e(T-1),q=linear('wq',normalize16(residual));
 const scores=[],values=[];
 for(let pos=0;pos<T;pos++){
  const x=normalize16(e(pos)),k=linear('wk',x),v=linear('wv',x);
  let score=0;for(let d=0;d<16;d++)score+=q[d]*k[d];
  scores.push(score/4);values.push(v);
 }
 const peak=Math.max(...scores),probs=scores.map(s=>Math.exp(s-peak)),denom=probs.reduce((s,v)=>s+v,0);
 const ctx=Array.from({length:16},(_,d)=>values.reduce((s,v,pos)=>s+probs[pos]*v[d],0)/denom);
 const proj=linear('wo',ctx),h=residual.map((v,d)=>v+proj[d]);
 const mid=normalize16(h);
 const ff=Array.from({length:32},(_,row)=>{
  let z=quant(p,'fc1b',row);
  for(let col=0;col<16;col++)z+=quant(p,'fc1',row*16+col)*mid[col];
  return Math.max(0,z);
 });
 const z=h.map((v,row)=>{
  let addition=quant(p,'fc2b',row);
  for(let col=0;col<32;col++)addition+=quant(p,'fc2',row*32+col)*ff[col];
  return v+addition;
 });
 const out=normalize16(z);
 return Float32Array.from(Array.from({length:202},(_,tok)=>{
  let value=quant(p,'outb',tok);
  for(let d=0;d<16;d++)value+=quant(p,'E',tok*16+d)*out[d];
  return value;
 }));
}
class AetherionNativeGenerator{
 constructor(){
  this.device=null;this.adapter=null;this.pipeline=null;this.buffers=[];this.lookup=new Map();
  this.model=null;this.packed=null;this.lost=false;this.binding=null;
 }
 encode(text){return Array.from(String(text)).map(c=>this.lookup.get(c)??0);}
 async init(raw,shader){
  this.model=raw;this.packed=unpackToyModel(raw);
  this.lookup=new Map(raw.vocab.map((token,i)=>[token,i]));
  if(!isSecureContext||!navigator.gpu)throw Error('HTTPS와 WebGPU가 필요합니다');
  this.adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
  if(!this.adapter)throw Error('WebGPU 장치 없음');
  this.device=await this.adapter.requestDevice();
  const dev=this.device;
  dev.lost.then(()=>{this.lost=true;this.pipeline=null;});
  const module=dev.createShaderModule({code:shader});
  const report=await module.getCompilationInfo();
  const problems=report.messages.filter(x=>x.type==='error');
  if(problems.length)throw Error('WGSL 컴파일 오류: '+problems.map(x=>x.message).join('; ').slice(0,800));
  this.pipeline=await dev.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  const U=GPUBufferUsage;
  const upload=(data,mode)=>{
   const b=dev.createBuffer({size:data.byteLength,usage:mode|U.COPY_DST});
   dev.queue.writeBuffer(b,0,data);this.buffers.push(b);return b;
  };
  this.tokens=upload(new Uint32Array(48),U.STORAGE);
  this.weights=upload(this.packed.words,U.STORAGE);
  this.scales=upload(this.packed.scales,U.STORAGE);
  this.options=upload(new Uint32Array([1,0,0,0]),U.UNIFORM);
  this.output=dev.createBuffer({size:202*4,usage:U.STORAGE|U.COPY_SRC});
  this.readback=dev.createBuffer({size:202*4,usage:U.COPY_DST|U.MAP_READ});
  this.buffers.push(this.output,this.readback);
  this.binding=dev.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:this.tokens}},{binding:1,resource:{buffer:this.weights}},
   {binding:2,resource:{buffer:this.scales}},{binding:3,resource:{buffer:this.output}},
   {binding:4,resource:{buffer:this.options}}
  ]});
  return [this.adapter.info?.vendor,this.adapter.info?.device].filter(Boolean).join(' / ')||'GPU';
 }
 async forward(tokens){
  if(!this.pipeline||this.lost)throw Error('WebGPU 엔진 연결이 끊어졌습니다');
  const arr=tokens.slice(-48);
  if(!arr.length)throw Error('빈 토큰 배열');
  const input=new Uint32Array(48);input.set(arr);
  this.device.queue.writeBuffer(this.tokens,0,input);
  this.device.queue.writeBuffer(this.options,0,new Uint32Array([arr.length,0,0,0]));
  const t=performance.now(),encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.binding);pass.dispatchWorkgroups(1);pass.end();
  encoder.copyBufferToBuffer(this.output,0,this.readback,0,202*4);
  this.device.queue.submit([encoder.finish()]);
  await this.readback.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(this.readback.getMappedRange().slice(0));
  this.readback.unmap();
  for(const n of values)if(!Number.isFinite(n))throw Error('GPU 결과에 NaN/Inf가 있습니다');
  return {logits:values,ms:performance.now()-t};
 }
 async verify(){
  let maxError=0,elapsed=0;
  const probes=['Q: 안녕\nA: ','Q: 너 누구야\nA: ','Q: WebGPU가 뭐야\nA: '];
  for(const q of probes){
   const ids=this.encode(q),reference=cpuToyLogits(this.packed,ids);
   const gpu=await this.forward(ids);elapsed+=gpu.ms;
   let a=0,b=0;
   for(let i=0;i<reference.length;i++){
    maxError=Math.max(maxError,Math.abs(reference[i]-gpu.logits[i]));
    if(reference[i]>reference[a])a=i;
    if(gpu.logits[i]>gpu.logits[b])b=i;
   }
   if(a!==b)throw Error('GPU/CPU 상위 토큰 불일치: '+this.model.vocab[a]+' / '+this.model.vocab[b]);
  }
  if(maxError>0.08)throw Error('GPU/CPU 로그잇 오차가 너무 큽니다: '+maxError.toFixed(5));
  return {maxError,avgMs:elapsed/probes.length};
 }
 async *generate(question,{maxTokens=72,temperature=0.3}={}){
  const ids=this.encode('Q: '+String(question).slice(0,120)+'\nA: ');
  const temp=Math.max(0,Number(temperature)||0);
  for(let i=0;i<maxTokens;i++){
   const {logits,ms}=await this.forward(ids);
   let index=0;
   if(temp===0){
    for(let k=1;k<logits.length;k++)if(logits[k]>logits[index])index=k;
   }else{
    const best=Array.from({length:logits.length},(_,k)=>({k,score:logits[k]})).sort((a,b)=>b.score-a.score).slice(0,8);
    const peak=best[0].score,probs=best.map(x=>Math.exp((x.score-peak)/temp));
    let threshold=Math.random()*probs.reduce((a,b)=>a+b,0);index=best[0].k;
    for(let k=0;k<best.length;k++){threshold-=probs[k];if(threshold<=0){index=best[k].k;break;}}
   }
   const token=this.model.vocab[index];
   if(token==='\n')return;
   ids.push(index);
   if(token==='<unk>')continue;
   yield {token,step:i+1,ms};
  }
 }
 dispose(){
  for(const b of this.buffers){try{b.destroy()}catch{}}
  this.buffers=[];try{this.device?.destroy()}catch{}
  this.device=null;this.pipeline=null;this.lost=true;
 }
}
if(typeof window!=='undefined')window.AetherionNativeGenerator=AetherionNativeGenerator;
