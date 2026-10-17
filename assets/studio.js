
const $ = id => document.getElementById(id);
const MODELS = {
  fast:{label:'Noema 1.5 4B Fast',repo:'NoemaAI-labs/Noema-1.5-4B-Fast-GGUF',file:'Noema-1.5-4B-Fast-Q4_K_M.gguf',size:'약 2.7 GB',bytes:2.71e9,temp:.6,max_tokens:320},
  deep:{label:'Noema 1.5 4B Deep',repo:'NoemaAI-labs/Noema-1.5-4B-Deep-GGUF',file:'Noema-1.5-4B-Deep-Q4_K_M.gguf',size:'약 2.7 GB',bytes:2.7e9,temp:.6,max_tokens:520},
  light:{label:'Noema 1.5 2B',repo:'NoemaAI-labs/Noema-1.5-2B-GGUF',file:'Noema-1.5-2B-Q4_K_M.gguf',size:'약 1.27 GB',bytes:1.27e9,temp:.2,max_tokens:350}
};
let chosen=(['light','fast','deep'].includes(new URLSearchParams(location.search).get('model'))?new URLSearchParams(location.search).get('model'):'light'),loaded=null,engine=null,engineBusy=false,loading=false,agentBusy=false,history=[],lastAgentOutput='',abortCurrent=false;
const storeKey='aetherion-studio-chats-v2';
try {history=JSON.parse(localStorage.getItem(storeKey)||'[]');if(!Array.isArray(history))history=[];}catch{}
function persist(){try{localStorage.setItem(storeKey,JSON.stringify(history.slice(-50)))}catch{}}
function notice(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.remove('show'),4200)}
function status(kind,msg){$('statepill').className='statepill '+(kind||'');$('statusText').textContent=msg}
function progress(n){$('progress').style.display=n===null?'none':'block';if(n!==null)$('progressFill').style.width=Math.max(0,Math.min(n,100))+'%'}
function busyUi(){const blocked=loading||engineBusy||agentBusy;$('loadBtn').disabled=blocked;$('sendBtn').disabled=blocked;$('agentStart').disabled=blocked;$('messageInput').disabled=blocked;document.querySelectorAll('.modelcard').forEach(b=>b.disabled=blocked)}
function selectedModel(){return MODELS[chosen]}
function refreshModel(){const m=selectedModel();$('activeModelName').textContent=m.label;$('modelSize').textContent='Q4_K_M · 모델 '+m.size;if(loaded===chosen){status('ready','모델 연결됨 · 추론 준비 완료');$('loadBtn').textContent='모델 사용 중 ✓';$('composerHint').textContent='모델이 준비되었습니다. 질문을 보내세요.'}else{status('','실행 전 · 모델 로드 필요');$('loadBtn').textContent='모델 로드 ↗';$('composerHint').textContent='선택 모델을 먼저 로드해야 답변합니다.'}progress(null);document.querySelectorAll('.modelcard').forEach(b=>{let a=b.dataset.model===chosen;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))})}
async function detectGPU(){if(!isSecureContext){$('hardwareText').textContent='HTTPS가 필요합니다. 현재 페이지는 안전한 컨텍스트가 아닙니다.';return}if(!navigator.gpu){$('hardwareText').textContent='WebGPU가 없는 브라우저입니다. CPU/WASM 실행으로 대체될 수 있습니다.';return}try{const ad=await navigator.gpu.requestAdapter();if(!ad){$('hardwareText').textContent='WebGPU 어댑터를 사용할 수 없습니다. CPU 방식으로 시도할 수 있습니다.';return}const info=ad.info||{};$('hardwareText').textContent='WebGPU 감지됨'+(info.vendor?' · '+info.vendor:'')+'. 실제 GPU 오프로딩 여부는 모델 로딩 후 결정됩니다.'}catch{$('hardwareText').textContent='GPU 확인에 실패했습니다. 브라우저 설정을 확인하세요.'}}
async function createRuntime(){let mod;try{mod=await import('https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js')}catch(e){throw new Error('Wllama 실행 엔진을 가져올 수 없습니다. 도메인에서 외부 JavaScript 실행/CDN 연결을 확인하세요. ('+e.message+')')}if(!mod.Wllama)throw new Error('실행 엔진 모듈에서 Wllama를 찾지 못했습니다.');const wasm='https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm';return new mod.Wllama({default:wasm})}
async function unloadEngine(){if(!engine)return;try{if(typeof engine.exit==='function')await engine.exit();else if(typeof engine.unloadModel==='function')await engine.unloadModel()}catch(e){console.warn('unload',e)}engine=null;loaded=null}
async function loadModel(){if(loading||engineBusy||agentBusy)return;if(!isSecureContext){notice('HTTPS로 접속해야 GPU 가속을 이용할 수 있습니다.');return}const m=selectedModel();if(m.bytes>2e9){status('error','4B 원본 GGUF는 브라우저 단일 파일 한도 초과');notice('이 4B 모델은 분할 GGUF가 준비되어야 실행할 수 있습니다. 우선 2B를 사용하세요.');$('composerHint').textContent='4B 단일 파일의 약 2.7GB 용량이 현재 Wllama 한도를 넘습니다. 2B 사용을 권장합니다.';return}
loading=true;busyUi();status('loading','엔진 초기화 중…');$('loadBtn').textContent='모델 준비 중…';progress(0);
// Model architecture/quantization stays untouched. Only memory & UI scheduling change.
let lastProgressAt=0,lastPercent=-1;
const onProgress=p=>{
  const raw=p?.total?100*p.loaded/p.total:(typeof p?.progress==='number'?100*p.progress:null);
  if(raw===null||!Number.isFinite(raw))return;
  const v=Math.max(0,Math.min(100,Math.floor(raw))),now=performance.now();
  if(v<100&&v===lastPercent)return;
  if(v<100&&now-lastProgressAt<220&&v-lastPercent<3)return;
  lastProgressAt=now;lastPercent=v;
  progress(v);status('loading',v>=100?'다운로드 완료 · 모델 메모리 초기화 중…':`모델 다운로드 ${v}%`);
};
try{await unloadEngine();engine=await createRuntime();status('loading','모델 파일 요청 중…');const url=`https://huggingface.co/${m.repo}/resolve/main/${m.file}`;
const mobile=matchMedia('(max-width:650px)').matches;
await engine.loadModelFromUrl(url,{
  n_ctx:mobile?1024:2048,
  n_gpu_layers:navigator.gpu?(mobile?10:-1):0,
  n_threads:1,
  progressCallback:onProgress
});loaded=chosen;status('ready','모델 연결됨 · 추론 준비 완료');progress(100);$('loadBtn').textContent='모델 사용 중 ✓';$('composerHint').textContent='실제 로컬 추론을 사용 중입니다.';notice(`${m.label} 준비 완료`)}catch(e){console.error(e);await unloadEngine();status('error','로드 실패 · 자세한 안내 보기');$('loadBtn').textContent='다시 시도 ↻';progress(null);notice('로드 오류: '+(e?.message||e));$('composerHint').textContent='오류: '+(e?.message||e)+' · 4B는 GGUF 분할이 필요할 수 있습니다.'}finally{loading=false;busyUi()}}
function createMsg(role,content,save=true,target=$('messages'),silent=false){
  if(!silent)$('emptyChat')?.remove();
  const outer=document.createElement('article');outer.className='message '+role;
  const av=document.createElement('div');av.className='avatar';av.textContent=role==='user'?'YOU':'A/';
  const box=document.createElement('div');box.className='msgbox';
  const lab=document.createElement('div');lab.className='msglabel';lab.textContent=role==='user'?'YOU':(loaded?MODELS[loaded].label:'AETHERION');
  const txt=document.createElement('div');txt.className='msgtext';txt.textContent=content;
  box.append(lab,txt);if(role==='user')outer.append(box);else outer.append(av,box);
  target.append(outer);
  if(!silent){const view=$('messages');view.scrollTop=view.scrollHeight;}
  if(save){history.push({role,content});persist();}
  if(!silent)updateMeta();
  return txt;
}
function updateMeta(){$('conversationMeta').textContent='LOCAL SESSION · '+history.length+' MESSAGES'}
function renderSaved(){
  if(!history.length)return;
  // Restore all saved messages in a single DOM update instead of reflowing for each one.
  const view=$('messages'),batch=document.createDocumentFragment();
  $('emptyChat')?.remove();
  for(const m of history){
    if(m?.role==='user'||m?.role==='assistant')createMsg(m.role,String(m.content??''),false,batch,true);
  }
  view.appendChild(batch);
  view.scrollTop=view.scrollHeight;
  updateMeta();
}
function compactReason(text){return String(text||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim()}
async function infer(messages,opts={}){if(!engine||loaded===null)throw Error('먼저 AI 모델을 로드해 주세요.');const model=MODELS[loaded];const r=await engine.createChatCompletion({messages,max_tokens:opts.max_tokens||model.max_tokens,temperature:model.temp,top_p:.95,top_k:20,stream:!!opts.onToken,onData:opts.onToken?d=>{const delta=d?.choices?.[0]?.delta?.content??d?.choices?.[0]?.text??'';if(delta)opts.onToken(String(delta))}:undefined});if(typeof r==='string')return compactReason(r);return compactReason(r?.choices?.[0]?.message?.content??r?.choices?.[0]?.text??'')}
async function send(){
  const input=$('messageInput'),q=input.value.trim();if(!q)return;
  if(loaded!==chosen||!engine){notice('선택한 모델을 먼저 로드해 주세요.');return}
  if(engineBusy||loading||agentBusy)return;
  engineBusy=true;busyUi();input.value='';createMsg('user',q);
  const dest=createMsg('assistant','생성 중…',false),view=$('messages');
  let accumulated='',streamTimer=null,lastRender=0;
  // Avoid forced scroll/layout and repaint on every generated token (especially on iOS).
  const flushStream=()=>{
    streamTimer=null;lastRender=performance.now();
    const follow=view.scrollHeight-view.scrollTop-view.clientHeight<160;
    dest.textContent=compactReason(accumulated)||'답변을 정리하는 중…';
    if(follow)view.scrollTop=view.scrollHeight;
  };
  const onToken=chunk=>{
    accumulated+=chunk;
    if(performance.now()-lastRender>=180&&streamTimer===null)flushStream();
    else if(streamTimer===null)streamTimer=setTimeout(flushStream,180);
  };
  try{
    const system={role:'system',content:'You are a helpful bilingual assistant running locally in the browser. Answer in Korean unless the user specifies otherwise. Provide concise, accurate answers. Never claim to have external tools or live search.'};
    const recent=history.slice(-8).map(({role,content})=>({role,content:String(content).slice(-1000)}));
    const result=await infer([system,...recent],{onToken});
    if(streamTimer!==null){clearTimeout(streamTimer);streamTimer=null;}
    const final=compactReason(result||accumulated)||'모델이 빈 답변을 반환했습니다.';
    dest.textContent=final;history.push({role:'assistant',content:final});persist();updateMeta();
  }catch(e){
    if(streamTimer!==null){clearTimeout(streamTimer);streamTimer=null;}
    dest.textContent='추론 오류: '+(e.message||e);notice('모델 실행 오류. 재로드를 시도해 주세요.');
  }finally{engineBusy=false;busyUi();input.focus();}
}
function log(stage,msg){const box=$('taskLog');if(box.dataset.empty==='1'){box.textContent='';box.dataset.empty='0'}const node=document.createElement('div');node.className='logitem';const label=document.createElement('b');label.textContent=stage;const text=document.createElement('div');text.textContent=msg;node.append(label,text);box.append(node);box.scrollTop=box.scrollHeight;return text}
async function runAgent(){const goal=$('agentInput').value.trim();if(!goal){notice('먼저 목표를 적어 주세요.');return}if(loaded!==chosen||!engine){notice('먼저 메인 콘솔에서 현재 모델을 로드해 주세요.');return}if(agentBusy||engineBusy||loading)return;agentBusy=true;busyUi();$('taskLog').textContent='';$('taskLog').dataset.empty='0';$('agentStateText').textContent='RUNNING / Planning';lastAgentOutput='';let steps=[];try{
log('00 / USER GOAL',goal);
const plan=await infer([{role:'system',content:'You are a careful autonomous project agent. Plan at most THREE concrete, executable writing/reasoning subtasks for a user goal. Do not claim to browse the web, use external accounts, or modify actual files. Output strictly three Korean lines, each starting "1. ", "2. ", "3. ". No introduction.'},{role:'user',content:goal}],{max_tokens:240});log('01 / PLAN CREATED',plan);
steps=plan.split('\n').map(x=>x.replace(/^\s*[-*\d.]+\s*/, '').trim()).filter(Boolean).slice(0,3);if(!steps.length)steps=[goal];let notes='';for(let i=0;i<steps.length;i++){const step=steps[i];$('agentStateText').textContent=`RUNNING / Step ${i+1} of ${steps.length}`;const output=await infer([{role:'system',content:'You are an autonomous execution assistant. Carry out ONE requested task concretely, with useful specifics. Reply in Korean. No pretend browsing, no invented verified facts. Keep under about 250 Korean words.'},{role:'user',content:`Original objective: ${goal}\nCurrent subtask: ${step}\nPrevious work:\n${notes.slice(-2800)}`}],{max_tokens:450});const rendered=output||'(모델이 빈 결과를 반환했습니다)';log(`0${i+2} / EXECUTED · ${step}`,rendered);notes+=`\n[${step}]\n${rendered}\n`}
$('agentStateText').textContent='RUNNING / Quality review';const review=await infer([{role:'system',content:'You are an editor and reviewer. From the provided task outputs create one polished, practical, coherent final deliverable in Korean. Correct obvious gaps, do not invent evidence or say external actions were performed. Use clear section headings.'},{role:'user',content:`Objective: ${goal}\nWork outputs:\n${notes.slice(-8500)}`}],{max_tokens:700});lastAgentOutput=review||notes;log('FINAL / DELIVERED',lastAgentOutput);$('agentStateText').textContent='DONE / '+steps.length+' steps completed';notice('에이전트 작업을 완료했습니다. 결과물을 저장해 보세요.')}catch(e){log('ERROR / STOPPED',e.message||String(e));$('agentStateText').textContent='ERROR / Execution stopped';notice('에이전트 실행이 중단되었습니다.')}finally{agentBusy=false;busyUi()}}
function downloadText(text,name){const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function toggleAgent(open){$('agentOverlay').classList.toggle('open',open);document.body.style.overflow=open?'hidden':'';if(open)$('agentInput').focus()}
$('modelGrid').addEventListener('click',e=>{const b=e.target.closest('[data-model]');if(!b||loading||engineBusy||agentBusy)return;chosen=b.dataset.model;refreshModel();$('playground').scrollIntoView({behavior:matchMedia('(max-width:650px)').matches?'instant':'smooth',block:'start'})});
$('loadBtn').addEventListener('click',loadModel);$('sendBtn').addEventListener('click',send);$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}});
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('messageInput').value=b.dataset.prompt;$('messageInput').focus()}));
$('exportChat').addEventListener('click',()=>{if(!history.length)return notice('내보낼 채팅이 없습니다.');downloadText(history.map(x=>(x.role==='user'?'YOU':'AETHERION')+'\n'+x.content).join('\n\n---\n\n'),'aetherion-conversation.txt')});
$('clearChat').addEventListener('click',()=>{if(!confirm('저장된 채팅 기록을 지울까요?'))return;history=[];persist();$('messages').textContent='';const e=document.createElement('div');e.className='emptychat';e.id='emptyChat';e.innerHTML='<div class="emptymark">A/</div><h3>Ready for a new conversation.</h3><p>새로운 질문을 입력해 주세요.</p>';$('messages').append(e);updateMeta()});
$('openAgent').addEventListener('click',()=>toggleAgent(true));$('closeAgent').addEventListener('click',()=>toggleAgent(false));$('agentOverlay').addEventListener('click',e=>{if(e.target===$('agentOverlay')&&!agentBusy)toggleAgent(false)});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!agentBusy)toggleAgent(false)});$('agentStart').addEventListener('click',runAgent);$('agentExample').addEventListener('click',()=>{$('agentInput').value='청소년을 위한 AI 공부 관리 서비스의 1페이지 사업 기획안을 만들어줘. 제품 특징, 핵심 사용자, 수익 구조, 4주 출시 계획을 포함해.'});$('agentClear').addEventListener('click',()=>{$('taskLog').textContent='작업 로그가 비어 있습니다.';$('agentStateText').textContent='IDLE / Nothing running';lastAgentOutput=''});
$('copyResult').addEventListener('click',async()=>{if(!lastAgentOutput)return notice('복사할 결과가 없습니다.');try{await navigator.clipboard.writeText(lastAgentOutput);notice('복사했습니다.')}catch{notice('클립보드 접근이 차단되었습니다.')}});$('downloadResult').addEventListener('click',()=>{if(!lastAgentOutput)return notice('저장할 결과가 없습니다.');downloadText(lastAgentOutput,'aetherion-agent-report.txt')});$('navLaunch').addEventListener('click',()=>{$('playground').scrollIntoView({behavior:matchMedia('(max-width:650px)').matches?'instant':'smooth'})});
refreshModel();renderSaved();
// Adapter discovery runs after the first paint; this avoids startup contention.
if('requestIdleCallback' in window)requestIdleCallback(()=>detectGPU(),{timeout:1800});
else setTimeout(()=>detectGPU(),350);
