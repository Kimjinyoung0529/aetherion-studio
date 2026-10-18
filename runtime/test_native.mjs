/* AETHERION Native WGSL PTQ/PQ kernel offline checks.
 * GPU pipeline compilation / speed requires a WebGPU browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('.',import.meta.url);
const code=fs.readFileSync(new URL('native-kernel.js',root),'utf8');
const codec=fs.readFileSync(new URL('../lab/bonsai/codec.js',root),'utf8');
const ctx=vm.createContext({Uint8Array,Uint32Array,Float32Array,Math,Number,ArrayBuffer,DataView,console});
vm.runInContext(codec+'\nglobalThis.PB=PrismBlocks;',ctx);
vm.runInContext(code+'\nglobalThis.N=AetherionNativeBench;',ctx);
const N=ctx.N,PB=ctx.PB;
assert.match(N.SERIAL,/@compute @workgroup_size\(64\)/);
assert.match(N.PARALLEL,/@compute @workgroup_size\(32,4\)/);
assert.match(N.PARALLEL,/workgroupBarrier\(\)/);
assert.match(N.PARALLEL,/if\(row<cfg\.rows\)/);
assert.ok(!N.PARALLEL.includes('if(row>=cfg.rows){return;}'),'avoid early return before workgroup barrier');
assert.match(N.SERIAL,/pack\[off \/ 4u\]/);
assert.match(N.PARALLEL,/unpack2x16float/);
assert.equal(N.median([4,2,10,3]),3.5);
for(const rows of [64,128,256]){
 for(const cols of [128,512,1024]){
  for(const format of [142,143]){
   N.validateShape(rows,cols,format);
   const fixture=PB.packFixture(rows,cols,format,12345);
   const x=PB.randomActivation(cols,9876);
   const out=N.cpu(fixture.reference,rows,cols,x);
   const ref=PB.referenceMatvec(fixture.reference,rows,cols,x);
   assert.ok(N.maxError(out,ref)<.0005,'CPU reference numerical divergence');
   assert.equal(fixture.bytes.length,(format===143?28:34)*rows*(cols/128));
  }
 }
}
assert.throws(()=>N.validateShape(34,190,143));
assert.throws(()=>N.maxError(Float32Array.of(NaN),Float32Array.of(1)));
const page=fs.readFileSync(new URL('index.html',root),'utf8');
for(const id of ['nativeRun','nativeRows','nativeCols','nativeFormat','nativeSerial','nativeParallel','nativeError','nativeGpu','nativeStatus','nativeMeta']){
 assert.ok(page.includes('id="'+id+'"'),id+' missing in page');
}
console.log('PASS native WGSL benchmark structure, 18 numerical fixture configurations and runtime UI bindings (browser GPU test pending)');
