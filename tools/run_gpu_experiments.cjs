/* Run AETHERION six-way kernel tournament in GitHub Actions Chromium.
 * This performs actual WGSL compilation and GPU API execution via SwiftShader,
 * a SOFTWARE adapter. It is not Apple/NVIDIA hardware GPU evidence.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const api=require(process.env.PW_CORE_DIR||'playwright-core');
const {chromium}=api;
const BASE='http://127.0.0.1:8765/runtime/experiments/';
const cases=[
 {rows:128,cols:256,format:142,iterations:10,trials:3},
 {rows:128,cols:256,format:143,iterations:10,trials:3},
 {rows:256,cols:512,format:142,iterations:8,trials:3},
 {rows:256,cols:512,format:143,iterations:8,trials:3}
];
async function main(){
 const browser=await chromium.launch({headless:true,
  executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/google-chrome',
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox',
   '--use-webgpu-adapter=swiftshader','--disable-dawn-features=adapter_blocklist',
   '--enable-features=Vulkan','--enable-unsafe-webgpu']});
 let integration=null;
 const results=[],fatal=[],page=await browser.newPage({viewport:{width:1080,height:880}});
 page.on('pageerror',e=>fatal.push('pageerror: '+e.message));
 page.on('console',msg=>{if(msg.type()==='error')console.warn('browser console:',msg.text().slice(0,300))});
 try{
  const response=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:25000});
  if(response?.status()!==200)throw Error('Bench page HTTP '+response?.status());
  const environment=await page.evaluate(async()=>{
   if(!navigator.gpu)return {navigatorGpu:false};
   try{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});return {navigatorGpu:true,hasAdapter:!!a,info:a?.info||null};}
   catch(e){return {navigatorGpu:true,error:String(e)};}
  });
  console.log('BROWSER_GPU_ENV '+JSON.stringify(environment));
  if(!environment.navigatorGpu||!environment.hasAdapter)throw Error('Software WebGPU adapter not available; GPU benchmark NOT executed. '+JSON.stringify(environment));
  page.setDefaultTimeout(210000);
  for(const config of cases){
   const record=await page.evaluate(async options=>await AetherionKernelRace.run(options),config);
   results.push(record);
   const k=config.rows+'x'+config.cols+' format='+config.format;
   console.log('CASE '+k+' / adapter '+record.adapter+' / selected '+JSON.stringify(record.selection));
   for(const candidate of record.reports){
    console.log('  '+candidate.id+': '+candidate.status+' '+(candidate.ms?.toFixed(5)??'—')+' ms / gpu batch dispatch; max_error='+candidate.error+' '+(candidate.reason||''));
   }
   if(!record.software)console.warn('Adapter not recognized as software; identify before using results');
   if(record.reports.some(r=>r.id==='scalar'&&r.status!=='pass'))fatal.push(k+' scalar numerical baseline failed');
   if(!record.reports.some(r=>r.status==='pass'&&r.id==='packed_row'))fatal.push(k+' packed-row implementation did not pass accuracy/compilation');
   if(!record.reports.some(r=>r.status==='pass'&&r.id==='split_k'))fatal.push(k+' split-K implementation did not pass accuracy/compilation');
  }
  // Check the real AETHERION Runtime integration, not merely the tournament page.
  const runtimePage=await browser.newPage({viewport:{width:1080,height:880}});
  try{
   const response=await runtimePage.goto('http://127.0.0.1:8765/runtime/',{waitUntil:'domcontentloaded',timeout:25000});
   if(response?.status()!==200)throw Error('Runtime UI HTTP '+response?.status());
   await runtimePage.waitForFunction(()=>Boolean(window.AetherionAutotuneV2&&window.AetherionPackedSession&&window.AetherionKernelStrategies),{timeout:20000});
   integration=await runtimePage.evaluate(async()=>{
    const rows=128,cols=256,format=142;
    const result=await AetherionAutotuneV2.run({rows,cols,format,trials:3});
    if(!result.winner)throw Error('Eight-way adaptive tuner found no numerically verified winner');
    const fixture=PrismBlocks.packFixture(rows,cols,format,0x32aff);
    const x=PrismBlocks.randomActivation(cols,0x99ff);
    const session=await AetherionPackedSession.create({rows,cols,format,weights:fixture.bytes,preferredVariant:result.winner});
    try{
     const first=await session.multiply(x);
     const second=await session.multiply(x);
     const error=AetherionNativeBench.maxError(first.output,second.output);
     if(error>1e-5||!first.verification.pass||session.info.calls!==2)throw Error('GPU reuse / CPU parity failed '+error);
     return {winner:result.winner,variants:result.results.length,sessionVariant:second.variant,
      sessionFallback:second.fallback,checkedRows:first.verification.checkedRows,
      firstMs:first.ms,secondMs:second.ms,maxOutputDelta:error};
    }finally{session.close();}
   });
   console.log('RUNTIME_INTEGRATION '+JSON.stringify(integration));
  }finally{await runtimePage.close();}
 }catch(e){fatal.push(String(e.stack||e))}
 finally{await browser.close()}
 const outPath=process.env.KERNEL_BENCH_JSON||'kernel-race-results.json';
 const report={date:new Date().toISOString(),platform:'Chromium Headless / SwiftShader software WebGPU CI',
  caveat:'These are real browser shader runs on CPU-backed software WebGPU, NOT mobile hardware or end-to-end model tokens.',
  cases:results,integration,errors:fatal};
 fs.writeFileSync(outPath,JSON.stringify(report,null,2));
 const summary=process.env.GITHUB_STEP_SUMMARY;
 if(summary){
  let text='# AETHERION Native WGSL Kernel Tournament — Software GPU\n\n';
  text+='**Adapter:** '+(results[0]?.adapter||'unavailable')+'\n\n';
  text+='| Case | Scalar | Cooperative | Packed lane | Packed row | Split-K | Predecode | Compact winner |\n';
  text+='|---|---:|---:|---:|---:|---:|---:|---|\n';
  for(const r of results){
   const map=Object.fromEntries(r.reports.map(x=>[x.id,x]));
   const fmt=id=>map[id]?.status==='pass'?map[id].ms.toFixed(4)+'ms':map[id]?.status||'—';
   text+='| '+r.rows+'×'+r.cols+'/'+r.format+' | '+fmt('scalar')+' | '+fmt('lane32')+' | '+fmt('packed_byte')+' | '+fmt('packed_row')+' | '+fmt('split_k')+' | '+fmt('predecode')+' | '+(r.selection.id||'none')+' |\n';
  }
  text+='\n**Runtime integration:** '+(integration?JSON.stringify(integration):'not verified')+'\n';
  text+='\n**Important:** software SwiftShader result cannot predict physical GPU performance. No LLM tokens were generated.\n';
  if(fatal.length)text+='\n**Failures:** '+fatal.join('; ')+'\n';
  fs.appendFileSync(summary,text);
 }
 if(fatal.length){
  console.error('KERNEL GPU EXPERIMENT FAILURES:\n'+fatal.join('\n'));
  process.exitCode=1;
 }else console.log('PASS: '+results.length+' matrices/formats on real browser WebGPU software adapter; CPU parity and 6 independent strategies measured');
}
main().catch(e=>{console.error(e);process.exitCode=1});
