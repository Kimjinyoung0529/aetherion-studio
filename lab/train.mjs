/**
 * AETHERION Native Lab — training, from scratch.
 * Run locally: node lab/train.mjs  (from repository root)
 * Trains a tiny supervised intent model, not a generative LLM.
 * No PyTorch / TensorFlow / external model API. Deterministic SGD.
 */
import { writeFileSync } from 'node:fs';
const examples={
greeting:["안녕","안녕하세요","ㅎㅇ","반가워","처음 왔어","좋은 아침","안녕 반갑습니다","하이","hello","hi there","야 안녕","좋은 저녁"],
identity:["너 누구야","너는 누구니","이 서비스 뭐야","이 AI는 뭐야","AETHERION 소개해줘","넌 어떤 모델이야","어떤 인공지능이니","자기 소개해줘","너는 어떤 회사 제품이야","정체가 뭐야","what are you","who are you"],
gpu:["WebGPU란 뭐야","GPU 연산 어떻게 해","웹 gpu 작동 원리","WGSL 셰이더가 뭐야","그래픽 카드로 실행하고 싶어","GPU 컴퓨팅 보여줘","브라우저 GPU 테스트","네이티브 WebGPU","Wllama 없이 GPU 써","is WebGPU available","gpu backend","gpu compute"],
perf:["너무 느려","속도 개선해줘","렉 걸려","최적화 해줘","메모리 부족","로딩이 오래 걸려","저사양 기기에 맞춰줘","빠르게 만들어줘","아이폰 렉 심해","초당 토큰 속도","성능 테스트","지연 시간이 길어","performance optimize"],
noema:["Noema 1.5 2B","Noema 4B Fast","Noema 4B Deep","Noema 사용해","노에마 모델","Noema 로딩 안돼","GGUF 모델 실행","2B 모델 추론","4B 분할 GGUF","Noema는 뭐야","noema ai","noema inference"],
agent:["자율 에이전트","에이전트 챗","목표를 나눠서 실행","작업 계획 세워","에이전트 업무","자동으로 계획하고 실행","다단계 작업","에이전트 기능","agent workflow","agent task"],
coding:["코딩 도와줘","자바스크립트 작성","코드 예시 보여줘","HTML 페이지 만들기","파이썬 함수 작성","버그 수정해줘","CSS 코드 작성","프로그래밍 알려줘","코드 리팩터링","TypeScript 튜토리얼","build website","javascript code"],
privacy:["개인정보 안전해","내 데이터 어디 저장돼","보안 괜찮아","대화 내용 외부 전송","프라이버시 설명","HTTPS 암호화","비밀번호 보호","로그 저장하니","서버로 보내니","private data","security privacy"],
roadmap:["다음 단계 뭐야","앞으로 개발 계획","개발 로드맵","향후 기능","고도화 계획 알려줘","큰 언어 모델 만들기","언제 LLM 돼","추론 엔진 발전","어텐션 구현 계획","멀티헤드 attention","next milestone","roadmap"],
math:["1+1 얼마야","2 더하기 3","곱셈 계산해","계산기 있어","수학 문제 풀어줘","10 나누기 2","숫자 계산","덧셈 해줘","calculate 2 + 2","arithmetic help","수식 결과"],
thanks:["고마워","감사해","감사합니다","땡큐","좋다 고마워","도움 됐어","thanks","thank you","수고했어","친절하네"],
help:["뭘 할 수 있어","사용법 알려줘","기능 안내","어떻게 사용해","뭐 해볼까","예제 보여줘","도와줘","도움말","시작해 보자","사용 가이드","how to use","help me"],
chat:["AI 채팅 열어","챗봇 접속","대화 서비스","채팅 화면으로 가","질문하고 싶어","Noema 채팅 어디야","인공지능 채팅","chat mode","open chat","talk to AI"],
company:["공식 홈페이지","기업 소개","회사 비전","제품 소개","우리 기업","브랜드 소개","AETHERION 회사","about company","company website","our products"],
bye:["잘 가","안녕히 가세요","나중에 봐","다음에 만나","종료할게","바이바이","잘있어","bye","goodbye","see you later"]
};
const labels=Object.keys(examples);
const dimension=512,count=labels.length;
function hash(text){let h=2166136261;for(const c of text){h^=c.codePointAt(0);h=Math.imul(h,16777619)}return(h>>>0)%dimension}
function vector(text){
 const textClean=String(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim().slice(0,220), out=new Map();
 const add=(j,v)=>out.set(j,(out.get(j)||0)+v);
 for(const word of textClean.split(' ').filter(Boolean)){
  add(hash('w:'+word),1.3);
  for(let i=0;i<word.length-1;i++){
   add(hash('b:'+word.slice(i,i+2)),.8);
   if(i<word.length-2)add(hash('t:'+word.slice(i,i+3)),.55);
  }
 }
 const norm=Math.sqrt([...out.values()].reduce((a,v)=>a+v*v,0))||1;
 return [...out].map(([j,v])=>[j,v/norm]);
}
const data=[];
for(let cls=0;cls<count;cls++){
 for(let i=0;i<examples[labels[cls]].length;i++){
  const text=examples[labels[cls]][i],variants=[text];
  if(i%3===0)variants.push(text+' 알려줘');
  if(i%4===0)variants.push('궁금해 '+text);
  if(i%5===0)variants.push('이거 '+text+' 좀');
  for(const v of variants)data.push({cls,x:vector(v)});
 }
}
const weights=new Float32Array(count*dimension),bias=new Float32Array(count);
let seed=924137;
function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
const order=data.map((_,i)=>i),epochCount=125,lr=.23;
for(let epoch=0;epoch<epochCount;epoch++){
 for(let i=order.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
 for(const itemIndex of order){
  const {cls,x}=data[itemIndex],logits=labels.map((_,k)=>{
   let z=bias[k];for(const [j,v] of x)z+=weights[k*dimension+j]*v;return z;
  });
  const hi=Math.max(...logits),exp=logits.map(x=>Math.exp(x-hi)),sum=exp.reduce((a,b)=>a+b,0);
  for(let k=0;k<count;k++){
   const g=(exp[k]/sum-(k===cls?1:0))*lr;
   bias[k]-=g;for(const [j,v] of x)weights[k*dimension+j]-=g*v;
  }
 }
}
const model={
 version:'native-0.1',type:'supervised-linear-intent',
 backend:'WebGPU WGSL dense matvec (no framework)',
 dimensions:dimension,labels,
 weights:Array.from(weights,x=>+x.toFixed(6)),
 bias:Array.from(bias,x=>+x.toFixed(6)),
 training_samples:data.length,training_epochs:epochCount,
 disclaimer:'Small learned intent classifier; outputs are routed to authored response templates. Not a generative LLM and not Noema.'
};
writeFileSync('lab/model.json',JSON.stringify(model));
console.log('Wrote lab/model.json',model.weights.length,'weights,',data.length,'training samples.');
