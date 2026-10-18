/* AETHERION WebGPU v2 comparison UI — independent of model launcher. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const action=$('autoRun');
 if(!action||typeof AetherionAutotuneV2==='undefined')return;
 const E=AetherionAutotuneV2;
 let lastReport=null,running=false;
 const label=(id,value)=>{$(id).textContent=String(value)};
 function makeCell(value){const td=document.createElement('td');td.textContent=String(value);return td}
 function render(report){
  const body=$('autoResults');body.replaceChildren();
  const list=E.present(report);
  for(const item of list){
   const tr=document.createElement('tr');
   if(item.selected)tr.className='ae-selected-kernel';
   const status=item.status==='pass'?(item.selected?'선택':'PASS'):item.status==='invalid'?'FAIL · 오차':item.status==='unsupported'?'미지원':'오류';
   tr.append(makeCell(item.name),makeCell(status),makeCell(item.ms),makeCell(item.jitter),makeCell(item.error));
   body.append(tr);
  }
  label('autoProgress','7 / 7 · 실측 완료');
  label('autoWinner',report.winner?list.find(x=>x.id===report.winner).name:'적합한 GPU 커널 없음');
  label('autoSpeedup',report.winner==='serial'?'기존 커널 유지':report.winner?((1+report.gain).toFixed(2)+'× · 후보 벤치마크 개선'):'개선 없음');
  label('autoReason',report.reason);
  label('autoDevice',report.device);
  label('autoThreshold',report.threshold.toExponential(2));
  $('autoSession').disabled=!report.winner;
  $('autoDownload').disabled=false;
 }
 action.addEventListener('click',async()=>{
  if(running)return;
  running=true;action.disabled=true;$('autoDownload').disabled=true;
  lastReport=null;
  $('autoResults').replaceChildren();
  $('autoSession').disabled=true;
  label('autoSessionResult','검증 전');
  label('autoSessionMs','—');
  label('autoSessionDetail','승자 커널을 선택한 뒤 GPU 세션을 실행하세요.');
  label('autoWinner','GPU 검사 준비 중…');
  label('autoSpeedup','—');
  label('autoReason','실제 수치 검증 후 7개 후보의 GPU 실행 시간을 비교합니다.');
  label('autoProgress','GPU 초기화 중');
  try{
   const rows=Number($('autoRows').value),cols=Number($('autoCols').value),format=Number($('autoFormat').value);
   lastReport=await E.run({rows,cols,format,trials:7,onProgress:p=>{
    label('autoProgress',p.step==='compile'?'후보 '+p.variant+' 컴파일…':p.count+' / '+p.total+' 후보 검사 완료');
   }});
   render(lastReport);
  }catch(e){
   label('autoWinner','실행 실패');
   label('autoReason',String(e?.message||e));
   label('autoProgress','GPU 실행 오류. 미검증 후보는 채택하지 않습니다.');
  }finally{running=false;action.disabled=false;}
 });
 $('autoSession').addEventListener('click',async()=>{
  if(!lastReport?.winner)return;
  const button=$('autoSession');
  button.disabled=true;
  let session=null;
  label('autoSessionResult','GPU 가중치 상주 세션 준비 중…');
  try{
   const {rows,cols,format,winner}=lastReport;
   const fixture=PrismBlocks.packFixture(rows,cols,format,0x32aff);
   const x=PrismBlocks.randomActivation(cols,0x99ff);
   session=await AetherionPackedSession.create({rows,cols,format,weights:fixture.bytes,preferredVariant:winner});
   const first=await session.multiply(x);
   const second=await session.multiply(x);
   const difference=AetherionNativeBench.maxError(first.output,second.output);
   if(difference>1e-5)throw Error('동일 입력의 GPU 결과 불일치: '+difference);
   const verify=first.verification;
   label('autoSessionResult','PASS · GPU 호출 '+session.info.calls+'회 · '+(first.fallback?'직렬 복귀':first.variant+' 채택'));
   label('autoSessionMs',second.ms.toFixed(3)+'ms');
   label('autoSessionDetail','상주 가중치 재사용. CPU 정확도 검증 '+verify.checkedRows+'/'+rows+'행 ('+(verify.allRows?'전체':'샘플')+') · 최대 오차 '+verify.maxError.toExponential(2)+'. GPU 읽기 완료 포함 시간이며 LLM 전체 토큰 속도가 아닙니다.');
  }catch(e){
   label('autoSessionResult','FAIL · 계산 결과 미채택');
   label('autoSessionDetail',String(e?.message||e));
  }finally{
   session?.close();
   button.disabled=!lastReport?.winner;
  }
 });

 $('autoDownload').addEventListener('click',()=>{
  if(!lastReport)return;
  const json=JSON.stringify({...lastReport,notice:'End-to-end LLM token throughput not measured. Kernel-only JS queue/fence timings.'},null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='aetherion-gpu-v2-autotune.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1200);
 });
})();
