/* AETHERION Native GPU Session v2.1 — REUSABLE packed matvec executor.
 * Weights and shader live on the GPU across multiple matrix-vector products.
 * Supports PrismML PTQ1_0 / PQ2_0 ONLY; not a full Qwen/LLM runtime.
 * Prefer an autotuned kernel, fall back to serial when compilation or parity fails.
 */
'use strict';
const AetherionPackedSession=(()=>{
 const STORAGE_TYPES=new Set([142,143]);
 function shape(rows,cols,format,bytes){
  if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols)||rows<1||rows>4096||cols<128||cols>16384||cols%128!==0||!STORAGE_TYPES.has(format))throw Error('지원하지 않는 행렬 차원 또는 Prism 양자화 형식');
  const n=rows*(cols/128)*PrismBlocks.FORMATS[format].bytes;
  if(!(bytes instanceof Uint8Array)||bytes.length!==n)throw Error('GGUF PTQ/PQ 가중치의 바이트 길이가 텐서 차원과 일치하지 않습니다');
  return n;
 }
 function sampledReference(weights,rows,cols,format,x,maxEntries=800000){
  const checkAll=rows*cols<=maxEntries;
  const rowIds=checkAll?Array.from({length:rows},(_,i)=>i):
   [...new Set([0,1,2,Math.floor(rows/4),Math.floor(rows/2),Math.floor(3*rows/4),rows-3,rows-2,rows-1].filter(r=>r>=0&&r<rows))].sort((a,b)=>a-b);
  const result=new Map();
  for(const r of rowIds){
   let sum=0;
   for(let c=0;c<cols;c++){
    const b=r*(cols/128)+(c>>>7);
    const value=PrismBlocks.decodeAt(weights,b,c%128,format);
    sum=Math.fround(sum+Math.fround(value*x[c]));
   }
   result.set(r,sum);
  }
  return {values:result,checkedRows:rowIds.length,allRows:checkAll};
 }
 function compareRows(reference,actual,cols){
  let worst=0,maxRelative=0,pass=true;
  const threshold=Math.max(.002,cols*.00003);
  for(const [r,want] of reference.values){
   const found=actual[r];
   if(!Number.isFinite(found))return {pass:false,maxError:Infinity,checkedRows:reference.checkedRows,allRows:reference.allRows,threshold};
   const err=Math.abs(want-found);
   worst=Math.max(worst,err);
   maxRelative=Math.max(maxRelative,err/Math.max(1,Math.abs(want)));
   if(err>Math.max(threshold,Math.abs(want)*.001))pass=false;
  }
  return {pass,maxError:worst,maxRelative,checkedRows:reference.checkedRows,allRows:reference.allRows,threshold};
 }
 async function create({rows,cols,format,weights,preferredVariant='serial'}={}){
  if(typeof PrismBlocks==='undefined'||typeof AetherionAutotuneV2==='undefined')throw Error('Prism 코덱과 WebGPU v2 커널이 먼저 로드되어야 합니다');
  const weightSize=shape(rows,cols,format,weights);
  const variants=AetherionAutotuneV2.VARIANTS;
  let variant=variants.find(x=>x.id===preferredVariant);
  if(!variant)throw Error('알 수 없는 GPU 커널: '+preferredVariant);
  if(!isSecureContext||!navigator.gpu)throw Error('WebGPU·HTTPS가 필요합니다');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('WebGPU 어댑터를 찾을 수 없습니다');
  const device=await adapter.requestDevice();
  const U=GPUBufferUsage;
  const buffers=[];
  let closed=false,broken=false,busy=false;
  device.lost.then(()=>{broken=true;});
  const upload=(arr,usage)=>{
   const b=device.createBuffer({size:arr.byteLength,usage:usage|U.COPY_DST});
   device.queue.writeBuffer(b,0,arr);buffers.push(b);return b;
  };
  const close=()=>{
   if(closed)return;
   closed=true;
   for(const b of buffers)try{b.destroy()}catch{}
   try{device.destroy()}catch{}
  };
  try{
   if(weightSize>device.limits.maxStorageBufferBindingSize||weightSize>device.limits.maxBufferSize)throw Error('양자화 텐서가 단일 GPU 버퍼 한도를 초과합니다. 분할 커널이 필요합니다');
   if(cols*4>device.limits.maxStorageBufferBindingSize||rows*4>device.limits.maxStorageBufferBindingSize)throw Error('GPU 연산 버퍼 한도 초과');
   const packed=upload(PrismBlocks.bytesAsU32(weights),U.STORAGE);
   const activation=upload(new Float32Array(cols),U.STORAGE);
   const options=upload(new Uint32Array([rows,cols,format,cols/128]),U.UNIFORM);
   const output=device.createBuffer({size:rows*4,usage:U.STORAGE|U.COPY_SRC});
   const read=device.createBuffer({size:rows*4,usage:U.COPY_DST|U.MAP_READ});
   buffers.push(output,read);
   const compile=async v=>{
    if(!AetherionAutotuneV2.deviceAllowed(v,device.limits))throw Error('GPU 작업 그룹 크기 제한');
    const module=device.createShaderModule({code:AetherionAutotuneV2.shader(v)});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(x=>x.type==='error');
    if(errors.length)throw Error('GPU 커널 컴파일 오류: '+errors.map(x=>x.message).join('; '));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:{buffer:activation}},{binding:1,resource:{buffer:packed}},
     {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:options}}
    ]});
    return {pipeline,bind};
   };
   let fallback=false,pipelineInfo;
   try{pipelineInfo=await compile(variant);}
   catch(e){
    if(variant.id==='serial')throw e;
    variant=variants[0];fallback=true;
    pipelineInfo=await compile(variant);
   }
   const runGpu=async input=>{
    if(closed||broken)throw Error('GPU 장치 연결이 해제되었습니다');
    const started=performance.now();
    device.queue.writeBuffer(activation,0,input);
    const cmd=device.createCommandEncoder(),pass=cmd.beginComputePass();
    pass.setPipeline(pipelineInfo.pipeline);pass.setBindGroup(0,pipelineInfo.bind);
    pass.dispatchWorkgroups((variant.id==='serial'||variant.id==='packed_row')?Math.ceil(rows/64):Math.ceil(rows/variant.tileRows));
    pass.end();
    cmd.copyBufferToBuffer(output,0,read,0,rows*4);
    device.queue.submit([cmd.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    let outputValues;
    try{outputValues=Float32Array.from(new Float32Array(read.getMappedRange()));}
    finally{read.unmap();}
    return {output:outputValues,ms:performance.now()-started};
   };
   let validated=false,lastCheck=null,calls=0,readbackMs=0;
   return Object.freeze({
    get info(){return {rows,cols,format,weightBytes:weightSize,variant:variant.id,fallback,validated,calls,readbackMs,device:[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'WebGPU'};},
    async multiply(x){
     if(closed||broken)throw Error('WebGPU 세션이 종료되었습니다');
     if(busy)throw Error('같은 GPU 버퍼에서 동시 추론을 진행할 수 없습니다');
     if(!(x instanceof Float32Array)||x.length!==cols)throw Error('입력 벡터는 cols개 Float32 값이어야 합니다');
     for(const n of x){if(!Number.isFinite(n))throw Error('입력 벡터에 비정상 값이 있습니다');}
     busy=true;
     try{
      let result=await runGpu(x);
      if(!validated){
       const ref=sampledReference(weights,rows,cols,format,x);
       let check=compareRows(ref,result.output,cols);
       if(!check.pass&&variant.id!=='serial'){
        variant=variants[0];fallback=true;
        pipelineInfo=await compile(variant);
        result=await runGpu(x);
        check=compareRows(ref,result.output,cols);
       }
       if(!check.pass)throw Error('직렬 기준 GPU에서도 CPU 수치 검증에 실패하여 결과를 폐기했습니다');
       validated=true;lastCheck=check;
      }
      calls++;readbackMs=result.ms;
      return {output:result.output,ms:result.ms,verification:lastCheck,variant:variant.id,fallback};
     }finally{busy=false;}
    },
    close
   });
  }catch(e){close();throw e;}
 }
 return Object.freeze({shape,sampledReference,compareRows,create});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionPackedSession=AetherionPackedSession;
