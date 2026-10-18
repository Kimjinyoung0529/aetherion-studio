/* AETHERION WebGPU v2 · competitive packed-matvec autotuner
 * Native WGSL: baseline + 8/16/32/64 lane reductions + 2D row-tiling.
 * All candidates execute on exactly the same PTQ1_0/PQ2_0 fixture.
 * NEVER promote a candidate that fails CPU numerical verification.
 * Benchmarks are queue-submit + GPU-fence times, not end-to-end LLM speed.
 */
'use strict';
const AetherionAutotuneV2=(()=>{
 const VARIANTS=Object.freeze([
  {id:'serial',name:'직렬 기준',lanes:1,tileRows:1},
  {id:'lane8',name:'8-lane 병렬',lanes:8,tileRows:4},
  {id:'lane16',name:'16-lane 병렬',lanes:16,tileRows:4},
  {id:'lane32',name:'32-lane 병렬',lanes:32,tileRows:4},
  {id:'lane64',name:'64-lane 병렬',lanes:64,tileRows:4},
  {id:'tile16x8',name:'16×8 행 타일',lanes:16,tileRows:8},
  {id:'tile32x8',name:'32×8 행 타일',lanes:32,tileRows:8}
 ]);
 const tolerance=cols=>Math.max(.002,cols*.00003);
 const median=values=>{
  if(!values.length)throw Error('측정값이 없습니다');
  const a=values.slice().sort((x,y)=>x-y),mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
 };
 const deviation=values=>{
  const m=median(values);
  return median(values.map(v=>Math.abs(v-m)))/Math.max(m,.000001);
 };
 const commonWGSL=()=>{
  if(typeof AetherionNativeBench==='undefined')throw Error('기존 GPU 기준 셰이더를 먼저 불러와야 합니다');
  const text=AetherionNativeBench.SERIAL;
  const at=text.indexOf('@compute');
  if(at<0||!text.includes('fn getTrit('))throw Error('정확도 기준 셰이더가 유효하지 않습니다');
  return text.slice(0,at);
 };
 function shader(variant){
  if(variant.id==='serial')return AetherionNativeBench.SERIAL;
  const lanes=variant.lanes,rows=variant.tileRows;
  if(![8,16,32,64].includes(lanes)||![4,8].includes(rows)||lanes*rows>256)throw Error('GPU 작업 그룹 크기가 유효하지 않습니다');
  const snippet=[
   'var<workgroup> scratch:array<f32,256>;',
   '@compute @workgroup_size('+lanes+','+rows+')',
   'fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>){',
   ' let row=group.x*'+rows+'u+local.y;',
   ' let lane=local.x;',
   ' let slot=local.y*'+lanes+'u+lane;',
   ' var total:f32=0.0;',
   ' if(row<cfg.rows){',
   '  for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
   '   let base=blockBase(row,block);',
   '   let scale=blockScale(base);',
   '   var partial:f32=0.0;',
   '   for(var pos:u32=lane;pos<128u;pos=pos+'+lanes+'u){',
   '    partial+=getTrit(base,pos)*x[block*128u+pos];',
   '   }',
   '   total+=partial*scale;',
   '  }',
   ' }',
   ' scratch[slot]=total;',
   ' workgroupBarrier();',
   ' for(var step:u32='+Math.floor(lanes/2)+'u;step>0u;step=step/2u){',
   '  if(lane<step){scratch[slot]+=scratch[slot+step];}',
   '  workgroupBarrier();',
   ' }',
   ' if(lane==0u && row<cfg.rows){y[row]=scratch[slot];}',
   '}'
  ].join('\n');
  return commonWGSL()+snippet;
 }
 function selectWinner(results,options={}){
  const minimumGain=Number.isFinite(options.minimumGain)?options.minimumGain:.08;
  const maximumJitter=Number.isFinite(options.maximumJitter)?options.maximumJitter:.45;
  const baseline=results.find(x=>x.id==='serial');
  if(!baseline||baseline.status!=='pass'||!(baseline.ms>0)){
   return {winner:null,reason:'기준 GPU 커널의 정확도 검증 실패 — 어떤 후보도 채택하지 않습니다.',gain:0};
  }
  const candidates=results.filter(x=>x.status==='pass'&&x.id!=='serial'&&x.ms>0&&x.jitter<=maximumJitter)
   .sort((a,b)=>a.ms-b.ms);
  if(!candidates.length)return {winner:baseline,reason:'유효한 병렬 후보가 없어 검증된 직렬 커널을 유지합니다.',gain:0};
  const candidate=candidates[0],gain=baseline.ms/candidate.ms-1;
  if(gain<minimumGain)return {winner:baseline,reason:'병렬 최적화 이득이 '+Math.round(minimumGain*100)+'%보다 작아 안전한 직렬 커널을 유지합니다.',gain:0};
  return {winner:candidate,reason:'같은 입력·GPU에서 검증 통과. '+((gain)*100).toFixed(1)+'% 빠른 '+candidate.name+' 채택.',gain};
 }
 function deviceAllowed(variant,limits){
  const threads=variant.id==='serial'?64:variant.lanes*variant.tileRows;
  if(threads>limits.maxComputeInvocationsPerWorkgroup)return false;
  if(variant.id!=='serial'&&(variant.lanes>limits.maxComputeWorkgroupSizeX||variant.tileRows>limits.maxComputeWorkgroupSizeY))return false;
  if(variant.id==='serial'&&64>limits.maxComputeWorkgroupSizeX)return false;
  return true;
 }
 async function run({rows=256,cols=512,format=143,trials=7,onProgress=()=>{}}={}){
  if(typeof PrismBlocks==='undefined'||typeof AetherionNativeBench==='undefined')throw Error('Prism 코덱과 기준 셰이더가 없습니다');
  AetherionNativeBench.validateShape(rows,cols,format);
  if(!Number.isInteger(trials)||trials<3||trials>15)throw Error('반복 측정 횟수는 3~15회여야 합니다');
  if(typeof navigator==='undefined'||!navigator.gpu||!isSecureContext)throw Error('WebGPU·HTTPS가 지원되지 않습니다');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('GPU 어댑터를 찾을 수 없습니다');
  const device=await adapter.requestDevice();
  const bufs=[];
  const results=[];
  const fixture=PrismBlocks.packFixture(rows,cols,format,0x32aff);
  const activation=PrismBlocks.randomActivation(cols,0x99ff);
  const reference=PrismBlocks.referenceMatvec(fixture.reference,rows,cols,activation);
  const threshold=tolerance(cols);
  const U=GPUBufferUsage;
  try{
   const put=(source,usage)=>{
    const b=device.createBuffer({size:source.byteLength,usage:usage|U.COPY_DST});
    device.queue.writeBuffer(b,0,source);
    bufs.push(b);return b;
   };
   const vectors=put(activation,U.STORAGE);
   const packed=put(PrismBlocks.bytesAsU32(fixture.bytes),U.STORAGE);
   const settings=put(new Uint32Array([rows,cols,format,cols/128]),U.UNIFORM);
   const output=device.createBuffer({size:rows*4,usage:U.STORAGE|U.COPY_SRC});
   const readback=device.createBuffer({size:rows*4,usage:U.MAP_READ|U.COPY_DST});
   bufs.push(output,readback);
   for(const v of VARIANTS){
    onProgress({step:'compile',variant:v.id,count:results.length,total:VARIANTS.length});
    if(!deviceAllowed(v,device.limits)){
     results.push({...v,status:'unsupported',ms:null,jitter:null,error:null,reason:'GPU 작업 그룹 한도 초과'});
     continue;
    }
    try{
     device.pushErrorScope('validation');
     let pipeline,compileError=null;
     try{
      const module=device.createShaderModule({code:shader(v)});
      const info=await module.getCompilationInfo();
      const failures=info.messages.filter(x=>x.type==='error');
      if(failures.length)throw Error('WGSL 컴파일: '+failures.map(x=>x.message).join(' ; ').slice(0,320));
      pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
     }catch(e){compileError=e;}
     const scopeError=await device.popErrorScope();
     if(scopeError)throw Error(scopeError.message);
     if(compileError)throw compileError;
     const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:vectors}},{binding:1,resource:{buffer:packed}},
      {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:settings}}
     ]});
     const dispatch=withReadback=>{
      const commands=device.createCommandEncoder();
      const pass=commands.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);
      pass.dispatchWorkgroups(v.id==='serial'?Math.ceil(rows/64):Math.ceil(rows/v.tileRows));
      pass.end();
      if(withReadback)commands.copyBufferToBuffer(output,0,readback,0,rows*4);
      device.queue.submit([commands.finish()]);
     };
     // Check numerical accuracy BEFORE timing. Full readback, all output rows.
     dispatch(true);
     await readback.mapAsync(GPUMapMode.READ);
     const observed=Float32Array.from(new Float32Array(readback.getMappedRange()));
     readback.unmap();
     const err=AetherionNativeBench.maxError(reference,observed);
     if(err>threshold){
      results.push({...v,status:'invalid',ms:null,jitter:null,error:err,reason:'CPU 기준 수치 불일치 (허용 '+threshold.toExponential(2)+')'});
      continue;
     }
     dispatch(false);
     await device.queue.onSubmittedWorkDone(); // pipeline warm-up
     const durations=[];
     for(let j=0;j<trials;j++){
      const started=performance.now();dispatch(false);await device.queue.onSubmittedWorkDone();
      durations.push(performance.now()-started);
     }
     const med=median(durations),jit=deviation(durations);
     results.push({...v,status:'pass',ms:med,jitter:jit,error:err,trials:durations});
    }catch(e){
     results.push({...v,status:'error',ms:null,jitter:null,error:null,reason:String(e?.message||e)});
    }
    onProgress({step:'tested',variant:v.id,count:results.length,total:VARIANTS.length,result:results[results.length-1]});
   }
   const selection=selectWinner(results);
   const gpu=[adapter.info?.vendor,adapter.info?.device,adapter.info?.architecture].filter(Boolean).join(' / ')||'GPU';
   return {
    version:2,format,rows,cols,device:gpu,timing:'7회 GPU 완료 대기 포함 시간. 셰이더 단독 GPU 소요 시간이 아님.',
    threshold,winner:selection.winner?.id||null,gain:selection.gain,reason:selection.reason,results
   };
  }finally{
   for(const buffer of bufs){try{buffer.destroy();}catch{}}
   try{device.destroy()}catch{}
  }
 }
 function present(report){
  return report.results.map(r=>({
   id:r.id,name:r.name,status:r.status,
   ms:r.ms===null?'—':r.ms.toFixed(3)+'ms',
   jitter:r.jitter===null?'—':(r.jitter*100).toFixed(1)+'%',
   error:r.error===null?'—':r.error.toExponential(2),
   selected:r.id===report.winner
  }));
 }
 return Object.freeze({VARIANTS,shader,median,deviation,tolerance,selectWinner,deviceAllowed,run,present});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionAutotuneV2=AetherionAutotuneV2;
