/* AETHERION Signed Hadamard algebraic correctness suite.
 * Run: node lab/bonsai/test_signed_fold.mjs
 * Browser WebGPU compilation/dispatch must be verified on the actual device.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('signed_fold.js',import.meta.url),'utf8');
const ctx=vm.createContext({Float32Array,Int8Array,Math,Number,Error,Uint32Array});
vm.runInContext(js+'\n globalThis.signed=AetherionSignedFold;',ctx,{filename:'signed_fold.js'});
const {transform,maxError,sample,wgsl}=ctx.signed;
assert.match(wgsl,/@compute @workgroup_size\(1\)/);
assert.match(wgsl,/activation\[start\+i\]\*signs\[start\+i\]/);
let tests=0;
for(const block of [64,128,256,512,1024]){
 for(const count of [1,2,4,8]){
  const width=block*count;
  const input=sample(width);
  const signs=Float32Array.from({length:width},(_,i)=>((i*17+9)%7)<3?-1:1);
  const rotated=transform(input,signs,block);
  const roundtrip=transform(rotated,signs,block,true);
  const err=maxError(input,roundtrip);
  assert.ok(err<0.0008,'inverse error '+width+': '+err);
  // Orthogonal H times a sign diagonal preserves L2 norm.
  let n1=0,n2=0;for(let i=0;i<width;i++){n1+=input[i]**2;n2+=rotated[i]**2;}
  assert.ok(Math.abs(n1-n2)/Math.max(n1,1)<0.00001,'orthogonality at '+width);
  const allPlus=new Float32Array(width).fill(1);
  const identity=transform(input,allPlus,block);
  const signsFirst=Float32Array.from(input,(x,i)=>x*signs[i]);
  const transformed=transform(signsFirst,allPlus,block);
  assert.ok(maxError(rotated,transformed)<0.0008,'sign order '+width);
  if(block===64&&count===1){
   // Explicit Sylvester-Hadamard matrix reference (independent algorithm).
   const reference=new Float32Array(64);
   function parity(n){let bits=0;while(n){bits^=n&1;n>>>=1;}return bits;}
   for(let r=0;r<64;r++){
    let sum=0;for(let col=0;col<64;col++){
     const basis=parity(r&col)?-1:1;
     sum+=basis*input[col]*signs[col];
    }reference[r]=sum/8;
   }
   assert.ok(maxError(reference,rotated)<0.00003,'explicit Walsh basis mismatch');
  }
  tests++;
 }
}
let bad=false;
try{transform(new Float32Array(64),new Float32Array(64).fill(0),64);}catch{bad=true;}
assert.equal(bad,true,'zeros are not valid sign values');
console.log('PASS Prism signed Hadamard CPU transform/inverse, norm and sign order:',tests);
