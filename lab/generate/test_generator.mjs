/** Correctness tests of the local toy Transformer (no neural inference dependencies).
 * Run from repo root: node lab/generate/test_generator.mjs
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const base=new URL('.',import.meta.url);
const read=name=>readFileSync(new URL(name,base),'utf8');
const engine=read('engine.js'),app=read('app.js'),wgsl=read('core.wgsl');
const model=JSON.parse(read('model.json'));
const ctx=vm.createContext({atob,Uint8Array,Uint32Array,Float32Array,Map});
vm.runInContext(engine+'\n globalThis.generatorTest={unpackToyModel,cpuToyLogits};',ctx,{filename:'engine.js'});
const {unpackToyModel,cpuToyLogits}=ctx.generatorTest;
const packed=unpackToyModel(model);
assert.equal(packed.bytes.length,6298);
assert.equal(packed.scales.length,11);
assert.equal(model.vocab.length,202);
assert.equal(model.context,48);
assert.equal(new Set(model.vocab).size,202);
assert.match(wgsl,/@compute @workgroup_size\(1\)/);
assert.match(wgsl,/for\(var pos:u32=0u;pos<T/);
assert.match(wgsl,/inverseSqrt/);
assert.match(app,/engine\.verify\(\)/);
const ids=new Map(model.vocab.map((char,index)=>[char,index]));
function encode(x){return Array.from(x,c=>ids.get(c)??0);}
function greedy(question,max=90){
 const all=encode('Q: '+question+'\nA: ');
 let answer='';
 for(let step=0;step<max;step++){
  const logits=cpuToyLogits(packed,all);
  assert.equal(logits.length,202);
  for(const n of logits)assert.ok(Number.isFinite(n),'Nonfinite model output');
  let choice=0;for(let id=1;id<202;id++)if(logits[id]>logits[choice])choice=id;
  const character=model.vocab[choice];
  if(character==='\n')break;
  answer+=character;all.push(choice);
 }
 return answer;
}
const expected=[
 ['안녕','안녕하세요. 저는 에테리온 실험 모델입니다.'],
 ['너 누구야','저는 브라우저에서 실행하는 작은 생성형 모델입니다.'],
 ['WebGPU가 뭐야','WebGPU는 브라우저에서 그래픽 장치를 사용하는 기술입니다.'],
 ['Noema와 같아','아니요. 저는 별도의 소형 모델입니다.']
];
for(const [prompt,answer] of expected){
 const actual=greedy(prompt);
 assert.equal(actual,answer,'Q8 model regression: '+prompt);
 console.log('PASS',prompt,'->',actual);
}
console.log('PASS native Transformer model invariants and four autoregressive text samples');
