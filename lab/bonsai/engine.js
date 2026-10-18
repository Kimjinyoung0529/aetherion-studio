/* AETHERION Bonsai Codec Lab — WGSL PTQ1_0/PQ2_0 direct packed matvec.
 * Does NOT execute the full Bonsai LLM. Source format:
 * PrismML-Eng/llama.cpp prism/ggml/src/ggml-quants.c
 */
'use strict';
const $=id=>document.getElementById(id);
const gpuSource=[
'struct Config {rows:u32, cols:u32, format:u32, blocksPerRow:u32};',
'@group(0) @binding(0) var<storage,read> activations: array<f32>;',
'@group(0) @binding(1) var<storage,read> packedBytes: array<u32>;',
'@group(0) @binding(2) var<storage,read_write> outputs: array<f32>;',
'@group(0) @binding(3) var<uniform> cfg: Config;',
'fn readByte(offset:u32)->u32 {',
' let word=packedBytes[offset/4u];',
' return (word >> ((offset%4u)*8u)) & 255u;',
'}',
'fn decodeTrit(base:u32,pos:u32)->f32 {',
' if(cfg.format==142u){',
'   let byte=readByte(base+2u+pos/4u);',
'   return f32(i32((byte >> ((pos%4u)*2u))&3u)-1);',
' }',
' var offset:u32=0u;',
' var power:u32=1u;',
' if(pos<80u){',
'   offset=pos%16u;',
'   let digit=pos/16u;',
'   for(var i:u32=0u;i<digit;i=i+1u){power*=3u;}',
' }else if(pos<120u){',
'   offset=16u+(pos-80u)%8u;',
'   let digit=(pos-80u)/8u;',
'   for(var i:u32=0u;i<digit;i=i+1u){power*=3u;}',
' }else{',
'   offset=24u+(pos-120u)%2u;',
'   let digit=(pos-120u)/2u;',
'   for(var i:u32=0u;i<digit;i=i+1u){power*=3u;}',
' }',
' let code=(readByte(base+offset)*power)&255u;',
' return f32(i32((code*3u)>>8u)-1);',
'}',
'@compute @workgroup_size(64)',
'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
' let row=id.x;',
' if(row>=cfg.rows){return;}',
' let stride=select(28u,34u,cfg.format==142u);',
' var sum:f32=0.0;',
' for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
'   let base=(row*cfg.blocksPerRow+block)*stride;',
'   let off=select(26u,0u,cfg.format==142u);',
'   let fp16=readByte(base+off) | (readByte(base+off+1u)<<8u);',
'   let scale=unpack2x16float(fp16).x;',
'   var partial:f32=0.0;',
'   for(var pos:u32=0u;pos<128u;pos=pos+1u){',
'     partial=partial+decodeTrit(base,pos)*activations[block*128u+pos];',
'   }',
'   sum=sum+partial*scale;',
' }',
' outputs[row]=sum;',
'}'
].join('\n');

