// AETHERION Native Generator UI v0.4 — all neural computation is local WebGPU.
'use strict';
const $=id=>document.getElementById(id);
let engine=null,loading=false,generating=false,stopRequested=false,ready=false;
const startExamples=['안녕','너 누구야','WebGPU가 뭐야','삼진 AI가 뭐야','깃허브가 뭐야'];
function note(message){
 const p=document.createElement('p');p.textContent=new Date().toLocaleTimeString()+'  '+message;
 $('runtimeLog').prepend(p);
 while($('runtimeLog').childElementCount>18)$('runtimeLog').lastElementChild.remove();
}
function status(message,kind=''){
 $('status').textContent=message;$('status').dataset.kind=kind;
}
function metric(id,value){$(id).textContent=value;}
function formatMs(x){return x>=1000?(x/1000).toFixed(2)+' s':x.toFixed(2)+' ms';}
function refreshButtons(){
 $('start').disabled=loading||generating||ready;
 $('send').disabled=!ready||generating;
 $('stop').disabled=!generating;
 $('prompt').disabled=generating;
 $('maxTokens').disabled=generating;
 $('temperature').disabled=generating;
}
function appendMessage(role,text){
 const row=document.createElement('div');row.className='bubble '+role;
 const name=document.createElement('div');name.className='speaker';
 name.textContent=role==='user'?'YOU':'NATIVE GENERATOR';
 const content=document.createElement('div');content.className='bubbleText';content.textContent=text;
 row.append(name,content);$('messages').querySelector('.welcome')?.remove();$('messages').append(row);
 $('messages').scrollTop=$('messages').scrollHeight;
 return content;
}
async function initialize(){
 if(loading||ready||generating)return;
 loading=true;refreshButtons();status('소형 가중치 다운로드 중…');
 const start=performance.now();
 try{
  if(!isSecureContext||!navigator.gpu)throw Error('HTTPS 또는 WebGPU가 없습니다.');
  const [modelRes,shaderRes]=await Promise.all([
   fetch('./model.json',{cache:'no-cache'}),fetch('./core.wgsl?v=4',{cache:'no-cache'})
  ]);
  if(!modelRes.ok||!shaderRes.ok)throw Error('모델 또는 WGSL 코드를 가져올 수 없습니다');
  const model=await modelRes.json(),wgsl=await shaderRes.text();
  engine=new AetherionNativeGenerator();
  const device=await engine.init(model,wgsl);
  metric('gpu',device);metric('weightSize',(model.quantized_weights_b64.length*3/4/1024).toFixed(2)+' KiB Q8');
  metric('modelName',model.version);
  status('GPU 모델 정확도 검증 중…');
  const comparison=await engine.verify();
  metric('parity',comparison.maxError.toExponential(3));
  metric('latency',formatMs(comparison.avgMs));
  note('GPU ↔ CPU 3개 프롬프트 로그잇 비교 통과 · 최대 오차 '+comparison.maxError.toExponential(3));
  note('WebGPU 엔진 준비됨: '+device+' · '+formatMs(performance.now()-start));
  ready=true;status('직접 WebGPU 텍스트 생성 준비 완료','ready');
 }catch(err){
  console.error(err);status('GPU 실행 또는 검증 실패','error');
  note('초기화 오류: '+(err?.message||err));
  $('errorDetail').textContent=err?.message||String(err);
  $('errorDetail').hidden=false;
  try{engine?.dispose()}catch{}engine=null;
  metric('parity','오류');$('start').textContent='다시 시도 ↻';
 }finally{loading=false;refreshButtons();}
}
async function generate(question){
 if(!ready||generating)return;
 const prompt=String(question||'').trim().slice(0,120);
 if(!prompt)return;
 if(!engine?.pipeline){status('GPU 엔진 연결 필요','error');return;}
 generating=true;stopRequested=false;refreshButtons();
 $('prompt').value='';
 appendMessage('user',prompt);
 const reply=appendMessage('assistant','');
 status('GPU에서 토큰 생성 중…');
 const before=performance.now();let count=0,lastMs=0;
 try{
  const maxTokens=Number($('maxTokens').value);
  const temperature=Number($('temperature').value);
  const unknown=engine.encode('Q: '+prompt+'\nA: ').filter(x=>x===0).length;
  if(unknown>4)note('경고: 학습되지 않은 문자 '+unknown+'개. 소형 어휘의 생성 품질이 낮을 수 있습니다.');
  for await (const chunk of engine.generate(prompt,{maxTokens,temperature})){
   if(stopRequested)break;
   reply.textContent+=chunk.token;count++;lastMs=chunk.ms;
   metric('outputTokens',String(count));
   metric('tokenSpeed',(count/Math.max((performance.now()-before)/1000,.001)).toFixed(1)+' char/s');
   $('messages').scrollTop=$('messages').scrollHeight;
   // Give Safari an opportunity to paint while the GPU is working.
   if(count%5===0)await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(count===0)reply.textContent='(생성 종료: 줄바꿈 또는 종료 조건)';
  if(stopRequested)reply.textContent+=' [중지됨]';
  note('모델의 가중치에서 실제 생성 완료 · '+count+'자 · 마지막 GPU 단계 '+formatMs(lastMs));
  status('생성 완료 · 온디바이스 WebGPU','ready');
 }catch(e){
  reply.textContent+=' [오류: '+(e?.message||e)+']';
  note('토큰 생성 오류: '+(e?.message||e));
  status('WebGPU 생성 실패','error');
 }finally{
  generating=false;stopRequested=false;refreshButtons();
 }
}
$('start').addEventListener('click',initialize);
$('sendForm').addEventListener('submit',e=>{e.preventDefault();generate($('prompt').value);});
$('stop').addEventListener('click',()=>{stopRequested=true;note('다음 GPU 토큰 후 생성 정지를 요청했습니다.')});
$('temperature').addEventListener('input',()=>metric('tempValue',Number($('temperature').value).toFixed(1)));
$('clear').addEventListener('click',()=>{$('messages').textContent='';note('화면 메시지를 지웠습니다.')});
document.querySelectorAll('[data-example]').forEach(x=>x.addEventListener('click',()=>{
 $('prompt').value=x.dataset.example;
 if(ready&&!generating)generate(x.dataset.example);
}));
note('학습된 모델 크기 약 23.8KB Q8 · 376개 문자 토큰 · 모델 생성기는 Prism Bonsai 2B가 아닙니다.');
refreshButtons();
