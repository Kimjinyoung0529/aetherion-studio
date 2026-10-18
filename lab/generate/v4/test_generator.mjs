/** AETHERION Native Generator 0.4 — deterministic Q8 regression checks.
 * Node 22: node lab/generate/v4/test_generator.mjs
 * This checks quantized CPU reference and layer-layout invariants, not Safari GPU.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const folder=new URL('.',import.meta.url);
const read=(path)=>readFileSync(new URL(path,folder),'utf8');
const model=JSON.parse(read('model.json'));
const engine=read('engine.js'),shader=read('core.wgsl'),app=read('app.js'),html=read('index.html');
const sandbox=vm.createContext({atob,Uint8Array,Uint32Array,Float32Array,Map,Math,Number,Array});
vm.runInContext(engine+'\nglobalThis.EXPORTED={unpackToyModel,cpuToyLogits};',sandbox,{filename:'engine.js'});
const {unpackToyModel,cpuToyLogits}=sandbox.EXPORTED;
const packed=unpackToyModel(model);
assert.equal(model.version,'native-generator-0.4');
assert.equal(model.pair_count,94);
assert.equal(model.augmented_samples,376);
assert.equal(model.d_model,32);assert.equal(model.ffn,64);
assert.equal(model.context,96);assert.equal(model.vocab.length,376);
assert.equal(new Set(model.vocab).size,model.vocab.length);
assert.equal(packed.bytes.length,23768);
assert.equal(model.offsets.outb[0],23392);
assert.equal(model.offsets.outb[0]+model.offsets.outb[1],packed.bytes.length);
const expectedSections=['E','P','wq','wk','wv','wo','fc1','fc1b','fc2','fc2b','outb'];
let end=0;
for(const section of expectedSections){
 const [start,length]=model.offsets[section];
 assert.equal(start,end,'quantized weight section is contiguous: '+section);
 assert.ok(length>0);end=start+length;
 assert.ok(Number.isFinite(model.scales[section])&&model.scales[section]>0);
}
assert.match(shader,/@compute @workgroup_size\(1\)/);
assert.match(shader,/array<f32,32>/);
assert.match(shader,/array<f32,64>/);
assert.match(shader,/let T=min\(options\.count,96u\)/);
assert.match(shader,/q8\(21248u\+row,7u\)/);
assert.match(shader,/q8\(23392u\+tok,10u\)/);
assert.match(shader,/tok\*32u\+col,0u/);
assert.match(shader,/row\*64u\+col,8u/);
assert.match(app,/engine\.verify\(\)/);
assert.match(html,/generate\/v4\//);
const charIndex=new Map(model.vocab.map((char,index)=>[char,index]));
function greedy(question,max=88){
 const ids=Array.from('Q: '+question+'\nA: ',ch=>charIndex.get(ch)??0);
 let text='';
 for(let step=0;step<max;step++){
  const values=cpuToyLogits(packed,ids);
  assert.equal(values.length,376);
  let next=0;
  for(let i=0;i<values.length;i++){
   assert.ok(Number.isFinite(values[i]),'logits must be finite');
   if(values[i]>values[next])next=i;
  }
  const ch=model.vocab[next];
  if(ch==='\n')break;
  text+=ch;ids.push(next);
 }
 return text;
}
const expected=[
 ['안녕','안녕하세요! 무엇을 만들고 싶으세요?'],
 ['너 누구야','저는 에테리온이 만든 브라우저용 소형 생성 모델입니다.'],
 ['WebGPU가 뭐야','WebGPU는 브라우저에서 GPU 계산을 사용할 수 있는 기술입니다.'],
 ['삼진 AI가 뭐야','삼진 가중치는 숫자 영과 양수 일, 음수 일을 사용합니다.'],
 ['깃허브가 뭐야','깃허브는 코드를 저장하고 변경을 관리하는 서비스입니다.'],
 ['GPU가 느려','GPU 준비와 메모리 이동 시간이 짧은 계산보다 클 수 있어요.'],
 ['고마워','도움이 되었다니 기뻐요.'],
 ['인터넷 접속해','이 작은 모델은 스스로 인터넷을 검색하지 못합니다.'],
 ['새 기능 추천','GPU 정확도 측정과 오류 기록을 더하면 개발에 도움이 됩니다.'],
];
for(const [question,answer] of expected){
 const generated=greedy(question);
 assert.equal(generated,answer,'0.4 model regression: '+question);
 console.log('PASS',question,'=>',generated);
}
console.log('PASS 0.4: 9 authored-sample text completions; dimensions, offsets, shader kernel invariants.');
console.log('Limitation: unseen questions are NOT proven correct; browser WebGPU parity remains on-device.');
