/* AETHERION Runtime Optimizer v1.0
 * Device-aware, conservative heuristics + comparable benchmark records.
 * No "guaranteed faster" claims. Pure first-party JS; no external dependencies.
 */
'use strict';
const AetherionTuner=(()=>{
 const PROFILES=Object.freeze({
  safe:{label:'안정',threads:1,gpuMobile:2,gpuDesktop:4,ctxMobile:512,ctxDesktop:1024,batchMobile:32,batchDesktop:64,microMobile:16,microDesktop:32,downloads:2},
  balanced:{label:'균형',threads:2,gpuMobile:4,gpuDesktop:12,ctxMobile:768,ctxDesktop:1536,batchMobile:64,batchDesktop:128,microMobile:32,microDesktop:64,downloads:3},
  turbo:{label:'고속',threads:4,gpuMobile:12,gpuDesktop:32,ctxMobile:1024,ctxDesktop:2048,batchMobile:128,batchDesktop:256,microMobile:64,microDesktop:128,downloads:5}
 });
 const integer=(v,low,high)=>Math.max(low,Math.min(high,Math.trunc(v)));
 function estimate(options={}){
  const {profile='balanced',mobile=false,hardwareConcurrency=2,crossOriginIsolated=false,ctx,overrideGpu}=options;
  const p=PROFILES[profile];
  if(!p)throw Error('지원하지 않는 튜닝 모드: '+profile);
  const cores=Number.isFinite(Number(hardwareConcurrency))?integer(Number(hardwareConcurrency),1,64):1;
  const threads=crossOriginIsolated?integer(Math.min(cores-1,p.threads),1,4):1;
  const n_ctx=ctx===undefined?mobile?p.ctxMobile:p.ctxDesktop:integer(ctx,256,4096);
  const n_gpu_layers=overrideGpu===undefined?(mobile?p.gpuMobile:p.gpuDesktop):integer(overrideGpu,0,99);
  const n_batch=mobile?p.batchMobile:p.batchDesktop;
  const n_ubatch=Math.min(n_batch,mobile?p.microMobile:p.microDesktop);
  return Object.freeze({
   n_ctx,n_gpu_layers,n_batch,n_ubatch,n_threads:threads,n_parallel:1,
   warmup:false,parallelDownloads:p.downloads,
   cache_prompt:true
  });
 }
 function validateSource(input){
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('HTTPS 모델 URL만 허용합니다 (계정 정보 제외).');
  if(!/\.gguf(?:$|-)/i.test(url.pathname)&&!/\.gguf$/i.test(url.pathname))throw Error('URL은 .gguf 파일을 가리켜야 합니다.');
  return url.toString();
 }
 function modelIdentity({backend,id}){
  return String(backend||'unknown')+':'+String(id||'unknown').trim();
 }
 function median(numbers){
  const a=numbers.filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
  if(!a.length)return null;
  const mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
 }
 function summarize(times,tokenCount,units){
  const ttft=median(times.map(x=>x.ttft));
  const decodeRates=times.map(x=>{
   const decodeMs=x.totalMs-x.ttft;
   return decodeMs>0 && x.count>1?(x.count-1)/(decodeMs/1000):null;
  }).filter(x=>x!==null);
  return {
   ttftMs:ttft,totalMs:median(times.map(x=>x.totalMs)),rate:median(decodeRates),
   unit:units==='tokens'?'token/s':'chunks/s',runs:times.length,
   tokens:tokenCount||null
  };
 }
 function compare(a,b){
  const fields=['backend','modelKey','deviceKey','promptKey','maxTokens','unit'];
  if(fields.some(k=>a?.[k]!==b?.[k]))return {comparable:false,reason:'같은 모델·GPU·프롬프트·출력 설정·측정 단위가 아니므로 비교하지 않습니다.'};
  if(!(a.rate>0&&b.rate>0))return {comparable:false,reason:'유효한 두 생성 속도 측정이 필요합니다.'};
  return {comparable:true,ratio:b.rate/a.rate,percent:(b.rate/a.rate-1)*100};
 }
 function benchKey(s){
  return [s.backend,s.modelKey,s.deviceKey,s.promptKey,s.maxTokens,s.unit].join('||');
 }
 function formatSize(bytes){
  if(!Number.isFinite(bytes)||bytes<0)return '정보 없음';
  return bytes>=1e9?(bytes/1e9).toFixed(2)+' GB':(bytes/1e6).toFixed(1)+' MB';
 }
 return Object.freeze({PROFILES,estimate,validateSource,modelIdentity,median,summarize,compare,benchKey,formatSize});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionTuner=AetherionTuner;
