/* AETHERION FFN numerical reference and fixture regression test.
 * The independent GPU parity check runs in Safari/Chrome, not GitHub CPU CI.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('ffn.js',import.meta.url),'utf8');
const context=vm.createContext({Float32Array,Math,Number,Uint32Array});
vm.runInContext(source+'\nglobalThis.FFN=BonsaiFFN;',context,{filename:'ffn.js'});
const {fixture,reference,error,WGSL}=context.FFN;
assert.match(WGSL,/inverseSqrt\(squareSum/);
assert.match(WGSL,/exp\(-gate\)/);
assert.match(WGSL,/settings\.f/);
for(const D of [32,64]){
 for(const rows of [1,2,4,8]){
  const original=fixture(D,rows),another=fixture(D,rows);
  assert.equal(error(original.input,another.input),0,'deterministic test inputs');
  const result=reference(original);
  assert.equal(result.length,D*rows);
  for(const x of result)assert.ok(Number.isFinite(x));
  const zero={...original,gate:new Float32Array(original.gate.length),up:new Float32Array(original.up.length)};
  const residual=reference(zero);
  assert.ok(error(residual,original.input)<1e-6,'zero FFN must preserve residual');
 }
}
let rejected=false;
try{fixture(48,3)}catch{rejected=true}
assert.ok(rejected,'unsupported dimensions must fail');
console.log('PASS: 8 FFN reference cases, zero-feedforward residual identity, shape guards and WGSL source invariants');
