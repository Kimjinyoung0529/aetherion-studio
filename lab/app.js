// AETHERION Native Engine 0.1
// Direct WebGPU WGSL inference on a small supervised Korean intent model.
// No Wllama, WebLLM, Transformers.js, ONNX Runtime, or remote inference API.
'use strict';
const $ = id => document.getElementById(id);
const HISTORY_KEY='aetherion-native-log-v1';
// This is a trained intent classifier with templated responses, not a language-generation model.
let model=null,device=null,adapter=null,pipeline=null,bindGroup=null;
let inputBuffer=null,logitsBuffer=null,readback=null,loading=false,busy=false,history=[];
const time=()=>performance.now();
const shaderCode=[
 '@group(0) @binding(0) var<storage,read> x: array<f32>;',
 '@group(0) @binding(1) var<storage,read> w: array<f32>;',
 '@group(0) @binding(2) var<storage,read> b: array<f32>;',
 '@group(0) @binding(3) var<storage,read_write> y: array<f32>;',
 '@compute @workgroup_size(32)',
 'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
 ' let row=gid.x;',
 ' if(row>=15u){return;}',
 ' var acc=b[row];',
 ' for(var j:u32=0u;j<512u;j=j+1u){acc=acc+w[row*512u+j]*x[j];}',
 ' y[row]=acc;',
 '}'
].join('\n');
function emit(message){
 const log=$('engineLog');const item=document.createElement('p');
 item.textContent=new Date().toLocaleTimeString()+'  '+message;
 log.prepend(item);while(log.childElementCount>16)log.lastElementChild.remove();
}
function status(value,kind='normal'){
 $('connectionStatus').textContent=value;$('connectionStatus').dataset.kind=kind;
}
function hash(word,dimension){
 let h=2166136261;
 for(const ch of word){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}
 return (h>>>0)%dimension;
}
function featureVector(question){
 const size=model.dimensions;
 const input=String(question).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim().slice(0,220);
 const v=new Float32Array(size);
 for(const word of input.split(' ').filter(Boolean)){
  v[hash('w:'+word,size)]+=1.3;
  for(let i=0;i<word.length-1;i++){
   v[hash('b:'+word.slice(i,i+2),size)]+=.8;
   if(i<word.length-2)v[hash('t:'+word.slice(i,i+3),size)]+=.55;
  }
 }
 let norm=0;for(let i=0;i<v.length;i++)norm+=v[i]*v[i];
 norm=Math.sqrt(norm)||1;
 for(let i=0;i<v.length;i++)v[i]/=norm;
 return v;
}
async function initialize(){
 if(loading||device)return;
 loading=true;$('initButton').disabled=true;status('GPU 연결 확인 중…');
 try{
  if(!isSecureContext)throw new Error('HTTPS 연결이 필요합니다.');
  if(!navigator.gpu)throw new Error('이 브라우저는 WebGPU를 제공하지 않습니다.');
  const r=await fetch('./model.json?v=2',{cache:'no-cache'});
  if(!r.ok)throw new Error('모델 가중치 다운로드 실패 (HTTP '+r.status+')');
  model=await r.json();
  if(model.dimensions!==512||model.labels.length!==15||model.weights.length!==7680||model.bias.length!==15)throw new Error('모델 데이터의 크기가 올바르지 않습니다.');
  adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
  if(!adapter)throw new Error('WebGPU 어댑터를 찾을 수 없습니다.');
  device=await adapter.requestDevice();
  device.lost.then(info=>{
   status('GPU 연결이 끊어짐','error');emit('장치 손실: '+(info.message||info.reason));
   $('sendButton').disabled=true;
   $('initButton').disabled=false;device=null;pipeline=null;bindGroup=null;
  });
  const gpuUsage=GPUBufferUsage,weights=new Float32Array(model.weights),bias=new Float32Array(model.bias);
  const wBuf=device.createBuffer({size:weights.byteLength,usage:gpuUsage.STORAGE|gpuUsage.COPY_DST});
  const bBuf=device.createBuffer({size:bias.byteLength,usage:gpuUsage.STORAGE|gpuUsage.COPY_DST});
  device.queue.writeBuffer(wBuf,0,weights);
  device.queue.writeBuffer(bBuf,0,bias);
  inputBuffer=device.createBuffer({size:512*4,usage:gpuUsage.STORAGE|gpuUsage.COPY_DST});
  logitsBuffer=device.createBuffer({size:15*4,usage:gpuUsage.STORAGE|gpuUsage.COPY_SRC});
  readback=device.createBuffer({size:15*4,usage:gpuUsage.MAP_READ|gpuUsage.COPY_DST});
  const shader=device.createShaderModule({code:shaderCode});
  const info=await shader.getCompilationInfo();
  const err=info.messages.filter(m=>m.type==='error');
  if(err.length)throw new Error('WGSL 컴파일: '+err.map(m=>m.message).join('; '));
  pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});
  bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:inputBuffer}},
   {binding:1,resource:{buffer:wBuf}},
   {binding:2,resource:{buffer:bBuf}},
   {binding:3,resource:{buffer:logitsBuffer}}
  ]});
  $('sendButton').disabled=false;
  const name=[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'WebGPU Adapter';
  $('deviceValue').textContent=name;
  $('modelValue').textContent=(model.weights.length+model.bias.length).toLocaleString()+' parameters';
  status('Native GPU online','ready');
  emit('네이티브 WGSL 셰이더 컴파일 완료 · '+name);
  emit('학습된 가중치 '+model.weights.length+'개와 편향 '+model.bias.length+'개 GPU 전송 완료');
  emit('추론 연산: 512차원 벡터 × 15개 클래스 · CPU 추론 대체 없음');
 }catch(e){
  status('WebGPU 초기화 실패','error');
  $('deviceValue').textContent='연결 실패';
  emit('오류: '+(e.message||e));
  $('sendButton').disabled=true;
  if(device){try{device.destroy()}catch{}device=null}
 }finally{
  loading=false;$('initButton').disabled=false;
 }
}
async function inferNative(text){
 if(!device||!model||!pipeline)throw new Error('먼저 WebGPU 엔진을 초기화하세요.');
 const a=time();
 const input=featureVector(text);
 device.queue.writeBuffer(inputBuffer,0,input);
 const enc=device.createCommandEncoder();
 const pass=enc.beginComputePass();
 pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(1);pass.end();
 enc.copyBufferToBuffer(logitsBuffer,0,readback,0,15*4);
 device.queue.submit([enc.finish()]);
 await readback.mapAsync(GPUMapMode.READ);
 const scores=Array.from(new Float32Array(readback.getMappedRange()).slice());
 readback.unmap();
 const peak=Math.max(...scores);
 const probabilities=scores.map(v=>Math.exp(v-peak));
 const norm=probabilities.reduce((a,b)=>a+b,0)||1;
 const distribution=probabilities.map((v,i)=>({label:model.labels[i],p:v/norm})).sort((x,y)=>y.p-x.p);
 return {top:distribution[0],distribution:distribution.slice(0,3),elapsed:time()-a};
}
const descriptions={
 greeting:'안녕하세요. AETHERION Native Lab에 오신 걸 환영해요. 이 화면의 결과는 WebGPU에서 직접 계산한 신경망 분류 결과예요.',
 identity:'저는 AETHERION이 직접 구현하는 브라우저용 GPU 추론 실험실입니다. 현재는 작은 의도 분류 신경망과 정해진 응답을 사용하며, Noema 같은 생성형 LLM은 아직 아닙니다.',
 gpu:'여기서는 WebGPU의 WGSL Compute Shader가 실제로 학습된 가중치와 입력 벡터를 곱합니다. 다른 AI 실행 라이브러리는 사용하지 않습니다. 오른쪽 추론 기록에서 결과와 시간을 확인할 수 있어요.',
 perf:'빠른 실행을 위해 GPU 장치와 파이프라인을 한 번만 초기화하고 재사용합니다. 입력당 약 7,680회의 곱셈·누산을 수행하며, 모델 가중치는 수십 KB 수준이에요. 대형 LLM의 속도를 대표하지는 않습니다.',
 noema:'Noema 1.5의 GGUF를 이 자체 엔진에서 실행하려면 GGUF 로더, Q4 양자화 해제, RoPE, 다층 어텐션, KV 캐시, 토크나이저 구현이 더 필요합니다. 기존 Noema Chat은 별도 서비스에서 사용할 수 있어요.',
 agent:'현재 AETHERION Agent는 별도 서비스로 제공돼요. 이 실험실의 모델은 작업을 자동 수행하는 에이전트가 아니라 GPU 기반 의도 분류기입니다.',
 coding:'직접 WebGPU 구현에서는 입력 인코딩 → GPU 버퍼 → WGSL 셰이더 → 추론 결과 디코딩 순서가 핵심입니다. 이 실험실 코드는 GitHub 저장소의 lab/app.js에서 확인할 수 있어요.',
 privacy:'이 실험실에서 입력 문장을 처리하는 추론 연산은 방문자의 브라우저 GPU에서 수행됩니다. 학습 가중치는 정적 파일로 내려받고, 대화 기록은 브라우저에만 저장됩니다. 호스팅 제공자의 일반 접속 로그는 별개예요.',
 roadmap:'다음 목표는 전용 토크나이저, 양자화 행렬 연산, RMSNorm, RoPE, KV 캐시, 인과적 자기 어텐션을 단계적으로 구현하는 것입니다. 그다음 작은 생성형 언어 모델부터 검증할 수 있습니다.',
 thanks:'고마워요. 직접 WebGPU 엔진은 아직 실험 단계지만, 실제 GPU 추론부터 하나씩 확인하고 있어요.',
 help:'WebGPU 연산 실험, 속도 측정, Noema와의 차이, 개발 로드맵, 보안 등을 질문해 보세요. 이 모델은 입력 의도를 분류한 뒤 미리 작성된 설명을 선택합니다.',
 chat:'일반 AI 채팅은 /chat/에서 열 수 있어요. Native Lab은 우리가 직접 만든 GPU 엔진의 실제 동작을 검증하는 별도 공간입니다.',
 company:'AETHERION은 우리가 만든 가상 AI 기술 브랜드입니다. 공식 콘셉트 홈페이지는 메인 주소에 있고, Native Lab은 기술 연구 공간이에요.',
 bye:'다음에 또 만나요. GPU 모델은 페이지를 닫으면 실행을 멈춥니다.'
};
function arithmetic(text){
 const normalized=text.replace(/,/g,'').replace(/[×xX]/g,'*').replace(/÷/g,'/').replace(/더하기/g,'+').replace(/빼기/g,'-').replace(/곱하기/g,'*').replace(/나누기/g,'/');
 const match=normalized.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
 if(!match)return '간단한 산술식(예: 12 * 7)을 입력해 보세요. 계산 자체는 GPU 신경망이 아니라 검증 가능한 산술 규칙으로 처리합니다.';
 const a=Number(match[1]),b=Number(match[3]);let result;
 if(match[2]==='+')result=a+b;
 if(match[2]==='-')result=a-b;
 if(match[2]==='*')result=a*b;
 if(match[2]==='/'){if(b===0)return '0으로 나눌 수는 없어요.';result=a/b}
 return match[1]+' '+match[2]+' '+match[3]+' = '+Number(result.toPrecision(12));
}
function formatReply(label,text,confidence){
 if(label==='math')return arithmetic(text);
 if(confidence<.52)return '이 소형 신경망은 아직 이 질문을 확실히 분류하지 못했습니다. WebGPU, Noema, 에이전트, 회사 소개, 보안, 성능과 같은 범위의 질문을 해 보세요. 자유 생성형 AI는 아직 구현 중입니다.';
 return descriptions[label]||'이 범위는 아직 학습되지 않았습니다.';
}
function addMessage(role,text){
 $('messages').querySelector('.empty')?.remove();
 const msg=document.createElement('div');msg.className='message '+role;
 const name=document.createElement('span');name.className='messageLabel';name.textContent=role==='user'?'YOU':'NATIVE CORE';
 const content=document.createElement('p');content.textContent=text;
 msg.append(name,content);$('messages').append(msg);
 $('messages').scrollTop=$('messages').scrollHeight;
}
async function send(text){
 if(busy||!device)return;
 const question=String(text||'').trim().slice(0,500);if(!question)return;
 busy=true;$('sendButton').disabled=true;
 addMessage('user',question);$('promptInput').value='';
 try{
  const result=await inferNative(question);
  const answer=formatReply(result.top.label,question,result.top.p);
  addMessage('assistant',answer);
  $('intentValue').textContent=result.top.label.toUpperCase();
  $('confidenceValue').textContent=(result.top.p*100).toFixed(1)+'%';
  $('latencyValue').textContent=result.elapsed.toFixed(2)+' ms';
  $('topScores').textContent=result.distribution.map(x=>x.label+' '+(x.p*100).toFixed(1)+'%').join(' · ');
  emit('GPU 추론 '+result.elapsed.toFixed(2)+' ms · '+result.top.label+' '+(result.top.p*100).toFixed(1)+'%');
  history.push({q:question,a:answer});
  if(history.length>25)history=history.slice(-25);
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history))}catch{}
 }catch(e){emit('추론 실패: '+e.message);status('GPU 추론 오류','error');addMessage('assistant','GPU 추론이 실패했습니다. 엔진 로그를 확인해 주세요.');}
 finally{busy=false;$('sendButton').disabled=!device;}
}
$('initButton').addEventListener('click',initialize);
$('askForm').addEventListener('submit',event=>{event.preventDefault();send($('promptInput').value)});
$('clearButton').addEventListener('click',()=>{$('messages').textContent='';history=[];try{localStorage.removeItem(HISTORY_KEY)}catch{};emit('대화 기록 초기화 완료')});
document.querySelectorAll('[data-example]').forEach(btn=>btn.addEventListener('click',()=>{const q=btn.dataset.example;$('promptInput').value=q;send(q)}));
$('sourceButton').addEventListener('click',()=>window.open('https://github.com/Kimjinyoung0529/aetherion-studio/tree/main/lab','_blank','noopener'));
try{const saved=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(saved))saved.slice(-8).forEach(x=>{if(x?.q&&x?.a){addMessage('user',x.q);addMessage('assistant',x.a)}})}catch{}
initialize();
