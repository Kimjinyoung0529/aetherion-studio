/* AETHERION Bonsai GGUF Hadamard metadata compatibility tests.
 * Run: node lab/bonsai/test_audit.mjs
 * Validates model header parsing and sign vector consistency, NOT full 2B inference.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const base=new URL('.',import.meta.url);
const context=vm.createContext({TextDecoder,TextEncoder,Uint8Array,Float32Array,Uint32Array,Int8Array,DataView,ArrayBuffer,Map,Blob});
for(const filename of ['gguf.js','audit.js']){
 const src=fs.readFileSync(new URL(filename,base),'utf8');
 vm.runInContext(src+'\n globalThis.'+(filename==='gguf.js'?'Inspector=GGUFInspector;':'Audit=BonsaiAudit;'),context);
}
const {Inspector,Audit}=context;
const writer=[];
const push=x=>writer.push(...x);
const u8=n=>push([n&255]);
const u32=n=>push([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
const u64=n=>{u32(n);u32(0)};
const str=x=>{const enc=new TextEncoder().encode(x);u64(enc.length);push(enc)};
const meta=(key,type,val)=>{
 str(key);u32(type);
 if(type===8)str(val);
 else if(type===4)u32(val);
 else if(type===7)u8(val?1:0);
 else if(type===9){
  const [elem,arr]=val;u32(elem);u64(arr.length);
  for(const x of arr){
   if(elem===8)str(x);
   else if(elem===5)u32(x>>>0);
   else if(elem===4)u32(x);
   else if(elem===7)u8(x?1:0);
   else throw Error('Bad metadata element type');
  }
 }else throw Error('Bad metadata type');
};
function buildGGUF(signValue=1,arch='qwen35'){
 writer.length=0;
 push([71,71,85,70]);u32(3);u64(2);u64(12);
 meta('general.architecture',8,arch);
 meta('general.alignment',4,32);
 meta('prism.hadamard.version',4,1);
 meta('prism.hadamard.block_size',4,1024);
 meta('prism.hadamard.transform',8,'normalized-sylvester-walsh-hadamard');
 meta('prism.hadamard.axis',8,'input-last-dimension');
 meta('prism.hadamard.sign_mode',8,'explicit');
 meta('prism.hadamard.sign_widths',9,[5,[1024]]);
 meta('prism.hadamard.sign_values',9,[5,Array.from({length:1024},(_,i)=>i===8?signValue:(i%2?1:-1))]);
 meta('prism.hadamard.weight_names',9,[8,['blk.0.ffn_gate.weight']]);
 meta('prism.hadamard.inverse_weight_names',9,[8,['token_embd.weight']]);
 meta('qwen35.block_count',4,4);
 str('blk.0.ffn_gate.weight');u32(2);u64(1024);u64(2);u32(143);u64(0);
 str('token_embd.weight');u32(2);u64(1024);u64(1);u32(3);u64(448);
 while(writer.length%32)writer.push(0);
 const tensorPayload=new Uint8Array(448+2048);
 const raw=Uint8Array.from(writer);
 const total=new Uint8Array(raw.byteLength+tensorPayload.byteLength);
 total.set(raw);total.set(tensorPayload,raw.length);
 return {name:'test.gguf',size:total.length,slice:(start,end)=>new Blob([total.subarray(start,end)])};
}
const good=await Inspector.inspect(buildGGUF());
assert.equal(good.metadata['prism.hadamard.block_size'],1024);
assert.equal(good.metadata['prism.hadamard.sign_values'].length,1024);
assert.equal(good.metadata['prism.hadamard.weight_names'][0],'blk.0.ffn_gate.weight');
assert.equal(good.metadata['prism.hadamard.inverse_weight_names'][0],'token_embd.weight');
assert.equal(good.metadata['qwen35.block_count'],4);
const ok=Audit.audit(good);
assert.equal(ok.compatibleMetadata,true,Audit.printable(ok));
assert.equal(ok.errors,0);
assert.equal(ok.info.folded,1);
assert.equal(ok.info.layers,4);
assert.equal(ok.info.recurrent,3);
assert.equal(ok.info.full,1);
assert.equal(ok.signTables.get(1024).length,1024);
const brokenSign=await Inspector.inspect(buildGGUF(255));
const invalid=Audit.audit(brokenSign);
assert.equal(invalid.compatibleMetadata,false);
assert.ok(invalid.errors>0);
assert.match(Audit.printable(invalid),/부호 값은/);
const wrongArch=await Inspector.inspect(buildGGUF(1,'llama'));
const wrongAudit=Audit.audit(wrongArch);
assert.equal(wrongAudit.compatibleMetadata,false);
assert.ok(wrongAudit.errors>0);
const missingSigns={...good,metadata:{...good.metadata,'prism.hadamard.sign_widths':[]}};
assert.equal(Audit.audit(missingSigns).compatibleMetadata,false);
console.log('PASS GGUF Hadamard metadata parse, sign vectors, fold paths, hybrid layer audit');
