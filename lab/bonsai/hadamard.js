/* AETHERION FWHT research kernel v0.3
 * A normalized Walsh-Hadamard transform, implemented directly in WGSL.
 * A component experiment, NOT PrismML Bonsai model-specific sign flips.
 */
'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const shader=[
 'struct Info {width:u32, rows:u32, unused0:u32, unused1:u32};',
 '@group(0) @binding(0) var<storage,read> source:array<f32>;',
 '@group(0) @binding(1) var<storage,read_write> destination:array<f32>;',
 '@group(0) @binding(2) var<uniform> info:Info;',
 '@compute @workgroup_size(16)',
 'fn main(@builtin(global_invocation_id) gid:vec3<u32>){',
 ' let row=gid.x;',
 ' if(row>=info.rows){return;}',
 ' var v:array<f32,512>;',
 ' for(var i:u32=0u;i<info.width;i=i+1u){v[i]=source[row*info.width+i];}',
 ' var step:u32=1u;',
 ' loop {',
 '   if(step>=info.width){break;}',
 '   let span=step*2u;',
 '   for(var first:u32=0u;first<info.width;first=first+span){',
 '     for(var j:u32=0u;j<step;j=j+1u){',
 '       let a=v[first+j];let b=v[first+j+step];',
 '       v[first+j]=a+b;v[first+j+step]=a-b;',
 '     }',
 '   }',
 '   step=span;',
 ' }',
 ' let scale=inverseSqrt(f32(info.width));',
 ' for(var i:u32=0u;i<info.width;i=i+1u){destination[row*info.width+i]=v[i]*scale;}',
 '}'
 ].join('\n');
 function fwht(values,width,rows){
  if(![64,128,256,512].includes(width)||!Number.isInteger(rows)||rows<1||rows>32)throw Error('Invalid Hadamard shape');
  if(values.length!==width*rows)throw Error('Invalid input length');
  const out=Float32Array.from(values);
  for(let r=0;r<rows;r++){
   const offset=r*width;
   for(let step=1;step<width;step*=2){
    for(let base=0;base<width;base+=step*2){
     for(let i=0;i<step;i++){
      const a=out[offset+base+i],b=out[offset+base+i+step];
      out[offset+base+i]=Math.fround(a+b);
      out[offset+base+i+step]=Math.fround(a-b);
     }
    }
   }
   const factor=1/Math.sqrt(width);
   for(let i=0;i<width;i++)out[offset+i]=Math.fround(out[offset+i]*factor);
  }
  return out;
 }
 function maxError(a,b){
  if(a.length!==b.length)throw Error('Mismatched vector sizes');
  let m=0;for(let i=0;i<a.length;i++){
   if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('Non-finite FWHT output');
   m=Math.max(m,Math.abs(a[i]-b[i]));
  }
  return m;
 }
 const log=msg=>{
  const el=$('hwLog');if(!el)return;
  el.textContent=msg;
 };
 async function perform(){
  const run=$('hwRun');
  if(run.disabled)return;run.disabled=true;
  let device=null;
  try{
   if(!isSecureContext||!navigator.gpu)throw Error('WebGPU 지원 브라우저가 필요합니다');
   const width=Number($('hwWidth').value),rows=Number($('hwRows').value);
   const input=new Float32Array(width*rows),seed=0x5139;
   for(let i=0;i<input.length;i++)input[i]=Math.fround((Math.sin(i*19.31+seed)+Math.cos(i*2.37))/3);
   const expected=fwht(input,width,rows);
   const twice=fwht(expected,width,rows);
   const inverseError=maxError(input,twice);
   if(inverseError>0.001)throw Error('Hadamard 자기 역변환 검증 실패 '+inverseError);
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})||await navigator.gpu.requestAdapter();
   if(!adapter)throw Error('WebGPU GPU 어댑터 없음');
   device=await adapter.requestDevice();
   const module=device.createShaderModule({code:shader});
   const compilation=await module.getCompilationInfo();
   const errors=compilation.messages.filter(x=>x.type==='error');
   if(errors.length)throw Error('WGSL 컴파일 오류: '+errors.map(x=>x.message).join('; ').slice(0,250));
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   const B=GPUBufferUsage;
   const upload=(v,usage)=>{
    const b=device.createBuffer({size:v.byteLength,usage:usage|B.COPY_DST});
    device.queue.writeBuffer(b,0,v);return b;
   };
   const inputBuffer=upload(input,B.STORAGE);
   const outputBuffer=device.createBuffer({size:input.byteLength,usage:B.STORAGE|B.COPY_SRC});
   const result=device.createBuffer({size:input.byteLength,usage:B.MAP_READ|B.COPY_DST});
   const config=upload(new Uint32Array([width,rows,0,0]),B.UNIFORM);
   try{
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
     {binding:0,resource:{buffer:inputBuffer}},
     {binding:1,resource:{buffer:outputBuffer}},
     {binding:2,resource:{buffer:config}}
    ]});
    const start=performance.now();
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(rows/16));pass.end();
    encoder.copyBufferToBuffer(outputBuffer,0,result,0,input.byteLength);
    device.queue.submit([encoder.finish()]);
    await result.mapAsync(GPUMapMode.READ);
    const observed=Float32Array.from(new Float32Array(result.getMappedRange()));
    result.unmap();
    const elapsed=performance.now()-start,err=maxError(expected,observed);
    $('hwTime').textContent=elapsed.toFixed(2)+' ms';
    $('hwError').textContent=err.toExponential(3);
    $('hwResult').textContent=err<0.001?'PASS · GPU FWHT 수치 일치':'FAIL · CPU 기준과 불일치';
    $('hwResult').dataset.ok=err<0.001?'yes':'no';
    log('정규화 FWHT '+rows+' × '+width+' · 재변환 오차 '+inverseError.toExponential(2)+'. Bonsai 2 모델 고유의 부호 변환은 미구현.');
   }finally{[inputBuffer,outputBuffer,result,config].forEach(x=>x.destroy())}
  }catch(e){
   $('hwResult').textContent='ERROR · '+(e?.message||e);
   $('hwResult').dataset.ok='no';log(e?.message||String(e));
  }finally{device?.destroy();run.disabled=false}
 }
 if(typeof window!=='undefined')window.AetherionFWHTReference={fwht,maxError};
 $('hwRun').addEventListener('click',perform);
 log('CPU 역변환과 WebGPU 결과를 함께 확인하는 독립 Hadamard 검증입니다.');
})();
