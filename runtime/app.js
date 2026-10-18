/* AETHERION Runtime v1 application.
 * The performance record is session-local. Compare only matched models/settings.
 */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const T=AetherionTuner,U=AetherionUniversal;
 let current=null,locked=false,device=null,benchRecords=[],messages=[];
 let aborter=null,progressLast=0;
 const time=()=>performance.now();
 function log(text){
  const p=document.createElement('p');
  p.textContent=new Date().toLocaleTimeString()+' '+String(text);
  $('log').prepend(p);while($('log').childElementCount>26)$('log').lastElementChild.remove();
 }
 function status(text,type=''){$('status').textContent=text;$('status').dataset.state=type}
 function set(id,value){$(id).textContent=String(value)}
 function mobile(){return matchMedia('(max-width:750px)').matches || /iPhone|iPod|Android/i.test(navigator.userAgent)}
 function profile(){
  return T.estimate({profile:$('profile').value,mobile:mobile(),
   hardwareConcurrency:navigator.hardwareConcurrency||2,crossOriginIsolated:globalThis.crossOriginIsolated===true,
   overrideGpu:$('gpuOverride').value.trim()===''?undefined:Number($('gpuOverride').value),
   ctx:Number($('context').value)});
 }
 function switchInput(){
  const gguf=$('backend').value==='gguf';
  $('ggufFields').hidden=!gguf;$('mlcFields').hidden=gguf;
  $('profileHint').textContent=gguf?'GGUF만 GPU 레이어·배치·문맥 프리셋 적용':'MLC는 모델별 컴파일된 GPU 커널을 사용합니다. 프리셋은 MLC 속도를 직접 변경하지 않습니다.';
  $('sourceUrl').hidden=$('sourceKind').value!=='url';$('sourceFiles').hidden=$('sourceKind').value!=='files';
 }
 function updateButtons(){
  $('connect').disabled=locked;
  $('disconnect').disabled=locked||!current;
  $('send').disabled=locked||!current;
  $('bench').disabled=locked||!current;
  $('abort').disabled=!aborter;
  $('modelCatalog').disabled=locked;
  $('profile').disabled=locked;$('backend').disabled=locked;
  $('sourceKind').disabled=locked;$('ggufUrl').disabled=locked;
  $('fileSelect').disabled=locked;$('mlcModel').disabled=locked;
 }
 function addMessage(role,content){
  const wrapper=document.createElement('article');wrapper.className='msg '+role;
  const title=document.createElement('small');title.textContent=role==='user'?'YOU':'AETHERION / LOCAL';
  const body=document.createElement('div');body.className='msgBody';body.textContent=content;
  wrapper.append(title,body);$('messages').append(wrapper);
  $('messages').scrollTop=$('messages').scrollHeight;
  return body;
 }
 function settingsSummary(){
  const config=profile();
  $('settingInfo').textContent='GPU 레이어 '+config.n_gpu_layers+'개 요청 · 문맥 '+config.n_ctx+' · batch '+config.n_batch+'/'+config.n_ubatch+' · CPU threads '+config.n_threads+' · 다운로드 '+config.parallelDownloads+'개 병렬';
 }
 function getSelection(){
  if($('backend').value==='gguf'){
   if($('sourceKind').value==='files'){
    const files=Array.from($('fileSelect').files).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    if(!files.length)throw Error('GGUF 파일 또는 분할된 shard 파일을 선택해 주세요.');
    if(files.some(f=>!f.name.toLowerCase().endsWith('.gguf')))throw Error('GGUF 파일만 선택할 수 있습니다.');
    const key='files:'+files.map(x=>x.name+'/'+x.size).join(',');
    return {backend:'gguf',id:key,files};
   }
   const url=T.validateSource($('ggufUrl').value.trim());
   return {backend:'gguf',url,id:url};
  }
  const id=$('mlcModel').value;
  if(!id)throw Error('먼저 모델 카탈로그를 불러와 선택해 주세요.');
  return {backend:'mlc',id};
 }
 async function loadCatalog(){
  if(locked)return;
  $('modelCatalog').disabled=true;status('WebLLM 모델 카탈로그 불러오는 중…');
  try{
   const items=await U.catalog();
   if(!items.length)throw Error('현재 WebLLM에서 모델 목록을 제공하지 않습니다.');
   const old=$('mlcModel').value;
   $('mlcModel').replaceChildren();
   const filtered=items.filter(x=>/qwen|llama|gemma|phi|mistral|smol/i.test(x.id));
   filtered.sort((a,b)=>{
    const rank=x=>x.id.includes('Qwen3-0.6B')?-2:x.id.includes('Qwen3')?-1:0;
    return rank(a)-rank(b)||a.id.localeCompare(b.id);
   });
   for(const item of filtered){
    const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.id+(item.vramMB?' (VRAM 약 '+item.vramMB+'MB)':'');
    $('mlcModel').append(opt);
   }
   if([...$('mlcModel').options].some(x=>x.value===old))$('mlcModel').value=old;
   set('catalogCount',filtered.length+'개 모델 카탈로그 조회 완료');
   status('MLC 공식 카탈로그 준비','ready');
   log('WebLLM '+items.length+'개 전체 등록 모델 중 주요 텍스트 모델 '+filtered.length+'개 표시');
  }catch(e){status('카탈로그 오류','error');log(e?.message||e)}
  finally{$('modelCatalog').disabled=false}
 }
 async function connect(){
  if(locked)return;locked=true;updateButtons();
  status('로컬 모델 초기화 중…','loading');set('offload','요청 설정 / 실제 사용 미검증');
  let next=null;
  try{
   const selection=getSelection();
   const opts=profile();settingsSummary();
   const needsGpu=selection.backend==='mlc'||opts.n_gpu_layers>0;
   if(!needsGpu){
    device={key:'cpu-only/'+(navigator.hardwareConcurrency||1),label:'CPU · WebAssembly',shaderF16:false,maxStorageBufferBindingSize:0};
    set('gpu',device.label);set('deviceLimits','CPU-only · WebGPU 불필요');
   }else if(!device||device.key.startsWith('cpu-only/')){
    device=await U.inspectGpu();set('gpu',device.label);
    set('deviceLimits',Math.round(device.maxStorageBufferBindingSize/2**20)+'MB binding · f16 '+(device.shaderF16?'yes':'no'));
   }
   if(current){await current.close();current=null;messages=[];$('messages').textContent='';}
   const started=time();
   next=await U.load(selection,opts,event=>{
    if(event.kind==='download'){
     if(time()-progressLast>240||event.fraction===1){progressLast=time();set('progress',Math.round(event.fraction*100)+'%');}
    }else if(event.text&&time()-progressLast>600){log(event.text.slice(0,120));progressLast=time();}
   });
   current=next;next=null;
   set('loadedTime',((time()-started)/1000).toFixed(2)+' s');
   set('engineType',current.backend==='gguf'?'Wllama GGUF + AETHERION scheduler':'MLC WebGPU + AETHERION scheduler');
   set('modelName',current.modelKey);
   set('offload',current.backend==='gguf'?
    (opts.n_gpu_layers===0?'CPU 전용 모드 · GPU 0레이어':'GPU '+opts.n_gpu_layers+'개 레이어 요청 · 실제 오프로딩 미검증'):'WebLLM 컴파일 GPU 커널 · WebGPU');
   log('모델 준비: '+current.modelKey+' · 실행 엔진 '+current.backend);
   if(current.context)log('모델 정보: '+current.context.n_layer+' layers, actual context='+current.context.n_ctx);
   status('로컬 AI 준비됨','ready');
  }catch(e){
   log('모델 로딩 실패: '+(e?.message||e));
   status('모델 실행 실패 · 다른 설정 또는 더 작은 모델 시도','error');
   if(next)try{await next.close()}catch{}
  }finally{locked=false;updateButtons()}
 }
 async function disconnect(){
  if(locked||!current)return;
  locked=true;updateButtons();
  try{await current.close();}catch(e){log(e?.message||e)}
  current=null;messages=[];$('messages').textContent='';
  set('modelName','미로드');set('offload','—');status('모델 연결 해제','');
  locked=false;updateButtons();
 }
 function compact(text){return String(text||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();}
 async function execute(messagesForModel,{bench=false,quiet=false,maxTokens}={}){
  aborter=new AbortController();updateButtons();
  const opts={maxTokens:maxTokens??Number($('maxTokens').value),temperature:bench?0:Number($('temperature').value),signal:aborter.signal};
  let dest=null,text='',lastPaint=0;
  if(!quiet)dest=addMessage('assistant','…');
  try{
   const result=await current.chat(messagesForModel,{...opts,onDelta:chunk=>{
    text+=chunk;
    if(dest&&time()-lastPaint>90){dest.textContent=compact(text)||'생성 중…';lastPaint=time();}
   }});
   if(dest)dest.textContent=compact(result.text||text)||'(빈 답변)';
   if(!bench){
    set('ttft',result.ttftMs===null?'—':Math.round(result.ttftMs)+' ms');
    const decodeMs=result.totalMs-(result.ttftMs||0);
    const rate=decodeMs>0 && result.count>1?(result.count-1)*1000/decodeMs:null;
    set('speed',rate===null?'—':rate.toFixed(2)+' '+(result.unit==='tokens'?'tok/s':'chunks/s'));
    set('lastElapsed',result.totalMs.toFixed(0)+' ms');
    log('추론 '+result.totalMs.toFixed(0)+'ms · 첫 글자 '+(result.ttftMs?.toFixed(0)||'–')+'ms · '+(result.usageKnown?'정확한 토큰 수':'stream chunk 수')+'로 속도 표시');
   }
   return result;
  }finally{aborter=null;updateButtons()}
 }
 async function send(){
  if(locked||!current)return;
  const question=$('prompt').value.trim();if(!question)return;
  locked=true;updateButtons();
  $('prompt').value='';addMessage('user',question);
  const latest=[...messages,{role:'user',content:question}].slice(-12);
  const context=[{role:'system',content:'You are a clear and helpful local assistant. Respond in Korean unless the user requests another language. Never pretend to have online tools.'},...latest];
  try{
   status('GPU에서 로컬 생성 중…','loading');
   const result=await execute(context);
   if(result.text)messages=[...latest,{role:'assistant',content:result.text}].slice(-12);
   status('추론 완료','ready');
  }catch(e){status('추론 오류','error');log(e?.message||e)}
  finally{locked=false;updateButtons()}
 }
 function promptId(p){let h=2166136261;for(let i=0;i<p.length;i++)h=Math.imul(h^p.charCodeAt(i),16777619);return (h>>>0).toString(16)}
 function benchSummary(){
  const runs=benchRecords;
  const lines=runs.slice(-8).reverse().map(x=>{
   const unit=x.unit==='tokens'?'tok/s':'chunks/s';
   return x.profile+' · '+(x.ttftMs?.toFixed(0)||'—')+'ms 첫 응답 · '+(x.rate?.toFixed(2)||'—')+' '+unit+' · '+x.modelKey.slice(0,36);
  });
  $('benchHistory').textContent=lines.join('\n')||'아직 측정 없음';
 }
 async function benchmark(){
  if(locked||!current)return;
  const promptText=$('benchmarkPrompt').value.trim()||'설명: GPU 메모리와 성능을 개선하는 방법 세 가지.';
  const maxTokens=Number($('benchTokens').value);
  locked=true;updateButtons();status('실측 벤치마크 2회 진행 중…','loading');
  const messages=[{role:'user',content:promptText}];
  const measurements=[];
  try{
   for(let i=0;i<2;i++){
    log('벤치마크 '+(i+1)+'/2 시작 · 결과는 모델 생성 성능을 실제 기기에서 측정');
    const r=await execute(messages,{bench:true,quiet:true,maxTokens});
    if(r.ttftMs===null||r.count<=1)throw Error('충분한 스트리밍 토큰/조각이 나오지 않아 측정 불가');
    measurements.push(r);
   }
   const units=measurements[0].unit;
   if(measurements.some(x=>x.unit!==units))throw Error('측정 단위 불일치');
   const summary=T.summarize(measurements,null,units);
   const record={
    ...summary,backend:current.backend,modelKey:current.modelKey,deviceKey:device.key,
    promptKey:promptId(promptText),maxTokens,profile:$('profile').value
   };
   benchRecords.push(record);benchSummary();
   set('benchTTFT',record.ttftMs===null?'—':record.ttftMs.toFixed(1)+'ms');
   set('benchSpeed',(record.rate?.toFixed(2)||'—')+' '+record.unit);
   const prior=benchRecords.slice(0,-1).reverse().find(x=>x.profile!==record.profile&&
    x.backend===record.backend&&x.modelKey===record.modelKey&&x.deviceKey===record.deviceKey&&x.promptKey===record.promptKey&&x.maxTokens===record.maxTokens&&x.unit===record.unit);
   if(current.backend==='mlc'){
    set('compare','MLC 백엔드는 이 프로필로 컴파일된 커널을 변경하지 않으므로 프로필 차이를 최적화 배속으로 표시하지 않습니다.');
   }else if(prior){
    const cmp=T.compare(prior,record);
    set('compare',cmp.comparable?(cmp.ratio>=1?'실측 '+cmp.ratio.toFixed(2)+'× · +'+cmp.percent.toFixed(1)+'%':'실측 '+cmp.ratio.toFixed(2)+'× · '+cmp.percent.toFixed(1)+'% (느려짐)'):cmp.reason);
   }else set('compare','다른 프로필로 같은 모델·프롬프트를 측정하면 실제 개선율을 계산합니다.');
   status('벤치마크 측정 완료','ready');
   log('측정 완료 · '+summary.runs+'회 중앙값 · '+(summary.rate?.toFixed(2)||'—')+' '+summary.unit);
  }catch(e){status('벤치마크 실패','error');log('측정 실패: '+(e?.message||e))}
  finally{locked=false;updateButtons()}
 }
 function exportBench(){
  if(!benchRecords.length){log('내보낼 측정값이 없습니다.');return}
  const text=JSON.stringify({tool:'AETHERION Runtime v1',notice:'GPU timing is approximate; recorded only in browser session.',records:benchRecords},null,2);
  const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='aetherion-local-llm-benchmarks.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 $('qwenPreset').addEventListener('click',()=>{
  $('backend').value='gguf';$('sourceKind').value='url';
  switchInput();
  $('ggufUrl').value='https://huggingface.co/tensorblock/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf';
  log('Qwen3-0.6B · Q4_K_M 프리셋 입력 완료. 파일은 모델 로드 버튼을 누를 때만 다운로드됩니다.');
 });
 $('backend').addEventListener('change',switchInput);
 $('sourceKind').addEventListener('change',switchInput);
 $('profile').addEventListener('change',settingsSummary);
 $('context').addEventListener('change',settingsSummary);
 $('gpuOverride').addEventListener('input',settingsSummary);
 $('modelCatalog').addEventListener('click',loadCatalog);
 $('connect').addEventListener('click',connect);
 $('disconnect').addEventListener('click',disconnect);
 $('sendForm').addEventListener('submit',e=>{e.preventDefault();send()});
 $('bench').addEventListener('click',benchmark);
 $('exportBench').addEventListener('click',exportBench);
 $('abort').addEventListener('click',()=>{aborter?.abort();log('현재 생성 취소 요청')});
 $('clear').addEventListener('click',()=>{if(locked)return;messages=[];$('messages').textContent='';log('대화 내역을 초기화했습니다. 모델은 메모리에 남아 있습니다.')});
 switchInput();settingsSummary();updateButtons();
 log('외부 런타임(WebLLM·Wllama)은 지원 모델만 실행합니다. 속도 향상은 동일 장치 실측 후 판정합니다.');
})();
