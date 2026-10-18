/* AETHERION GPU session v2.1 regression — simulate device, shader selection, reused GPU buffers.
 * Deliberately corrupt candidate GPU output to verify automatic serial rollback.
 * CPU-backed fake GPU DOES NOT establish real hardware speed or shader compilation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('.',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const ctx=vm.createContext({Uint8Array,Uint32Array,Float32Array,Math,Number,ArrayBuffer,DataView,console,Array,Map,performance});
vm.runInContext(read('../lab/bonsai/codec.js'),ctx);
vm.runInContext(read('native-kernel.js'),ctx);
vm.runInContext(read('autotune-v2.js'),ctx);
const PB=vm.runInContext('PrismBlocks',ctx);
let lastDevice=null,corruptCandidate=false,corruptSerial=false;
function makeDevice(){
 const buffers=[];
 const makeBuffer=({size})=>{
  const b={memory:new ArrayBuffer(size),destroyed:false,destroy(){this.destroyed=true},
   async mapAsync(){},getMappedRange(){return this.memory},unmap(){}};
  buffers.push(b);return b;
 };
 const queue={
  writeBuffer(buffer,offset,data){
   const src=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
   new Uint8Array(buffer.memory,offset,src.length).set(src);
  },
  submit(commands){
   for(const job of commands){
    const entries=Object.fromEntries(job.bind.entries.map(e=>[e.binding,e.resource.buffer]));
    const config=new Uint32Array(entries[3].memory);
    const [rows,cols,format]=config;
    const activation=new Float32Array(entries[0].memory,0,cols);
    const weights=new Uint8Array(entries[1].memory);
    const values=new Float32Array(entries[2].memory);
    const parallel=job.pipeline.code.includes('scratch:array<f32,256>');
    for(let r=0;r<rows;r++){
     let total=0;
     for(let c=0;c<cols;c++){
      const block=r*(cols/128)+(c>>>7);
      total=Math.fround(total+Math.fround(PB.decodeAt(weights,block,c%128,format)*activation[c]));
     }
     values[r]=parallel&&corruptCandidate?total+10:(!parallel&&corruptSerial?total+10:total);
    }
    for(const [src,dst,bytes] of job.copies){
     new Uint8Array(dst.memory,0,bytes).set(new Uint8Array(src.memory,0,bytes));
    }
   }
  }
 };
 const device={
  limits:{maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupSizeX:256,maxComputeWorkgroupSizeY:256,maxBufferSize:2**26,maxStorageBufferBindingSize:2**26},
  lost:new Promise(()=>{}),destroyed:false,createBuffer:makeBuffer,queue,
  createShaderModule:({code})=>({code,getCompilationInfo:async()=>({messages:[]})}),
  createComputePipelineAsync:async({compute:{module}})=>({code:module.code,getBindGroupLayout:()=>({})}),
  createBindGroup:({entries})=>({entries}),
  createCommandEncoder:()=>{const job={pipeline:null,bind:null,copies:[]};return {
   beginComputePass:()=>({
    setPipeline(p){job.pipeline=p;},setBindGroup(_id,b){job.bind=b;},
    dispatchWorkgroups(){},end(){}
   }),
   copyBufferToBuffer(src,_s,dst,_d,bytes){job.copies.push([src,dst,bytes]);},
   finish(){return job}
  }},
  destroy(){this.destroyed=true},
  buffers
 };
 lastDevice=device;return device;
}
ctx.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,MAP_READ:8,UNIFORM:16};
ctx.GPUMapMode={READ:1};
ctx.isSecureContext=true;
ctx.navigator={gpu:{requestAdapter:async()=>({info:{vendor:'mock'},requestDevice:async()=>makeDevice()})}};
vm.runInContext(read('native-session.js')+'\nglobalThis.S=AetherionPackedSession;',ctx);
const S=ctx.S;
const fixture=PB.packFixture(16,128,143,889),x=PB.randomActivation(128,77);
assert.equal(S.shape(16,128,143,fixture.bytes),16*28);
assert.throws(()=>S.shape(16,128,140,fixture.bytes),/지원하지/);
assert.throws(()=>S.shape(16,128,143,new Uint8Array(3)),/길이/);
const expected=S.sampledReference(fixture.bytes,16,128,143,x);
assert.equal(expected.checkedRows,16);
const wrong=S.compareRows(expected,new Float32Array(16).fill(400),128);
assert.equal(wrong.pass,false);
const session=await S.create({rows:16,cols:128,format:143,weights:fixture.bytes,preferredVariant:'lane32'});
const a=await session.multiply(x),b=await session.multiply(x);
assert.equal(a.variant,'lane32');
assert.equal(a.fallback,false);
assert.equal(a.verification.pass,true);
assert.equal(a.verification.checkedRows,16);
assert.equal(session.info.calls,2);
assert.equal(PB.maxError(a.output,b.output),0);
assert.equal(lastDevice.buffers.length,5,'matrix, vectors, uniforms, output, and readback allocated only once');
session.close();
assert.equal(lastDevice.destroyed,true);
for(const buffer of lastDevice.buffers)assert.equal(buffer.destroyed,true);
await assert.rejects(()=>session.multiply(x),/종료/);
corruptCandidate=true;
const rollback=await S.create({rows:16,cols:128,format:143,weights:fixture.bytes,preferredVariant:'lane32'});
const fixed=await rollback.multiply(x);
assert.equal(fixed.variant,'serial');
assert.equal(fixed.fallback,true);
assert.equal(fixed.verification.pass,true);
assert.equal(rollback.info.calls,1);
rollback.close();
corruptCandidate=false;corruptSerial=true;
const broken=await S.create({rows:16,cols:128,format:143,weights:fixture.bytes,preferredVariant:'serial'});
await assert.rejects(()=>broken.multiply(x),/직렬 기준 GPU에서도 CPU 수치 검증에 실패/);
broken.close();
const page=read('index.html'),ui=read('autotune-ui.js');
for(const id of ['autoSession','autoSessionResult','autoSessionMs','autoSessionDetail'])assert.ok(page.includes('id="'+id+'"'));
assert.match(page,/native-session\.js\?v=2/);
assert.match(ui,/AetherionPackedSession\.create/);
console.log('PASS native v2.1 persistent GPU buffers, two forwards, numerical parity and forced serial fallback on corrupted output');
