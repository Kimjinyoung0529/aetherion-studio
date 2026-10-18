/* AETHERION Bonsai Header Audit v0.4
 * Validates full metadata contract for Prism rotated GGUF, not a model runtime.
 * Pure-function; no network, no GGUF data copy, safe to run in a browser.
 */
'use strict';
const BonsaiAudit=(()=>{
 const FOLDABLE=/^(?:output\.weight|blk\.\d+\.(?:attn_(?:q|k|v|qkv|gate|output)|ffn_(?:gate|up|down|gate_exps|up_exps|down_exps|gate_up_exps|gate_shexp|up_shexp|down_shexp)|ssm_out)\.weight)$/;
 function audit(header){
  const m=header?.metadata||{},t=header?.allTensorHeaders||header?.tensors||[];
  const byName=new Map(t.map(x=>[x.name,x]));
  const checks=[],add=(level,name,detail)=>checks.push({level,name,detail});
  const architecture=String(m['general.architecture']||'');
  if(architecture==='qwen35')add('ok','모델 아키텍처','GGUF architecture=qwen35');
  else add('error','모델 아키텍처','예상 qwen35, 발견 '+(architecture||'(없음)'));
  const quant=t.filter(x=>x.type===142||x.type===143);
  if(quant.length)add('ok','Prism 텐서 인식',quant.length+'개 PTQ1_0/PQ2_0 텐서');
  else add('error','Prism 텐서 인식','Prism 전용 양자화 텐서 없음');
  const block=Number(m['prism.hadamard.block_size']);
  if(Number.isSafeInteger(block)&&block>=64&&block<=8192&&(block&(block-1))===0)
   add('ok','Hadamard 블록 크기',block+' 요소');
  else add('error','Hadamard 블록 크기','유효한 2의 거듭제곱 블록 크기가 없음');
  if(m['prism.hadamard.transform']==='normalized-sylvester-walsh-hadamard')
   add('ok','변환 방식','normalized-sylvester-walsh-hadamard');
  else add('error','변환 방식','Prism 공식 회전 변환 선언 불일치');
  if(m['prism.hadamard.axis']==='input-last-dimension')
   add('ok','변환 축','input-last-dimension');
  else add('error','변환 축','입력축 변환 선언 불일치');
  const signMode=m['prism.hadamard.sign_mode'];
  const widths=m['prism.hadamard.sign_widths'];
  const signs=m['prism.hadamard.sign_values'];
  const signTables=new Map();
  if(signMode==='identity')add('ok','부호 벡터','Identity (명시적 부호 반전 없음)');
  else if(signMode==='explicit'){
   if(!Array.isArray(widths)||!Array.isArray(signs)||!widths.length){
    add('error','부호 벡터','명시적 부호 배열 누락 또는 지원하지 않는 메타데이터');
   }else{
    let offset=0,valid=true,why='';
    for(const width of widths){
     if(!Number.isSafeInteger(width)||width<=0||(block&&width%block!==0)||signTables.has(width)){
      valid=false;why='부호 폭이 유효하지 않거나 중복';break;
     }
     if(offset+width>signs.length){valid=false;why='부호 값 배열 길이 부족';break;}
     const array=Int8Array.from(signs.slice(offset,offset+width));
     for(let i=0;i<array.length;i++)if(array[i]!==1&&array[i]!==-1){valid=false;why='부호 값은 +1/-1만 허용';break;}
     if(!valid)break;
     signTables.set(width,array);offset+=width;
    }
    if(offset!==signs.length){valid=false;why=why||'부호 값 배열 총합 불일치';}
    add(valid?'ok':'error','부호 벡터',valid?widths.join(', ')+' / '+signs.length+' values':why);
    if(!valid)signTables.clear();
   }
  }else add('error','부호 벡터','지원되지 않는 sign_mode '+(signMode||'(없음)'));
  const nameList=m['prism.hadamard.weight_names'];
  let foldCorrect=0,foldMissing=0,invalidFold=0,incompatible=0,missingSigns=0;
  const failures=[];
  if(!Array.isArray(nameList)||!nameList.length)
   add('error','접힌 가중치 목록','weight_names 필수 배열 누락');
  else{
   for(const name of nameList){
    const tensor=byName.get(name);
    if(typeof name!=='string'||!FOLDABLE.test(name)){invalidFold++;if(failures.length<8)failures.push('허용되지 않는 경로 '+name);continue;}
    if(!tensor){foldMissing++;if(failures.length<8)failures.push('GGUF 텐서 없음 '+name);continue;}
    const dim=tensor.dims?.[0]||0;
    if(!block||dim%block!==0){incompatible++;if(failures.length<8)failures.push('차원/블록 크기 불일치 '+name+': '+dim);continue;}
    if(signMode==='explicit'&&signTables.size&&!signTables.has(dim)){missingSigns++;if(failures.length<8)failures.push('부호 폭 없음 '+name+': '+dim);continue;}
    foldCorrect++;
   }
   add(foldMissing||invalidFold||incompatible||missingSigns?'error':'ok','접힌 가중치 '+nameList.length+'개',
      foldCorrect+'개 일치 / 누락 '+foldMissing+' / 잘못된 경로 '+invalidFold+' / 블록 불일치 '+incompatible+' / 부호 폭 없음 '+missingSigns);
  }
  const inverses=m['prism.hadamard.inverse_weight_names'];
  if(Array.isArray(inverses)){
   const invalid=inverses.filter(x=>x!=='token_embd.weight'||!byName.has(x));
   add(invalid.length?'error':'ok','임베딩 역변환',invalid.length?'유효하지 않은 역변환 대상 '+invalid.join(', '):inverses.join(', ')||'없음');
  }else add('warning','임베딩 역변환','inverse_weight_names 미기재');
  const version=Number(m['prism.hadamard.version']);
  const tied=m['prism.hadamard.tied_output'];
  if(version===1||version===2){
   add((version===2)===(tied===true)?'ok':'error','회전 버전','version '+version+', tied_output '+String(tied===true));
  }else add('warning','회전 버전','버전 미기재 또는 미지원: '+m['prism.hadamard.version']);
  if(m['prism.hadamard.gdn_v_grouped']===true)
   add('warning','GDN V 그룹 순서','모델 전용 헤드 차원 순열 구현 필요');
  const prefix=architecture+'.';
  const layers=Number(m[prefix+'block_count']);
  const interval=Number(m[prefix+'full_attention_interval']||4);
  const recurrentFlags=m[prefix+'attention.recurrent_layers'];
  let recurrent=null,full=null;
  if(Array.isArray(recurrentFlags)&&recurrentFlags.length){
   recurrent=recurrentFlags.filter(Boolean).length;full=recurrentFlags.length-recurrent;
  }else if(Number.isSafeInteger(layers)&&layers>0&&Number.isSafeInteger(interval)&&interval>0){
   full=Math.floor(layers/interval);recurrent=layers-full;
  }
  if(Number.isSafeInteger(layers)&&layers>0){
   add('warning','하이브리드 레이어',layers+'층 / recurrent '+(recurrent??'?')+'층 / full-attention '+(full??'?')+'층 — 아직 미구현');
  }else add('warning','하이브리드 레이어','GGUF block_count 미기재, 실제 Qwen3.5 연산 추가 필요');
  const errors=checks.filter(x=>x.level==='error').length,warnings=checks.filter(x=>x.level==='warning').length;
  return {compatibleMetadata:errors===0,errors,warnings,checks,
    info:{architecture,quantizedTensorCount:quant.length,blocks:block,folded:foldCorrect,totalFoldNames:Array.isArray(nameList)?nameList.length:0,recurrent,full,layers,signWidths:[...signTables.keys()],tensorCount:t.length,tensorTypes:header?.tensorTypes||{}},
    signTables,details:failures};
 }
 function printable(result){
  const state=result.compatibleMetadata?'메타데이터 구조 검사 통과':'메타데이터 불일치';
  const summary=['AETHERION BONSAI MODEL AUDIT','상태: '+state,
    '양자화 텐서: '+result.info.quantizedTensorCount,
    '검사: 오류 '+result.errors+', 경고 '+result.warnings,
    '',
    ...result.checks.map(x=>'['+x.level.toUpperCase()+'] '+x.name+' — '+x.detail)];
  if(result.details.length)summary.push('',...result.details.map(x=>'· '+x));
  summary.push('','주의: GGUF 메타데이터 검사는 전체 LLM GPU 추론 성공을 의미하지 않습니다.');
  return summary.join('\n');
 }
 return Object.freeze({audit,printable});
})();
