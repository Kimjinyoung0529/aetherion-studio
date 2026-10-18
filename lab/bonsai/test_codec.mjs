/* npm-free correctness tests for AETHERION native Prism quantization.
 * Run: node lab/bonsai/test_codec.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const dirname=new URL('.',import.meta.url);
const source=fs.readFileSync(new URL('codec.js',dirname),'utf8');
const inspector=fs.readFileSync(new URL('gguf.js',dirname),'utf8');
const ctx=vm.createContext({TextDecoder,console,Uint8Array,Float32Array,Uint32Array,DataView,ArrayBuffer});
vm.runInContext(source+'\n globalThis.codec=PrismBlocks;',ctx,{filename:'codec.js'});
vm.runInContext(inspector+'\n globalThis.inspector=GGUFInspector;',ctx,{filename:'gguf.js'});
const C=ctx.codec,I=ctx.inspector;
let n=0;
for(const [rows,cols] of [[1,128],[2,128],[3,256],[4,512],[16,1024],[32,2048]]){
 for(const fmt of [142,143]){
  const fixture=C.packFixture(rows,cols,fmt,0xabcde);
  assert.equal(fixture.bytes.length,rows*(cols/128)*C.FORMATS[fmt].bytes);
  const decoded=C.decodeMatrix(fixture.bytes,rows,cols,fmt);
  assert.equal(C.maxError(decoded,fixture.reference),0);
  const vector=C.randomActivation(cols);
  const a=C.referenceMatvec(decoded,rows,cols,vector);
  const b=C.referenceMatvec(fixture.reference,rows,cols,vector);
  assert.equal(C.maxError(a,b),0);
  n++;
 }
}
// Independent digit reconstruction on all possible 5-trit codes (not using codec's packFixture).
const pow=[1,3,9,27,81];
for(let value=0;value<243;value++){
 const digits=[];let v=value;for(let j=4;j>=0;j--){digits[j]=v%3;v=Math.floor(v/3)}
 const encoded=Math.floor((value*256+242)/243);
 for(let j=0;j<5;j++){
  const recovered=((((encoded*pow[j])&255)*3)>>>8);
  assert.equal(recovered,digits[j]);
  n++;
 }
}
function fakeGGUF(fixture,fmt){
 const chunks=[];
 function push(a){chunks.push(Uint8Array.from(a))}
 function u32(v){push([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255])}
 function u64(v){u32(v);u32(0)}
 function str(s){const enc=new TextEncoder().encode(s);u64(enc.length);chunks.push(enc)}
 push([71,71,85,70]);u32(3);u64(1);u64(2); // 1 tensor, 2 KV metadata
 str('general.alignment');u32(4);u32(32);
 str('general.architecture');u32(8);str('qwen3_5');
 str('blk.0.ffn_down.weight');u32(2);u64(fixture.cols);u64(fixture.rows);u32(fmt);u64(0);
 const contentLen=chunks.reduce((s,b)=>s+b.length,0),padding=(32-contentLen%32)%32;
 push(new Uint8Array(padding));chunks.push(fixture.bytes);
 const all=new Uint8Array(chunks.reduce((s,b)=>s+b.length,0));let pos=0;
 for(const chunk of chunks){all.set(chunk,pos);pos+=chunk.length;}
 return {name:'sample.gguf',size:all.length,slice:(start,end)=>new Blob([all.subarray(start,end)])};
}
for(const fmt of [142,143]){
 const original=C.packFixture(8,512,fmt);
 const file=fakeGGUF(original,fmt);
 const meta=await I.inspect(file);
 assert.equal(meta.nTensors,1);
 assert.equal(meta.supportedCount,1);
 assert.equal(meta.metadata['general.architecture'],'qwen3_5');
 assert.equal(meta.tensors[0].type,fmt);
 const sample=await I.readTensorRows(file,meta,meta.tensors[0],4);
 assert.equal(sample.rows,4);assert.equal(sample.cols,512);
 const decoded=C.decodeMatrix(sample.bytes,sample.rows,sample.cols,fmt);
 assert.equal(C.maxError(decoded,original.reference.slice(0,4*512)),0);
 n++;
}
console.log('PASS native Bonsai PTQ/PQ codec, reference trits and streaming GGUF:',n,'assertion groups');