let gpu=null,adapter=null,pipeline=null,running=false;
function note(msg){const el=$('log'),p=document.createElement('p');p.textContent=new Date().toLocaleTimeString()+' — '+msg;el.prepend(p);while(el.childElementCount>14)el.lastElementChild.remove();}
function setStatus(msg,type=''){const x=$('status');x.textContent=msg;x.dataset.kind=type;}
function update(id,s){$(id).textContent=s;}
function kb(n){return (n/1024).toFixed(2)+' KiB';}
async function initialize(){
 if(gpu&&pipeline)return;
 if(!isSecureContext||!navigator.gpu)throw Error('브라우저 WebGPU 또는 HTTPS를 지원하지 않습니다');
 adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('WebGPU 어댑터가 없습니다.');
 gpu=await adapter.requestDevice();
 gpu.lost.then(e=>{note('GPU device lost: '+(e.message||e.reason));gpu=null;pipeline=null;setStatus('GPU 장치 손실','error')});
 const module=gpu.createShaderModule({code:gpuSource});
 const compile=await module.getCompilationInfo();
 const errors=compile.messages.filter(e=>e.type==='error');
 if(errors.length)throw Error('WGSL 컴파일 오류: '+errors.map(e=>e.message).join('; '));
 pipeline=await gpu.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
 update('adapter',[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'WebGPU');
 note('Prism PTQ/PQ 직접 GPU 셰이더 컴파일 완료');
}
function buffer(data,usage){
 const obj=gpu.createBuffer({size:Math.max(4,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});
 gpu.queue.writeBuffer(obj,0,data);
 return obj;
}
async function runMatvec(fixture,input){
 const rows=fixture.rows,cols=fixture.cols;
 const inBuf=buffer(input,GPUBufferUsage.STORAGE);
 const packed=buffer(PrismBlocks.bytesAsU32(fixture.bytes),GPUBufferUsage.STORAGE);
 const outBuf=gpu.createBuffer({size:rows*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const read=gpu.createBuffer({size:rows*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const uniform=buffer(new Uint32Array([rows,cols,fixture.format,cols/128]),GPUBufferUsage.UNIFORM);
 const resources=[inBuf,packed,outBuf,read,uniform];
 try{
  const group=gpu.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:inBuf}},
   {binding:1,resource:{buffer:packed}},
   {binding:2,resource:{buffer:outBuf}},
   {binding:3,resource:{buffer:uniform}}
  ]});
  const times=[];let result;
  for(let attempt=0;attempt<4;attempt++){
   const start=performance.now();
   const encoder=gpu.createCommandEncoder();
   const pass=encoder.beginComputePass();
   pass.setPipeline(pipeline);pass.setBindGroup(0,group);
   pass.dispatchWorkgroups(Math.ceil(rows/64));pass.end();
   encoder.copyBufferToBuffer(outBuf,0,read,0,rows*4);
   gpu.queue.submit([encoder.finish()]);
   await read.mapAsync(GPUMapMode.READ);
   result=new Float32Array(read.getMappedRange().slice(0));
   read.unmap();
   if(attempt>0)times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  return {result,ms:times[Math.floor(times.length/2)]};
 }finally{resources.forEach(x=>{try{x.destroy()}catch{}});}
}
async function run(){
 if(running)return;running=true;$('run').disabled=true;setStatus('검증 준비 중…');
 try{
  const rows=Number($('rows').value),cols=Number($('cols').value),format=Number($('format').value);
  await initialize();
  const fixture=PrismBlocks.packFixture(rows,cols,format);
  const x=PrismBlocks.randomActivation(cols);
  const ref=PrismBlocks.referenceMatvec(fixture.reference,rows,cols,x);
  const start=performance.now();
  const result=await runMatvec(fixture,x);
  const elapsed=performance.now()-start;
  const diff=PrismBlocks.maxError(ref,result.result);
  const tolerance=Math.max(.002,cols*.000015);
  const ok=diff<=tolerance;
  update('type',PrismBlocks.FORMATS[format].name);
  update('weightBytes',kb(fixture.bytes.length));
  update('fp16ratio',((rows*cols*2)/fixture.bytes.length).toFixed(2)+'×');
  update('gpuTime',result.ms.toFixed(2)+' ms');
  update('error',diff.toExponential(3));
  update('validation',ok?'PASS · CPU 수치 일치':'FAIL · 수치 오차 초과');
  $('validation').dataset.ok=ok?'yes':'no';
  setStatus(ok?'실제 WebGPU 패킹 연산 통과':'GPU 계산 불일치',ok?'ready':'error');
  note('CPU 참조 대비 최대 오차 '+diff.toExponential(4)+' (허용 '+tolerance+')');
  note('GPU 중앙 지연 '+result.ms.toFixed(2)+'ms · 총 테스트 '+elapsed.toFixed(2)+'ms');
  note(PrismBlocks.FORMATS[format].name+' · '+rows+'×'+cols+' · '+fixture.blockCount+'개 공식 레이아웃 블록');
 }catch(e){
  console.error(e);setStatus('검증 실패','error');
  update('validation','ERROR · '+(e.message||String(e)));
  $('validation').dataset.ok='no';note('오류: '+(e.message||String(e)));
 }finally{running=false;$('run').disabled=false;}
}
$('run').addEventListener('click',run);
note('공식 PrismML PTQ1_0 / PQ2_0 레이아웃용 블록 디코더 준비.');
if(isSecureContext&&navigator.gpu)run();
else setStatus('WebGPU 지원 브라우저에서 실행하세요','error');
