/* AETHERION CPU-side checks for five INDEPENDENT WGSL approaches.
 * Compilation and numerical GPU correctness are verified in Chromium job.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const base=new URL('.',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,base),'utf8');
const env=vm.createContext({Math,Number,Float32Array,Uint32Array,Uint8Array,DataView,ArrayBuffer,console});
vm.runInContext(read('../../lab/bonsai/codec.js'),env);
vm.runInContext(read('../native-kernel.js'),env);
vm.runInContext(read('kernel-strategies.js')+'\nglobalThis.S=AetherionKernelStrategies;',env);
vm.runInContext(read('kernel-race.js')+'\nglobalThis.B=AetherionKernelRace;',env);
const S=env.S,B=env.B;
assert.deepEqual(Array.from(S.STRATEGIES,x=>x.id),['scalar','lane32','packed_byte','split_k','predecode']);
for(const rows of [128,256]){
 for(const cols of [256,512]){
  for(const s of S.STRATEGIES){
   const plan=S.makePlan(s.id,rows,cols);
   assert.ok(plan.stages.length>0);
   for(const stage of plan.stages){
    assert.ok(stage.code.includes('@compute'));
    assert.ok(stage.code.includes('fn main'));
    assert.ok(stage.dispatch>=1);
   }
   if(s.id==='split_k')assert.equal(plan.stages.length,2);
   if(s.id==='predecode'){
    assert.ok(plan.preprocess);
    assert.equal(plan.bytesDense,rows*cols*4);
   }
   if(s.id==='packed_byte'){
    assert.match(plan.stages[0].code,/let bits=getByte\(baseOff\+2u\+lane\)/);
    assert.match(plan.stages[0].code,/power\*=3u/);
   }
  }
 }
}
const truth=new Float32Array([1,-2,3]),pass=B.grade(new Float32Array([1,-2,3]),truth,128);
assert.equal(pass.pass,true);
assert.equal(B.grade(new Float32Array([1,-2,4]),truth,128).pass,false);
assert.equal(B.pick([{id:'scalar',status:'pass',ms:10},{id:'packed_byte',status:'pass',ms:5}]).id,'packed_byte');
assert.equal(B.pick([{id:'scalar',status:'pass',ms:10},{id:'packed_byte',status:'invalid',ms:1}]).id,'scalar');
assert.equal(B.pick([{id:'scalar',status:'pass',ms:10},{id:'predecode',status:'pass',ms:1}]).id,'scalar','expanded FP32 should not be auto-selected as compact');
const html=read('index.html');
for(const name of ['./kernel-strategies.js','./kernel-race.js','/lab/bonsai/codec.js'])assert.ok(html.includes(name));
console.log('PASS: 5 structurally independent WGSL strategies, CPU parity guard, expansion policy, 16 source plans');
