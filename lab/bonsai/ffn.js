/* AETHERION Qwen3.5 Dense FFN Primitive Lab v0.6
 * Native WGSL RMSNorm + SwiGLU + dense projections + residual.
 * Operates on deterministic FP32 fixtures; does not claim actual Bonsai logits.
 */
'use strict';
const BonsaiFFN=(()=>{
const WGSL=[
'struct Settings {d:u32, f:u32, rows:u32, reserved:u32};',
'@group(0) @binding(0) var<storage,read> input:array<f32>;',
'@group(0) @binding(1) var<storage,read> normWeight:array<f32>;',
'@group(0) @binding(2) var<storage,read> gateWeight:array<f32>;',
'@group(0) @binding(3) var<storage,read> upWeight:array<f32>;',
'@group(0) @binding(4) var<storage,read> downWeight:array<f32>;',
'@group(0) @binding(5) var<storage,read_write> output:array<f32>;',
'@group(0) @binding(6) var<uniform> settings:Settings;',
'@compute @workgroup_size(4)',
'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
' let row=id.x;',
' if(row>=settings.rows){return;}',
' var residual:array<f32,64>;',
' var normalized:array<f32,64>;',
' var mixed:array<f32,128>;',
' var squareSum:f32=0.0;',
' for(var i:u32=0u;i<settings.d;i=i+1u){',
'  residual[i]=input[row*settings.d+i];',
'  squareSum+=residual[i]*residual[i];',
' }',
' let inv=inverseSqrt(squareSum/f32(settings.d)+1e-6);',
' for(var i:u32=0u;i<settings.d;i=i+1u){',
'  normalized[i]=residual[i]*inv*normWeight[i];',
' }',
' for(var j:u32=0u;j<settings.f;j=j+1u){',
'  var gate:f32=0.0;',
'  var up:f32=0.0;',
'  for(var i:u32=0u;i<settings.d;i=i+1u){',
'   gate+=gateWeight[j*settings.d+i]*normalized[i];',
'   up+=upWeight[j*settings.d+i]*normalized[i];',
'  }',
'  let silu=gate/(1.0+exp(-gate));',
'  mixed[j]=silu*up;',
' }',
' for(var i:u32=0u;i<settings.d;i=i+1u){',
'  var sum:f32=residual[i];',
'  for(var j:u32=0u;j<settings.f;j=j+1u){',
'   sum+=downWeight[i*settings.f+j]*mixed[j];',
'  }',
'  output[row*settings.d+i]=sum;',
' }',
'}'
].join('\n');
function shapes(D,F,rows){
 if(![32,64].includes(D)||F!==D*2||!Number.isSafeInteger(rows)||rows<1||rows>8)throw Error('지원하지 않는 FFN 테스트 형태');
}
function fixture(D=32,rows=4){
 const F=D*2;shapes(D,F,rows);
 let seed=0xb05a12;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const fill=(size,scale)=>Float32Array.from({length:size},()=>Math.fround((random()-.5)*scale));
 return {D,F,rows,input:fill(rows*D,1.2),norm:fill(D,1.8),gate:fill(F*D,.15),up:fill(F*D,.15),down:fill(D*F,.13)};
}
function reference(m){
 shapes(m.D,m.F,m.rows);
 const result=new Float32Array(m.rows*m.D);
 for(let row=0;row<m.rows;row++){
  const x=m.input.subarray(row*m.D,(row+1)*m.D);
  let rms=0;for(const v of x)rms+=v*v;
  const inv=1/Math.sqrt(rms/m.D+1e-6);
  const normalized=Float32Array.from(x,(v,i)=>Math.fround(v*inv*m.norm[i]));
  const ff=new Float32Array(m.F);
  for(let j=0;j<m.F;j++){
   let gate=0,up=0;
   for(let i=0;i<m.D;i++){
    gate+=m.gate[j*m.D+i]*normalized[i];
    up+=m.up[j*m.D+i]*normalized[i];
   }
   ff[j]=Math.fround((gate/(1+Math.exp(-gate)))*up);
  }
  for(let i=0;i<m.D;i++){
   let out=x[i];
   for(let j=0;j<m.F;j++)out+=m.down[i*m.F+j]*ff[j];
   result[row*m.D+i]=Math.fround(out);
  }
 }
 return result;
}
function error(a,b){
 if(a.length!==b.length)throw Error('GPU/CPU 길이 불일치');
 let worst=0;
 for(let i=0;i<a.length;i++){
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('비정상 GPU/CPU 출력');
  worst=Math.max(worst,Math.abs(a[i]-b[i]));
 }
 return worst;
}
async function compute(m){
 if(!isSecureContext||!navigator.gpu)throw Error('WebGPU/HTTPS가 지원되지 않습니다');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
 if(!adapter)throw Error('WebGPU adapter unavailable');
 const device=await adapter.requestDevice();
 const buffers=[];
 try{
  const shader=device.createShaderModule({code:WGSL});
  const report=await shader.getCompilationInfo();
  const errors=report.messages.filter(x=>x.type==='error');
  if(errors.length)throw Error('WGSL 컴파일 오류: '+errors.map(x=>x.message).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});
  const U=GPUBufferUsage;
  const upload=(arr,kind)=>{
   const b=device.createBuffer({size:arr.byteLength,usage:kind|U.COPY_DST});
   device.queue.writeBuffer(b,0,arr);buffers.push(b);return b;
  };
  const inputs=[m.input,m.norm,m.gate,m.up,m.down].map(x=>upload(x,U.STORAGE));
  const settings=upload(new Uint32Array([m.D,m.F,m.rows,0]),U.UNIFORM);
  const result=device.createBuffer({size:m.rows*m.D*4,usage:U.STORAGE|U.COPY_SRC});
  const readback=device.createBuffer({size:m.rows*m.D*4,usage:U.COPY_DST|U.MAP_READ});
  buffers.push(result,readback);
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
   ...inputs.map((b,i)=>({binding:i,resource:{buffer:b}})),
   {binding:5,resource:{buffer:result}},{binding:6,resource:{buffer:settings}}
  ]});
  const start=performance.now();
  const cmd=device.createCommandEncoder();
  const pass=cmd.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,group);
  pass.dispatchWorkgroups(Math.ceil(m.rows/4));pass.end();
  cmd.copyBufferToBuffer(result,0,readback,0,m.rows*m.D*4);
  device.queue.submit([cmd.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const output=Float32Array.from(new Float32Array(readback.getMappedRange()));
  readback.unmap();
  return {output,ms:performance.now()-start,adapter:[adapter.info?.vendor,adapter.info?.device].filter(Boolean).join(' / ')||'GPU'};
 }finally{
  for(const b of buffers){try{b.destroy()}catch{}}
  device.destroy();
 }
}
async function run(){
 const button=document.getElementById('ffnRun');
 if(!button||button.disabled)return;
 button.disabled=true;
 const update=(id,t)=>document.getElementById(id).textContent=t;
 update('ffnResult','RMSNorm + SwiGLU GPU 검증 중…');
 try{
  const D=Number(document.getElementById('ffnD').value);
  const m=fixture(D,4);
  const expected=reference(m),actual=await compute(m);
  const diff=error(expected,actual.output);
  update('ffnResult',diff<.0005?'PASS · GPU/CPU FFN 연산 일치':'FAIL · FFN 수치 오차 초과');
  update('ffnError',diff.toExponential(3));
  update('ffnTime',actual.ms.toFixed(2)+' ms');
  update('ffnGpu',actual.adapter);
 }catch(e){
  update('ffnResult','ERROR · '+(e?.message||e));
 }finally{button.disabled=false}
}
if(typeof document!=='undefined'&&document.getElementById('ffnRun'))document.getElementById('ffnRun').addEventListener('click',run);
return Object.freeze({WGSL,fixture,reference,error,compute});
})();
