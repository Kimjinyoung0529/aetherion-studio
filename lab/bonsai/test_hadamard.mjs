/* CPU algebraic tests for the AETHERION native WebGPU FWHT benchmark.
 * GPU testing requires browser WebGPU and is performed on the live site.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('hadamard.js',import.meta.url),'utf8');
const fakeNode={addEventListener(){},textContent:''};
const context=vm.createContext({
 window:{},document:{getElementById(){return fakeNode}},
 Float32Array,Math,Number,Error
});
vm.runInContext(source,context,{filename:'hadamard.js'});
const {fwht,maxError}=context.window.AetherionFWHTReference;
let checks=0;
for(const width of [64,128,256,512]){
 for(const rows of [1,3,8,16]){
  const x=Float32Array.from({length:width*rows},(_,i)=>Math.sin(i*0.71)+Math.cos(i*1.91));
  const transformed=fwht(x,width,rows);
  const restored=fwht(transformed,width,rows);
  assert.ok(maxError(x,restored)<.001,'FWHT inverse mismatch: '+width+' x '+rows);
  checks++;
 }
 const constant=new Float32Array(width).fill(1);
 const out=fwht(constant,width,1);
 assert.ok(Math.abs(out[0]-Math.sqrt(width))<.001);
 for(let i=1;i<width;i++)assert.ok(Math.abs(out[i])<.001);
 checks++;
}
console.log('PASS CPU FWHT transform/inverse + constant-vector tests:',checks);
