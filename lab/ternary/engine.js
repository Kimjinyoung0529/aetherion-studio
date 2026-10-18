// AETHERION Ternary WebGPU Core 0.1
// Original WGSL kernels: 2-bit (16 trits/u32) and dense base-3 (20 trits/u32).
// Deliberately NOT a PrismML / Bonsai 2 / GGUF loader or a generative LLM.
'use strict';
const $ = id => document.getElementById(id);
const shader = [
'struct Info {rows:u32,cols:u32,words_per_row:u32,format:u32};',
'@group(0) @binding(0) var<storage,read> input: array<f32>;',
'@group(0) @binding(1) var<storage,read> packed: array<u32>;',
'@group(0) @binding(2) var<storage,read> scale: array<f32>;',
'@group(0) @binding(3) var<storage,read_write> output: array<f32>;',
'@group(0) @binding(4) var<uniform> info: Info;',
'@compute @workgroup_size(64)',
'fn main(@builtin(global_invocation_id) gid:vec3<u32>) {',
'  let row=gid.x;',
'  if(row>=info.rows) {return;}',
'  var acc:f32=0.0;',
'  for(var col:u32=0u;col<info.cols;col=col+1u) {',
'    var trit:u32=0u;',
'    if(info.format==0u) {',
'      let word=packed[row*info.words_per_row+(col/16u)];',
'      trit=(word>>((col%16u)*2u))&3u;',
'    } else {',
'      let word=packed[row*info.words_per_row+(col/20u)];',
'      let slot=col%20u;',
'      let octet=(word>>((slot/5u)*8u))&255u;',
'      var power:u32=1u;',
'      for(var i:u32=0u;i<slot%5u;i=i+1u){power=power*3u;}',
'      trit=(octet/power)%3u;',
'    }',
'    // 0 => -1; 1 => 0; 2 => +1',
'    acc=acc+f32(i32(trit)-1)*input[col];',
'  }',
'  output[row]=acc*scale[row];',
'}'
].join('\n');
let device=null,adapter=null,pipeline=null,active=false,seed=0x57a9be;
const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const trit=()=>{let r=rand()%100;return r<33?0:r<66?1:2};
const now=()=>performance.now();
function report(text,level='normal') {
 const el=$('state');el.textContent=text;el.dataset.level=level;
}
function log(text){
 const out=$('logs');const p=document.createElement('p');
 p.textContent=new Date().toLocaleTimeString()+'  '+text;
 out.prepend(p);while(out.childElementCount>12)out.lastElementChild.remove();
}
function explainBytes(bytes){return (bytes/1024).toFixed(1)+' KiB'}
function setValue(id,value){$(id).textContent=value;}
function pack(rows,cols,format) {
 const perWord=format===0?16:20;
 const wordsPerRow=Math.ceil(cols/perWord);
 const weights=new Uint32Array(rows*wordsPerRow);
 const source=new Int8Array(rows*cols);
 const scales=new Float32Array(rows);
 const vec=new Float32Array(cols);
 let negative=0,zero=0,positive=0;
 seed=0x57a9be;
 for(let c=0;c<cols;c++)vec[c]=((rand()%2001)-1000)/1000;
 for(let r=0;r<rows;r++){
  scales[r]=Math.fround(0.18+(rand()%700)/1000);
  for(let c=0;c<cols;c++){
   const raw=trit(),i=r*cols+c;
   source[i]=raw-1;
   if(raw===0)negative++;else if(raw===1)zero++;else positive++;
   const wordIndex=r*wordsPerRow+Math.floor(c/perWord);
   let value;
   if(format===0){
    value=(raw << ((c%16)*2))>>>0;
   }else{
    const pos=c%20;
    const byte=Math.floor(pos/5);
    const digit=pos%5;
    const pow=[1,3,9,27,81][digit];
    value=(raw*pow) << (byte*8);
   }
   weights[wordIndex]=(weights[wordIndex]|value)>>>0;
  }
 }
 return {weights,source,scales,vec,rows,cols,wordsPerRow,negative,zero,positive,format};
}
function decode(p,r,c){
 const per=p.format===0?16:20;
 const index=r*p.wordsPerRow+Math.floor(c/per);
 const w=p.weights[index];
 if(p.format===0)return ((w>>>((c%16)*2))&3)-1;
 const local=c%20;
 const octet=(w >>> (Math.floor(local/5)*8))&255;
 return Math.floor(octet/[1,3,9,27,81][local%5])%3-1;
}
function validatePacking(p){
 for(let r=0;r<p.rows;r++){
  for(let c=0;c<p.cols;c++){
   if(decode(p,r,c)!==p.source[r*p.cols+c]){
    throw new Error('압축-복원 검증 불일치: row '+r+', col '+c);
   }
  }
 }
 return true;
}
async function connectGPU(){
 if(device)return device;
 if(!isSecureContext||!navigator.gpu)throw Error('HTTPS/WebGPU가 필요합니다. 현재 브라우저에서 사용할 수 없습니다.');
 adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('WebGPU 어댑터가 없습니다.');
 device=await adapter.requestDevice();
 device.lost.then(info=>{
  log('GPU 장치 손실: '+(info.message||info.reason));
  report('GPU 연결 해제','error');device=null;pipeline=null;
 });
 const module=device.createShaderModule({code:shader});
 const compilation=await module.getCompilationInfo();
 const err=compilation.messages.filter(x=>x.type==='error');
 if(err.length)throw Error('WGSL 컴파일 실패: '+err.map(x=>x.message).join(' / '));
 pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 const name=[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'GPU';
 setValue('gpuName',name);
 log('자체 WGSL Compute Pipeline 준비 완료 · '+name);
 return device;
}
function gpuBuffer(array,usage){
 const b=device.createBuffer({size:Math.max(4,array.byteLength),usage:usage|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(b,0,array);
 return b;
}
function execute(p){
 const bufIn=gpuBuffer(p.vec,GPUBufferUsage.STORAGE);
 const bufWeights=gpuBuffer(p.weights,GPUBufferUsage.STORAGE);
 const bufScale=gpuBuffer(p.scales,GPUBufferUsage.STORAGE);
 const bufOut=device.createBuffer({size:p.rows*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const bufRead=device.createBuffer({size:p.rows*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const inf=gpuBuffer(new Uint32Array([p.rows,p.cols,p.wordsPerRow,p.format]),GPUBufferUsage.UNIFORM);
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:bufIn}},
  {binding:1,resource:{buffer:bufWeights}},
  {binding:2,resource:{buffer:bufScale}},
  {binding:3,resource:{buffer:bufOut}},
  {binding:4,resource:{buffer:inf}}
 ]});
 const buffers=[bufIn,bufWeights,bufScale,bufOut,bufRead,inf];
 async function dispatch(){
  const t=now(),enc=device.createCommandEncoder();
  const pass=enc.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(Math.ceil(p.rows/64));pass.end();
  enc.copyBufferToBuffer(bufOut,0,bufRead,0,p.rows*4);
  device.queue.submit([enc.finish()]);
  await bufRead.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(bufRead.getMappedRange().slice(0));
  bufRead.unmap();
  return {values,elapsed:now()-t};
 }
 return {dispatch,dispose:()=>buffers.forEach(b=>b.destroy())};
}
function verifyOutputs(p,values){
 let worst=0,worstRow=0;
 // Full per-row CPU verification (no GPU fallback; used solely as ground truth).
 const start=now();
 for(let r=0;r<p.rows;r++){
  let acc=0;
  for(let c=0;c<p.cols;c++)acc+=p.source[r*p.cols+c]*p.vec[c];
  const ref=acc*p.scales[r];
  const error=Math.abs(ref-values[r]);
  if(error>worst){worst=error;worstRow=r;}
  if(!Number.isFinite(error))throw Error('GPU output contains a nonfinite number');
 }
 const cpuMs=now()-start;
 return {worst,worstRow,cpuMs,passed:worst<=0.01};
}
function median(nums){let sorted=[...nums].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]}
async function run(){
 if(active)return;
 active=true;$('run').disabled=true;report('WebGPU 준비 중…');
 let ctx=null;
 try{
  await connectGPU();
  const dim=Number($('dimension').value);
  const format=Number($('packing').value);
  if(![320,640,1280].includes(dim)||![0,1].includes(format))throw Error('설정값이 올바르지 않습니다.');
  report('삼진 가중치 준비·압축 중…');
  await new Promise(resolve=>setTimeout(resolve,35));
  const data=pack(dim,dim,format);
  validatePacking(data);
  const total=data.weights.byteLength+data.scales.byteLength;
  const rawFp16=dim*dim*2;
  setValue('parameters',(dim*dim).toLocaleString());
  setValue('weightBytes',explainBytes(data.weights.byteLength));
  setValue('compression',(rawFp16/data.weights.byteLength).toFixed(2)+'× (FP16 대비, 스케일 별도)');
  setValue('distribution',data.negative.toLocaleString()+' / '+data.zero.toLocaleString()+' / '+data.positive.toLocaleString());
  log('삼진 압축/복원 검증 통과 · '+data.weights.byteLength+' bytes · '+(format===0?'2-bit slots':'5-trits/byte'));
  report('GPU 연산 실행 중…');
  ctx=execute(data);
  await ctx.dispatch(); // warmup
  const times=[],count=4;
  let last;
  for(let i=0;i<count;i++){last=await ctx.dispatch();times.push(last.elapsed);}
  const verified=verifyOutputs(data,last.values);
  setValue('latency',median(times).toFixed(2)+' ms');
  setValue('cpuTime',verified.cpuMs.toFixed(2)+' ms (참조 검증 전용)');
  setValue('error',verified.worst.toExponential(3));
  setValue('result',verified.passed?'PASS · GPU 및 CPU 결과 일치':'FAIL · 수치 불일치');
  $('result').dataset.ok=verified.passed?'yes':'no';
  report(verified.passed?'실제 GPU 추론 연산 검증 성공':'GPU 연산 검증 실패',verified.passed?'ready':'error');
  log('GPU 중앙 실행 시간 '+median(times).toFixed(2)+' ms · CPU 기준 최대 오차 '+verified.worst.toExponential(2));
  log('모델 메모리 설명: '+explainBytes(total)+' (압축 가중치+스케일); 대형 LLM의 KV 캐시는 별도');
 }catch(e){
  console.error(e);
  report('테스트 실패','error');
  setValue('result','ERROR · '+(e?.message||String(e)));
  $('result').dataset.ok='no';
  log('오류: '+(e?.message||String(e)));
 }finally{
  if(ctx)ctx.dispose();
  active=false;$('run').disabled=false;
 }
}
$('run').addEventListener('click',run);
log('가중치는 테스트 때 결정론적으로 생성됩니다. 외부 AI 모델을 내려받지 않습니다.');
if(navigator.gpu && isSecureContext)run();
else report('WebGPU 지원 확인 필요','error');
