/* AETHERION Runtime unit / mock-adapter validation.
 * The mocked backend does not prove GPU speed. Browser device tests are manual.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('.',import.meta.url);
const read=(p)=>fs.readFileSync(new URL(p,root),'utf8');
const context=vm.createContext({URL,console,performance,Number,Object,String,Math});
vm.runInContext(read('tuner.js')+'\n globalThis.T=AetherionTuner;',context);
vm.runInContext(read('engine.js')+'\n globalThis.E=AetherionUniversal;',context);
const T=context.T,E=context.E;
assert.equal(T.estimate({profile:'safe',mobile:true,hardwareConcurrency:2}).n_gpu_layers,2);
assert.equal(T.estimate({profile:'balanced',mobile:true,hardwareConcurrency:4}).n_batch,64);
assert.equal(T.estimate({profile:'turbo',mobile:false,hardwareConcurrency:8,crossOriginIsolated:true}).n_threads,4);
assert.equal(T.estimate({profile:'turbo',hardwareConcurrency:2,crossOriginIsolated:false}).n_threads,1);
assert.ok(T.validateSource('https://huggingface.co/some/repo/resolve/main/model.gguf').endsWith('.gguf'));
for(const bad of ['http://example.org/m.gguf','https://user:pass@example.org/m.gguf','https://example.org/m.safetensors']){
 assert.throws(()=>T.validateSource(bad));
}
assert.equal(T.median([1,9,5]),5);
assert.equal(T.median([9,5,1,2]),3.5);
const sample=T.summarize([{ttft:120,totalMs:1200,count:21},{ttft:100,totalMs:1100,count:21}],null,'tokens');
assert.equal(sample.unit,'token/s');
assert.ok(sample.rate>15&&sample.rate<21);
const base={backend:'gguf',modelKey:'m.gguf',deviceKey:'gpuA',promptKey:'abc',maxTokens:48,unit:'tokens',rate:10};
assert.equal(T.compare(base,{...base,rate:20}).ratio,2);
assert.equal(T.compare(base,{...base,modelKey:'x',rate:20}).comparable,false);
assert.equal(T.compare(base,{...base,unit:'chunks/s',rate:20}).comparable,false);
class FakeWllama{
 constructor(){this.loaded=false;this.closed=false;}
 setCompat(){this.compat=true}
 isSupportWebGPU(){return true}
 async loadModelFromUrl(url,opts){this.url=url;this.opts=opts;this.loaded=true}
 async loadModel(files,opts){this.files=files;this.opts=opts;this.loaded=true}
 isModelLoaded(){return this.loaded}
 getLoadedContextInfo(){return {n_ctx:768,n_layer:32}}
 async createChatCompletion(args){
  assert.ok(args.cache_prompt);
  args.onData({choices:[{delta:{content:'안녕'}}]});
  args.onData({choices:[{delta:{content:' 세계'}}]});
  args.onData({usage:{completion_tokens:3}});
 }
 async exit(){this.closed=true}
}
const importer=async(url)=>{
 if(url.includes('wllama'))return {Wllama:FakeWllama};
 if(url.includes('web-llm'))return {
  prebuiltAppConfig:{model_list:[{model_id:'Qwen3-0.6B-q4f16_1-MLC',vram_required_MB:1400}]},
  CreateMLCEngine:async()=>{
   return {chat:{completions:{create:async()=>({
    async *[Symbol.asyncIterator](){
     yield {choices:[{delta:{content:'hello'}}]};
     yield {choices:[{delta:{content:' world'}}]};
     yield {usage:{completion_tokens:3},choices:[]};
    }
   })}},unload:async()=>{}};
  }
 };
 throw Error('Unexpected module URL '+url);
};
const opts=T.estimate({profile:'balanced',mobile:false,hardwareConcurrency:4,crossOriginIsolated:false});
const gguf=await E.load({backend:'gguf',url:'https://models.example/test.gguf',id:'test.gguf'},opts,()=>{},{importer});
assert.equal(gguf.context.n_layer,32);
assert.equal(gguf.runtime.opts.n_gpu_layers,12);
assert.equal(gguf.runtime.opts.parallelDownloads,undefined);
const result=await gguf.chat([{role:'user',content:'say hi'}],{maxTokens:8});
assert.equal(result.text,'안녕 세계');
assert.equal(result.unit,'tokens');
assert.equal(result.count,3);
await gguf.close();
assert.equal(gguf.runtime.closed,true);
const ggufFiles=await E.load({backend:'gguf',id:'files',files:[{name:'part.gguf',size:1000}]},opts,null,{importer});
assert.equal(ggufFiles.runtime.files.length,1);
await ggufFiles.close();
// WebGPU must NOT be required for explicit n_gpu_layers=0 GGUF CPU fallback.
class NoGpuWllama extends FakeWllama {
 isSupportWebGPU(){return false}
}
const noGpuImporter=async(url)=>{
 if(url.includes('wllama'))return {Wllama:NoGpuWllama};
 throw Error('Unexpected import '+url);
};
const cpuSettings={...opts,n_gpu_layers:0};
const ggufCPU=await E.load({backend:'gguf',url:'https://models.example/cpu.gguf'},cpuSettings,null,{importer:noGpuImporter});
assert.equal(ggufCPU.runtime.opts.n_gpu_layers,0);
assert.equal(ggufCPU.runtime.isSupportWebGPU(),false);
await ggufCPU.close();
await assert.rejects(
 ()=>E.load({backend:'gguf',url:'https://models.example/must-have-gpu.gguf'},opts,null,{importer:noGpuImporter}),
 /WebGPU/
);

const catalog=await E.catalog({importer});
assert.equal(catalog[0].id,'Qwen3-0.6B-q4f16_1-MLC');
const mlc=await E.load({backend:'mlc',id:'Qwen3-0.6B-q4f16_1-MLC'},opts,null,{importer});
const out=await mlc.chat([{role:'user',content:'say hello'}],{maxTokens:8});
assert.equal(out.text,'hello world');
assert.equal(out.count,3);
assert.equal(out.unit,'tokens');
await mlc.close();
await assert.rejects(()=>E.load({backend:'mlc',id:'NotListed'},opts,null,{importer}),/카탈로그/);
assert.equal(E.extract({choices:[{delta:{content:'ok'}}]}),'ok');
const html=read('index.html'),app=read('app.js'),tuner=read('tuner.js');
const ids=[...new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(x=>x[1]))];
for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'unmatched DOM id: '+id);
assert.match(app,/benchmark\(/);assert.match(tuner,/parallelDownloads/);
assert.match(app,/CPU-only \/ WebGPU 불필요|CPU-only/);
assert.match(html,/GPU 레이어 = 0/);
console.log('PASS AETHERION runtime tuning, source validation, benchmark comparability, GGUF+MLC mocks, UI linkage ('+ids.length+' controls)');
