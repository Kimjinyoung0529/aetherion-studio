/* AETHERION Native Bonsai Signed Hadamard v0.5
 * Implements activation-side sign flip -> normalized block Walsh-Hadamard.
 * Reference: PrismML llama.cpp llama-graph.cpp build_lora_mm() order.
 * Does NOT include SSM/GDN value-head permutation or full Bonsai model graph.
 */
'use strict';
const AetherionSignedFold=(()=>{
 const MAX_BLOCK=1024;
 const wgsl=`
struct Config {width:u32,block:u32,unused0:u32,unused1:u32};
@group(0) @binding(0) var<storage,read> activation:array<f32>;
@group(0) @binding(1) var<storage,read> signs:array<f32>;
@group(0) @binding(2) var<storage,read_write> rotated:array<f32>;
@group(0) @binding(3) var<uniform> conf:Config;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let chunk=gid.x;
 let block=conf.block;
 if(block>1024u||block==0u||chunk>=conf.width/block){return;}
 var z:array<f32,1024>;
 let start=chunk*block;
 for(var i:u32=0u;i<block;i=i+1u){
   z[i]=activation[start+i]*signs[start+i];
 }
 var step:u32=1u;
 loop {
  if(step>=block){break;}
  let doubled=step*2u;
  for(var first:u32=0u;first<block;first=first+doubled){
   for(var i:u32=0u;i<step;i=i+1u){
    let a=z[first+i];let b=z[first+i+step];
    z[first+i]=a+b;z[first+i+step]=a-b;
   }
  }
  step=doubled;
 }
 let norm=inverseSqrt(f32(block));
 for(var i:u32=0u;i<block;i=i+1u){
   rotated[start+i]=z[i]*norm;
 }
}
`;
 function transform(input,signs,block=1024,inverse=false){
  if(!(input instanceof Float32Array))throw Error('Float32Array activation input required');
  if(!(signs instanceof Float32Array))throw Error('Float32Array sign vector required');
  const width=input.length;
  if(width===0||width!==signs.length||width>32768||!Number.isInteger(block)||block<64||block>MAX_BLOCK||(block&(block-1))||width%block!==0)throw Error('Invalid signed Hadamard shape');
  const out=Float32Array.from(input);
  if(!inverse){
   for(let i=0;i<width;i++){
    if(signs[i]!==-1&&signs[i]!==1)throw Error('Sign values must be +/-1');
    out[i]=Math.fround(out[i]*signs[i]);
   }
  }
  for(let start=0;start<width;start+=block){
   for(let step=1;step<block;step*=2){
    for(let first=0;first<block;first+=step*2){
     for(let j=0;j<step;j++){
      let k=start+first+j;
      const a=out[k],b=out[k+step];
      out[k]=Math.fround(a+b);
      out[k+step]=Math.fround(a-b);
     }
    }
   }
   const inv=1/Math.sqrt(block);
   for(let i=0;i<block;i++)out[start+i]=Math.fround(out[start+i]*inv);
  }
  if(inverse){
   for(let i=0;i<width;i++){
    if(signs[i]!==-1&&signs[i]!==1)throw Error('Invalid sign on inverse');
    out[i]=Math.fround(out[i]*signs[i]);
   }
  }
  return out;
 }
 function maxError(a,b){
  if(a.length!==b.length)throw Error('Incomparable lengths');
  let max=0;
  for(let i=0;i<a.length;i++){
   if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('Nonfinite value');
   max=Math.max(max,Math.abs(a[i]-b[i]));
  }
  return max;
 }
 async function runGPU(input,signs,block){
  if(!isSecureContext||!navigator.gpu)throw Error('HTTPS/WebGPU unavailable');
  if(input.length!==signs.length||block>1024||input.length%block)throw Error('Invalid input shape');
  let device=null;
  try{
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
   if(!adapter)throw Error('GPU adapter unavailable');
   device=await adapter.requestDevice();
   const module=device.createShaderModule({code:wgsl});
   const info=await module.getCompilationInfo();
   const errors=info.messages.filter(x=>x.type==='error');
   if(errors.length)throw Error('Shader compile: '+errors.map(x=>x.message).join('; ').slice(0,550));
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   const U=GPUBufferUsage;
   const upload=(data,usage)=>{
    let b=device.createBuffer({size:data.byteLength,usage:usage|U.COPY_DST});
    device.queue.writeBuffer(b,0,data);return b;
   };
   const a=upload(input,U.STORAGE),s=upload(signs,U.STORAGE);
   const output=device.createBuffer({size:input.byteLength,usage:U.STORAGE|U.COPY_SRC});
   const readback=device.createBuffer({size:input.byteLength,usage:U.MAP_READ|U.COPY_DST});
   const params=upload(new Uint32Array([input.length,block,0,0]),U.UNIFORM);
   const buffers=[a,s,output,readback,params];
   try{
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:s}},
     {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:params}}
    ]});
    const start=performance.now();
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(input.length/block);pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,input.byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result=new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    return {result,ms:performance.now()-start};
   }finally{buffers.forEach(b=>{try{b.destroy()}catch{}});}
  }finally{try{device?.destroy()}catch{}}
 }
 function sample(width){
  if(!Number.isInteger(width)||width<1||width>32768)throw Error('Invalid width');
  return Float32Array.from({length:width},(_,i)=>Math.fround(Math.sin(i*0.231)+0.25*Math.cos(i*0.951)));
 }
 return Object.freeze({wgsl,transform,maxError,runGPU,sample});
})();
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);
 const button=$('signedFoldRun');
 if(button)button.addEventListener('click',async()=>{
  button.disabled=true;$('signedFoldResult').textContent='부호 벡터 WebGPU 계산 중…';
  try{
   const audit=window.currentBonsaiAudit;
   if(!audit||!audit.compatibleMetadata)throw Error('올바른 Prism GGUF 메타데이터 검사가 필요합니다');
   const width=Number($('signedFoldWidth').value),signs=audit.signTables.get(width),block=audit.info.blocks;
   if(!signs)throw Error('선택한 부호 폭을 GGUF에서 찾지 못했습니다');
   const values=AetherionSignedFold.sample(width);
   const factors=Float32Array.from(signs),cpu=AetherionSignedFold.transform(values,factors,block);
   const recovered=AetherionSignedFold.transform(cpu,factors,block,true);
   const inverseError=AetherionSignedFold.maxError(values,recovered);
   if(inverseError>.002)throw Error('변환·역변환 참조 불일치: '+inverseError);
   const computed=await AetherionSignedFold.runGPU(values,factors,block);
   const err=AetherionSignedFold.maxError(cpu,computed.result);
   const maxTolerance=Math.max(.003,width*.000001);
   const good=err<=maxTolerance;
   $('signedFoldError').textContent=err.toExponential(3);
   $('signedFoldTime').textContent=computed.ms.toFixed(2)+' ms';
   $('signedFoldResult').textContent=good?'PASS · GGUF 부호 벡터 + GPU FWHT 일치':'FAIL · GPU/CPU 오차 초과';
   $('signedFoldResult').dataset.ok=good?'yes':'no';
  }catch(e){
   $('signedFoldResult').textContent='ERROR · '+(e.message||e);
   $('signedFoldResult').dataset.ok='no';
  }finally{button.disabled=false}
 });
}
