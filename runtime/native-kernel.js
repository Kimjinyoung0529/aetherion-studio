/* AETHERION Native Packed Matvec Benchmark v1.
 * Comparing native WGSL serial-row vs 32-lane workgroup reduction kernels.
 * PTQ1_0 / PQ2_0 from PrismML block layout. This does not run full LLM layers.
 */
'use strict';
const AetherionNativeBench=(()=>{
const COMMON=[
'struct Config { rows:u32, cols:u32, format:u32, blocksPerRow:u32 };',
'@group(0) @binding(0) var<storage,read> x:array<f32>;',
'@group(0) @binding(1) var<storage,read> pack:array<u32>;',
'@group(0) @binding(2) var<storage,read_write> y:array<f32>;',
'@group(0) @binding(3) var<uniform> cfg:Config;',
'fn getByte(off:u32)->u32 {',
' return (pack[off / 4u] >> ((off % 4u) * 8u)) & 255u;',
'}',
'fn getTrit(base:u32,p:u32)->f32 {',
' if(cfg.format==142u){',
'  let packed=getByte(base+2u+p/4u);',
'  return f32(i32((packed >> (p%4u*2u)) & 3u)-1);',
' }',
' var offset:u32=0u;',
' var power:u32=1u;',
' var digit:u32=0u;',
' if(p<80u){',
'  offset=p%16u;digit=p/16u;',
' }else if(p<120u){',
'  offset=16u+(p-80u)%8u;digit=(p-80u)/8u;',
' }else{',
'  offset=24u+(p-120u)%2u;digit=(p-120u)/2u;',
' }',
' for(var i:u32=0u;i<digit;i=i+1u){power=power*3u;}',
' let code=(getByte(base+offset)*power)&255u;',
' return f32(i32((code*3u)>>8u)-1);',
'}',
'fn blockScale(base:u32)->f32 {',
' let off=select(26u,0u,cfg.format==142u);',
' let bits=getByte(base+off)|(getByte(base+off+1u)<<8u);',
' return unpack2x16float(bits).x;',
'}',
'fn blockBase(row:u32,block:u32)->u32 {',
' let stride=select(28u,34u,cfg.format==142u);',
' return (row*cfg.blocksPerRow+block)*stride;',
'}'
].join('\n');
const SERIAL=COMMON+'\n'+[
'@compute @workgroup_size(64)',
'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
' let row=id.x;if(row>=cfg.rows){return;}',
' var sum:f32=0.0;',
' for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
'  let base=blockBase(row,block);',
'  let scale=blockScale(base);',
'  var acc:f32=0.0;',
'  for(var p:u32=0u;p<128u;p=p+1u){',
'   acc=acc+getTrit(base,p)*x[block*128u+p];',
'  }',
'  sum=sum+acc*scale;',
' }',
' y[row]=sum;',
'}'
].join('\n');
const PARALLEL=COMMON+'\n'+[
'var<workgroup> scratch:array<f32,128>;',
'@compute @workgroup_size(32,4)',
'fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>){',
' let row=group.x*4u+local.y;',
' let lane=local.x;',
' let slot=local.y*32u+lane;',
' var acc:f32=0.0;',
' if(row<cfg.rows){',
'  for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
'   let base=blockBase(row,block);let scale=blockScale(base);',
'   var chunk:f32=0.0;',
'   for(var p:u32=lane;p<128u;p=p+32u){',
'    chunk+=getTrit(base,p)*x[block*128u+p];',
'   }',
'   acc+=chunk*scale;',
'  }',
' }',
' scratch[slot]=acc;',
' workgroupBarrier();',
' for(var stride:u32=16u;stride>0u;stride=stride/2u){',
'  if(lane<stride){scratch[slot]+=scratch[slot+stride];}',
'  workgroupBarrier();',
' }',
' if(lane==0u&&row<cfg.rows){y[row]=scratch[slot];}',
'}'
].join('\n');
function validateShape(rows,cols,format){
 if(![64,128,256,512].includes(rows)||![128,256,512,1024].includes(cols)||![142,143].includes(format))throw Error('벤치마크 차원·포맷 오류');
}
const median=x=>{
 const a=[...x].sort((a,b)=>a-b),mid=Math.floor(a.length/2);
 return a.length%2?a[mid]:(a[mid]+a[mid-1])/2;
};
function cpu(reference,rows,cols,x){
 const result=new Float32Array(rows);
 for(let r=0;r<rows;r++){
  let sum=0;for(let c=0;c<cols;c++)sum+=reference[r*cols+c]*x[c];
  result[r]=sum;
 }return result;
}
function maxError(a,b){
 if(a.length!==b.length)throw Error('길이가 다른 출력');
 let worst=0;
 for(let i=0;i<a.length;i++){
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('NaN 또는 Infinity 감지');
  worst=Math.max(worst,Math.abs(a[i]-b[i]));
 }return worst;
}
async function measure(rows,cols,format,fixture,activation){
 validateShape(rows,cols,format);
 if(!isSecureContext||!navigator.gpu)throw Error('HTTPS와 WebGPU가 필요합니다.');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('WebGPU adapter가 없습니다.');
 const device=await adapter.requestDevice();
 const buffers=[];
 try{
  const U=GPUBufferUsage;
  const upload=(array,usage)=>{
   const b=device.createBuffer({size:array.byteLength,usage:usage|U.COPY_DST});
   device.queue.writeBuffer(b,0,array);buffers.push(b);return b;
  };
  const x=upload(activation,U.STORAGE),packed=upload(PrismBlocks.bytesAsU32(fixture.bytes),U.STORAGE);
  const uniform=upload(new Uint32Array([rows,cols,format,cols/128]),U.UNIFORM);
  const compile=async code=>{
   const module=device.createShaderModule({code});
   const diagnostic=await module.getCompilationInfo();
   const errors=diagnostic.messages.filter(x=>x.type==='error');
   if(errors.length)throw Error('WGSL 오류: '+errors.map(x=>x.message).join('; '));
   return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  };
  const serial=await compile(SERIAL),parallel=await compile(PARALLEL);
  const run=async (pipeline,count)=>{
   const output=device.createBuffer({size:rows*4,usage:U.STORAGE|U.COPY_SRC});
   const read=device.createBuffer({size:rows*4,usage:U.MAP_READ|U.COPY_DST});
   buffers.push(output,read);
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:x}},{binding:1,resource:{buffer:packed}},
    {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:uniform}}
   ]});
   const once=copy=>{
    const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count);pass.end();
    if(copy)enc.copyBufferToBuffer(output,0,read,0,rows*4);
    device.queue.submit([enc.finish()]);
   };
   once(false);await device.queue.onSubmittedWorkDone(); // warm kernel and pipeline
   const times=[];
   for(let i=0;i<7;i++){
    const start=performance.now();once(false);await device.queue.onSubmittedWorkDone();
    times.push(performance.now()-start);
   }
   once(true);await read.mapAsync(GPUMapMode.READ);
   const values=Float32Array.from(new Float32Array(read.getMappedRange()));read.unmap();
   return {values,medianMs:median(times),times};
  };
  // Benchmark candidate first and old baseline second to reduce first-run bias.
  const fast=await run(parallel,Math.ceil(rows/4));
  const old=await run(serial,Math.ceil(rows/64));
  const ref=cpu(fixture.reference,rows,cols,activation);
  const errorFast=maxError(ref,fast.values),errorOld=maxError(ref,old.values);
  const tolerance=Math.max(0.002,cols*.00003);
  return {
   rows,cols,format,parallelMs:fast.medianMs,serialMs:old.medianMs,
   ratio:old.medianMs/fast.medianMs,errorFast,errorOld,tolerance,
   pass:errorFast<=tolerance&&errorOld<=tolerance,
   timing:'queue.onSubmittedWorkDone() · JS submission + GPU fence, not shader-only time',
   gpu:[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'GPU'
  };
 }finally{for(const b of buffers)try{b.destroy()}catch{}device.destroy();}
}
async function runUI(){
 const button=document.getElementById('nativeRun');if(!button||button.disabled)return;
 button.disabled=true;
 const set=(id,text)=>document.getElementById(id).textContent=text;
 set('nativeStatus','WebGPU 직렬 / 32-lane 병렬 커널 준비 중…');
 try{
  const rows=Number(document.getElementById('nativeRows').value);
  const cols=Number(document.getElementById('nativeCols').value);
  const format=Number(document.getElementById('nativeFormat').value);
  validateShape(rows,cols,format);
  const fixture=PrismBlocks.packFixture(rows,cols,format);
  const activation=PrismBlocks.randomActivation(cols);
  const result=await measure(rows,cols,format,fixture,activation);
  set('nativeSerial',result.serialMs.toFixed(3)+' ms');
  set('nativeParallel',result.parallelMs.toFixed(3)+' ms');
  set('nativeError',result.errorFast.toExponential(3));
  const verdict=result.pass?(result.ratio>1?'병렬 '+result.ratio.toFixed(2)+'× 측정 · 성공':'병렬 '+result.ratio.toFixed(2)+'× · 기존 커널이 더 빠르거나 동률'):'수치 정확도 실패 · 속도 우승 판정 불가';
  set('nativeStatus',verdict);
  set('nativeGpu',result.gpu);
  set('nativeMeta','7회 디스패치+완료 대기 중앙값; 실측치는 LLM 전체 토큰 처리 속도가 아닙니다.');
 }catch(e){
  set('nativeStatus','실행 오류: '+(e?.message||e));
 }finally{button.disabled=false;}
}
if(typeof document!=='undefined'&&document.getElementById('nativeRun')){
 document.getElementById('nativeRun').addEventListener('click',runUI);
}
return Object.freeze({SERIAL,PARALLEL,validateShape,median,cpu,maxError,measure});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionNativeBench=AetherionNativeBench;
