/* AETHERION WebGPU v2 autotune CPU tests.
 * Browser-only GPU execution/compilation is intentionally NOT claimed by CI.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('.',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const ctx=vm.createContext({Uint8Array,Uint32Array,Float32Array,Math,Number,ArrayBuffer,DataView,console,Array});
vm.runInContext(read('../lab/bonsai/codec.js'),ctx);
vm.runInContext(read('native-kernel.js'),ctx);
vm.runInContext(read('experiments/kernel-strategies.js'),ctx);
vm.runInContext(read('autotune-v2.js')+'\nglobalThis.V2=AetherionAutotuneV2;',ctx);
const V=ctx.V2;
assert.equal(V.VARIANTS.length,8);
assert.deepEqual(Array.from(V.VARIANTS,x=>x.id),['serial','packed_row','lane8','lane16','lane32','lane64','tile16x8','tile32x8']);
const limits={maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupSizeX:256,maxComputeWorkgroupSizeY:256};
const lowLimits={...limits,maxComputeInvocationsPerWorkgroup:128};
assert.equal(V.deviceAllowed(V.VARIANTS[7],limits),true);
assert.equal(V.deviceAllowed(V.VARIANTS[5],lowLimits),false);
assert.equal(V.deviceAllowed(V.VARIANTS[3],lowLimits),true);
for(const candidate of V.VARIANTS){
 const shader=V.shader(candidate);
 assert.match(shader,/fn getTrit/,'Prism PTQ/PQ codec needed');
 assert.match(shader,/fn blockScale/);
 assert.match(shader,/unpack2x16float/);
 assert.match(shader,/workgroup_size/);
 assert.match(shader,/y\[row\]/);
 if(candidate.id==='serial'||candidate.id==='packed_row')assert.match(shader,/@workgroup_size\(64\)/);
 else{
  const {lanes,tileRows}=candidate;
  assert.match(shader,new RegExp('@workgroup_size\\('+lanes+','+tileRows+'\\)'));
  assert.match(shader,/workgroupBarrier\(\)/);
  assert.match(shader,/scratch\[slot\]\+=scratch\[slot\+step\]/);
  assert.doesNotMatch(shader,/if\(row>=cfg\.rows\)\{return;\}/);
  assert.ok(lanes*tileRows<=256);
 }
}
const baseline={id:'serial',name:'기준',status:'pass',ms:10,jitter:0.02,error:0};
const candidate=(id,ms,status='pass',jitter=.03)=>({id,name:id,status,ms,jitter,error:0});
const choose=(rs)=>V.selectWinner([baseline,...rs]);
assert.equal(choose([candidate('lane32',3)]).winner.id,'lane32');
assert.equal(choose([candidate('lane8',9.6)]).winner.id,'serial','less than 8% improvement ignored');
assert.equal(choose([candidate('lane64',1,'invalid'),candidate('lane16',8)]).winner.id,'lane16','invalid numerical output discarded');
assert.equal(choose([candidate('lane64',.1,'error')]).winner.id,'serial','compile failure discarded');
assert.equal(choose([candidate('lane32',1,'pass',.99)]).winner.id,'serial','high jitter rejected');
assert.equal(V.selectWinner([candidate('lane16',.2)]).winner,null,'invalid baseline prevents adoption');
assert.equal(V.selectWinner([{...baseline,status:'invalid'},candidate('lane32',2)]).winner,null,'failed baseline prevents adoption');
assert.ok(Math.abs(V.median([6,1,4,5])-4.5)<.001);
assert.ok(V.deviation([10,10,10,10])===0);
const code=read('autotune-v2.js'),ui=read('autotune-ui.js'),page=read('index.html');
assert.match(code,/PrismBlocks\.referenceMatvec/);
assert.match(code,/AetherionNativeBench\.maxError/);
assert.match(code,/dispatch\(true\)/);
assert.match(code,/if\(err>threshold\)/);
assert.match(code,/selectWinner\(results\)/);
assert.match(code,/onSubmittedWorkDone/);
assert.match(ui,/AetherionAutotuneV2\.run|E\.run/);
for(const id of ['autoRows','autoCols','autoFormat','autoRun','autoDownload','autoProgress','autoResults','autoWinner','autoSpeedup','autoReason','autoDevice','autoThreshold']){
 assert.ok(page.includes('id="'+id+'"'),'Missing HTML ID '+id);
}
assert.match(page,/src="\.\/autotune-v2\.js\?v=2"/);
assert.match(page,/src="\.\/autotune-ui\.js\?v=3"/);
console.log('PASS 8 GPU kernels, parallel shader constraints, 7 selection/fallback rules, CPU parity guards and UI bindings');
