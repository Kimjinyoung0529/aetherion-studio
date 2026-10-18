/* AETHERION optional software-WebGPU numerical smoke test.
 * When Chrome exposes a SwiftShader/Dawn adapter we compile and execute native
 * PTQ/PQ WGSL kernels and GPU-resident matvec. Otherwise explicitly SKIP.
 * This is not a test of iPhone GPU performance.
 */
'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PW_CORE_DIR);
const host='http://127.0.0.1:8765/runtime/';
(async()=>{
 const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.BROWSER_EXECUTABLE,
  args:[
   '--no-sandbox','--disable-dev-shm-usage',
   '--enable-unsafe-webgpu','--enable-features=Vulkan',
   '--use-angle=swiftshader','--enable-dawn-features=allow_unsafe_apis'
  ]
 });
 try{
  const page=await browser.newPage();
  await page.goto(host,{waitUntil:'domcontentloaded',timeout:20000});
  const outcome=await Promise.race([
   page.evaluate(async()=>{
    if(!isSecureContext||!navigator.gpu)return {skipped:'navigator.gpu unavailable or insecure context'};
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter)return {skipped:'no WebGPU adapter supplied by headless Chrome'};
    const run=async format=>{
     const report=await AetherionAutotuneV2.run({rows:64,cols:128,format,trials:3});
     const baseline=report.results.find(r=>r.id==='serial');
     if(!baseline||baseline.status!=='pass')throw Error('Reference GPU kernel failed format '+format+': '+JSON.stringify(baseline));
     const fixture=PrismBlocks.packFixture(64,128,format,0x32aff);
     const x=PrismBlocks.randomActivation(128,0x99ff);
     const session=await AetherionPackedSession.create({rows:64,cols:128,format,weights:fixture.bytes,preferredVariant:report.winner});
     try{
      const first=await session.multiply(x);
      const second=await session.multiply(x);
      if(!first.verification.pass||!first.verification.allRows)throw Error('Full CPU reference check did not pass');
      if(AetherionNativeBench.maxError(first.output,second.output)>1e-5)throw Error('Repeated output differs');
      return {format,candidates:report.results.map(v=>({id:v.id,status:v.status,error:v.error})),
       selected:report.winner,verifiedRows:first.verification.checkedRows,
       firstMs:first.ms,secondMs:second.ms,fallback:first.fallback};
     }finally{session.close();}
    };
    const ptq=await run(143),pq=await run(142);
    return {gpuAvailable:true,device:adapter.info?.vendor||'software',ptq,pq};
   }),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('Software GPU probe timed out after 120 seconds')),120000))
  ]);
  if(outcome.skipped)console.log('SKIP WEBGPU HARDWARE CHECK: '+outcome.skipped);
  else{
   assert.equal(outcome.ptq.verifiedRows,64);
   assert.equal(outcome.pq.verifiedRows,64);
   console.log('PASS software WebGPU PTQ1_0/PQ2_0 WGSL compilation, all-row parity, reusable GPU session:',JSON.stringify(outcome));
  }
 }finally{await browser.close()}
})().catch(e=>{console.error('WebGPU software probe failed:',e);process.exitCode=1});
