/* AETHERION real WebGPU multi-strategy kernel benchmark.
 * Scalar, cooperative 32-lane, packed byte, split-K and predecode.
 * Validation always compares every output row to an independent CPU reference.
 * Timing batches repeated commands; reported GPU adapter matters.
 */
'use strict';
const AetherionKernelRace=(()=>{
const C=AetherionKernelStrategies;
const median=a=>{const b=[...a].sort((x,y)=>x-y),n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;};
const grade=(gpu,cpu,cols)=>{
 if(gpu.length!==cpu.length)return {pass:false,error:Infinity};
 let max=0;for(let i=0;i<gpu.length;i++){if(!Number.isFinite(gpu[i]))return {pass:false,error:Infinity};max=Math.max(max,Math.abs(gpu[i]-cpu[i]));}
 return {pass:max<=Math.max(.002,cols*.00003),error:max};
};
const pick=records=>{
 const baseline=records.find(r=>r.id==='scalar');
 if(!baseline||baseline.status!=='pass')return {id:null,reason:'Baseline parity failed',speedup:null};
 const valid=records.filter(r=>r.status==='pass'&&r.id!=='predecode').sort((a,b)=>a.ms-b.ms);
 const best=valid[0];
 if(!best||best.ms>baseline.ms*.94)return {id:'scalar',reason:'No compact candidate cleared 6% speedup threshold',speedup:1};
 return {id:best.id,reason:'Fastest CPU-validated compact method for this specific GPU adapter',speedup:baseline.ms/best.ms};
};
async function run({rows=128,cols=256,format=142,iterations=12,trials=3}={}){
 if(typeof navigator==='undefined'||!navigator.gpu||!isSecureContext)throw Error('WebGPU unavailable');
 if(!PrismBlocks||!AetherionNativeBench||!C)throw Error('Reference kernels unavailable');
 PrismBlocks.getBlocks(rows,cols,format);
 if(iterations<4||iterations>64||trials<2||trials>12)throw Error('Invalid benchmark repeat count');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('No GPU adapter');
 const device=await adapter.requestDevice(),U=GPUBufferUsage,buffers=[];
 const label=[adapter.info?.vendor,adapter.info?.device,adapter.info?.architecture,adapter.info?.description].filter(Boolean).join('/')||'unknown adapter';
 const fixture=PrismBlocks.packFixture(rows,cols,format,0x123456);
 const activation=PrismBlocks.randomActivation(cols,0xaabbcc);
 const expected=PrismBlocks.referenceMatvec(fixture.reference,rows,cols,activation);
 const put=(bytes,usage)=>{
  const b=device.createBuffer({size:bytes.byteLength,usage:usage|U.COPY_DST});
  device.queue.writeBuffer(b,0,bytes);buffers.push(b);return b;
 };
 const input=put(activation,U.STORAGE);
 const weights=put(PrismBlocks.bytesAsU32(fixture.bytes),U.STORAGE);
 const options=put(new Uint32Array([rows,cols,format,cols/128]),U.UNIFORM);
 const output=device.createBuffer({size:rows*4,usage:U.STORAGE|U.COPY_SRC});
 const staging=device.createBuffer({size:rows*4,usage:U.COPY_DST|U.MAP_READ});
 const partial=device.createBuffer({size:Math.max(4,rows*(cols/128)*4),usage:U.STORAGE});
 const dense=device.createBuffer({size:rows*cols*4,usage:U.STORAGE});
 buffers.push(output,staging,partial,dense);
 const layout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
  {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
  {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}
 ]});
 const layoutPipeline=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const bind=device.createBindGroup({layout,entries:[
  {binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:weights}},
  {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:options}},
  {binding:4,resource:{buffer:partial}},{binding:5,resource:{buffer:dense}}
 ]});
 const compile=async stage=>{
  const module=device.createShaderModule({code:stage.code}),info=await module.getCompilationInfo();
  const errors=info.messages.filter(x=>x.type==='error');
  if(errors.length)throw Error('WGSL: '+errors.map(x=>x.lineNum+':'+x.message).join(';').slice(0,360));
  return {dispatch:stage.dispatch,pipeline:await device.createComputePipelineAsync({layout:layoutPipeline,compute:{module,entryPoint:stage.entry}})};
 };
 const dispatch=(stages,repeats,read)=>{
  const cmd=device.createCommandEncoder();
  for(let i=0;i<repeats;i++)for(const s of stages){
   const pass=cmd.beginComputePass();
   pass.setPipeline(s.pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(s.dispatch);pass.end();
  }
  if(read)cmd.copyBufferToBuffer(output,0,staging,0,rows*4);
  device.queue.submit([cmd.finish()]);
 };
 const reports=[];
 try{
  for(const method of C.STRATEGIES){
   const report={id:method.id,name:method.name,family:method.family};
   try{
    const plan=C.makePlan(method.id,rows,cols);
    const stages=await Promise.all(plan.stages.map(compile));
    if(plan.preprocess){
     const pre=await compile(plan.preprocess);
     const start=performance.now();dispatch([pre],1,false);
     await device.queue.onSubmittedWorkDone();
     report.predecodeMs=performance.now()-start;
     report.denseBytes=plan.bytesDense;
    }
    dispatch(stages,1,true);
    await staging.mapAsync(GPUMapMode.READ);
    const outputArray=Float32Array.from(new Float32Array(staging.getMappedRange()));
    staging.unmap();
    Object.assign(report,grade(outputArray,expected,cols));
    if(!report.pass){report.status='invalid';reports.push(report);continue;}
    dispatch(stages,iterations,false);await device.queue.onSubmittedWorkDone();
    const measurements=[];
    for(let t=0;t<trials;t++){
     const start=performance.now();
     dispatch(stages,iterations,false);
     await device.queue.onSubmittedWorkDone();
     measurements.push((performance.now()-start)/iterations);
    }
    report.status='pass';report.ms=median(measurements);report.samplesMs=measurements;
   }catch(e){report.status='error';report.reason=String(e?.message||e).slice(0,390);}
   reports.push(report);
  }
  const selection=pick(reports);
  return {adapter:label,software:/swiftshader|software|llvmpipe/i.test(label)||Boolean(adapter.isFallbackAdapter),rows,cols,format,iterations,trials,
   source:'WebGPU commands executed in this browser',method:'batched JS queue submission + GPU completion fence, per-dispatch average',selection,reports};
 }finally{
  for(const b of buffers)try{b.destroy()}catch{}
  try{device.destroy()}catch{}
 }
}
return Object.freeze({median,grade,pick,run});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionKernelRace=AetherionKernelRace;
