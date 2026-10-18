/* AETHERION Universal Runtime v1
 * Own scheduler/benchmark adapter. Wllama handles GGUF kernels, MLC handles
 * precompiled MLC models. No claim of native universal WGSL model execution.
 * Compatible backends may change with upstream releases.
 */
'use strict';
const AetherionUniversal=(()=>{
 const WLLAMA_CDN='https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js';
 const WLLAMA_WASM='https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm';
 const WEBLLM_CDN='https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
 const defaults={system:'You are a helpful and precise local assistant. Reply in Korean unless otherwise requested.',maxTokens:120,temperature:.3};
 const now=()=>performance.now();
 function extract(chunk){
  if(typeof chunk==='string')return chunk;
  return String(chunk?.choices?.[0]?.delta?.content??chunk?.choices?.[0]?.text??'');
 }
 function tokenUsage(chunk){
  const u=chunk?.usage;return Number.isSafeInteger(u?.completion_tokens)?u.completion_tokens:null;
 }
 async function ggufAdapter(model,opts,notify,dependencies={}){
  const importer=dependencies.importer||(url=>import(url));
  const {Wllama}=await importer(WLLAMA_CDN);
  if(typeof Wllama!=='function')throw Error('Wllama constructor missing');
  const runtime=new Wllama({default:WLLAMA_WASM},{parallelDownloads:opts.parallelDownloads,allowOffline:false});
  let succeeded=false;
  try{
   runtime.setCompat?.('default','safari');
   if(runtime.isSupportWebGPU&&!runtime.isSupportWebGPU())throw Error('이 Wllama 실행 환경에는 WebGPU 지원이 없습니다.');
   const onProgress=p=>{
    const fraction=p?.total>0?p.loaded/p.total:(Number.isFinite(p?.progress)?p.progress:null);
    if(Number.isFinite(fraction))notify?.({kind:'download',fraction:Math.max(0,Math.min(1,fraction))});
   };
   const {parallelDownloads,cache_prompt,...settings}=opts;
   settings.progressCallback=onProgress;
   settings.useCache=true;
   if(model.files?.length){
    if(model.files.some(f=>f.size>2000000000))throw Error('2GB를 넘는 단일 로컬 파일은 GGUF 분할이 필요합니다.');
    await runtime.loadModel(model.files,settings);
   }else{
    const url=AetherionTuner.validateSource(model.url);
    await runtime.loadModelFromUrl(url,settings);
   }
   if(!runtime.isModelLoaded())throw Error('Wllama 모델 로드 완료 확인 실패');
   succeeded=true;
   return {
    backend:'gguf',modelKey:model.id||model.url||model.files.map(f=>f.name).join(';'),
    runtime,settings,context:runtime.getLoadedContextInfo?.(),
    async chat(messages,{maxTokens=120,temperature=.3,onDelta,signal}={}){
     const began=now();let first=null,seen=0,text='',usage=null;
     const response=await runtime.createChatCompletion({
      messages,max_tokens:maxTokens,temperature,top_p:.9,
      cache_prompt:true,stream:true,abortSignal:signal,
      onData(chunk){
       const part=extract(chunk);const used=tokenUsage(chunk);
       if(used!==null)usage=used;
       if(part){
        if(first===null)first=now();
        text+=part;seen++;
        onDelta?.(part);
       }
      }
     });
     if(!text&&response?.choices?.[0]?.message?.content)text=String(response.choices[0].message.content);
     const from=now(),count=usage||seen;
     return {text,ttftMs:first===null?null:first-began,totalMs:from-began,
      count,unit:usage?'tokens':'chunks',backend:'gguf',modelKey:model.id||model.url||model.files?.map(f=>f.name).join(';'),
      usageKnown:usage!==null};
    },
    async close(){await runtime.exit?.();}
   };
  }finally{
   if(!succeeded)try{await runtime.exit?.()}catch{}
  }
 }
 async function mlcAdapter(model,opts,notify,dependencies={}){
  const importer=dependencies.importer||(url=>import(url));
  const mlc=await importer(WEBLLM_CDN);
  const catalog=mlc.prebuiltAppConfig?.model_list||[];
  const match=catalog.find(x=>x.model_id===model.id);
  if(!match)throw Error('선택된 ID가 이 버전의 WebLLM 공식 모델 카탈로그에 없습니다. 다른 모델을 골라 주세요.');
  if(typeof mlc.CreateMLCEngine!=='function')throw Error('WebLLM CreateMLCEngine API 누락');
  const engine=await mlc.CreateMLCEngine(model.id,{initProgressCallback:p=>{
   const frac=Number(p?.progress);
   if(Number.isFinite(frac))notify?.({kind:'download',fraction:Math.max(0,Math.min(1,frac))});
   notify?.({kind:'log',text:p?.text||'모델 준비 중'});
  }});
  return {
   backend:'mlc',modelKey:model.id,settings:{context:'upstream-compiled',backend:'MLC WebGPU'},runtime:engine,
   async chat(messages,{maxTokens=120,temperature=.3,onDelta,signal}={}){
    const began=now();let first=null,seen=0,text='',usage=null;
    const iterable=await engine.chat.completions.create({
     messages,max_tokens:maxTokens,temperature,top_p:.9,stream:true,
     stream_options:{include_usage:true}
    });
    for await(const chunk of iterable){
     if(signal?.aborted)break;
     const part=extract(chunk),used=tokenUsage(chunk);
     if(used!==null)usage=used;
     if(part){if(first===null)first=now();text+=part;seen++;onDelta?.(part);}
    }
    const totalMs=now()-began;
    return {text,ttftMs:first===null?null:first-began,totalMs,
     count:usage||seen,unit:usage?'tokens':'chunks',usageKnown:usage!==null,
     backend:'mlc',modelKey:model.id};
   },
   async close(){await engine.unload?.();}
  };
 }
 async function inspectGpu(dependencies={}){
  const gpu=dependencies.gpu||(typeof navigator!=='undefined'?navigator.gpu:null);
  if(!gpu?.requestAdapter)throw Error('WebGPU 장치를 지원하지 않는 브라우저입니다.');
  const adapter=await gpu.requestAdapter({powerPreference:'high-performance'})||await gpu.requestAdapter();
  if(!adapter)throw Error('WebGPU 어댑터가 없습니다');
  const info=adapter.info||{};
  const device=await adapter.requestDevice();
  try{return {
   key:[info.vendor,info.device,info.architecture].filter(Boolean).join('/')||'unknown-device',
   label:[info.vendor,info.device].filter(Boolean).join(' / ')||'GPU',
   maxStorageBufferBindingSize:device.limits.maxStorageBufferBindingSize,
   maxBufferSize:device.limits.maxBufferSize,
   shaderF16:device.features.has('shader-f16')
  };}finally{device.destroy();}
 }
 async function load(model,opts,notify,dependencies={}){
  if(model.backend==='gguf')return ggufAdapter(model,opts,notify,dependencies);
  if(model.backend==='mlc')return mlcAdapter(model,opts,notify,dependencies);
  throw Error('알 수 없는 로컬 모델 백엔드');
 }
 async function catalog(dependencies={}){
  const importer=dependencies.importer||(url=>import(url));
  const mlc=await importer(WEBLLM_CDN);
  return (mlc.prebuiltAppConfig?.model_list||[]).map(x=>({
   id:x.model_id,name:x.model_id,
   vramMB:x.vram_required_MB??null
  })).filter(x=>x.id);
 }
 return Object.freeze({load,catalog,inspectGpu,extract,tokenUsage,ggufAdapter,mlcAdapter});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionUniversal=AetherionUniversal;
