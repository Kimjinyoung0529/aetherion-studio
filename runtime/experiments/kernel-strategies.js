/* AETHERION / independent WebGPU kernel designs — PTQ1_0 and PQ2_0
 * Strategy A: legacy scalar rows.
 * Strategy B: scalar trit decoding + workgroup reduction.
 * Strategy C: packed byte decoding (4 x 2-bit or 4/5 x base-3) with cooperative reduction.
 * Strategy D: Split-K two dispatches into block partials, then per-row reduction.
 * Strategy E: one-time GPU dense decompression, then dense streaming GEMV (memory-expensive).
 *
 * Execute with kernel-race.js and judge correctness against PrismBlocks CPU reference.
 */
'use strict';
const AetherionKernelStrategies=(()=>{
 const base=()=>AetherionNativeBench.SERIAL.slice(0,AetherionNativeBench.SERIAL.indexOf('@compute'));
 function packedWordShader(){
  return base()+[
   'var<workgroup> sums:array<f32,128>;',
   '@compute @workgroup_size(32,4)',
   'fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) loc:vec3<u32>){',
   ' let lane=loc.x;let row=group.x*4u+loc.y;',
   ' let slot=loc.y*32u+lane;',
   ' var total:f32=0.0;',
   ' if(row<cfg.rows){',
   '  for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
   '   let baseOff=blockBase(row,block);let scale=blockScale(baseOff);',
   '   var localSum:f32=0.0;',
   '   if(cfg.format==142u){',
   '    let bits=getByte(baseOff+2u+lane);',
   '    for(var d:u32=0u;d<4u;d=d+1u){',
   '     let q=i32((bits>>(d*2u))&3u)-1;',
   '     localSum+=f32(q)*x[block*128u+lane*4u+d];',
   '    }',
   '   }else{',
   '    if(lane<26u){',
   '     let bits=getByte(baseOff+lane);',
   '     var offset:u32=0u;var stride:u32=0u;var count:u32=0u;',
   '     if(lane<16u){offset=lane;stride=16u;count=5u;}',
   '     else if(lane<24u){offset=80u+(lane-16u);stride=8u;count=5u;}',
   '     else{offset=120u+(lane-24u);stride=2u;count=4u;}',
   '     var power:u32=1u;',
   '     for(var d:u32=0u;d<count;d=d+1u){',
   '      let byteTrunc=(bits*power)&255u;',
   '      let q=i32((byteTrunc*3u)>>8u)-1;',
   '      localSum+=f32(q)*x[block*128u+offset+d*stride];',
   '      power*=3u;',
   '     }',
   '    }',
   '   }',
   '   total+=localSum*scale;',
   '  }',
   ' }',
   ' sums[slot]=total;workgroupBarrier();',
   ' for(var stride:u32=16u;stride>0u;stride=stride/2u){',
   '  if(lane<stride){sums[slot]+=sums[slot+stride];}',
   '  workgroupBarrier();',
   ' }',
   ' if(lane==0u&&row<cfg.rows){y[row]=sums[slot];}',
   '}'
  ].join('\n');
 }
 function splitShaders(){
  const hdr=base()+'@group(0) @binding(4) var<storage,read_write> partials:array<f32>;\n';
  const first=hdr+[
   '@compute @workgroup_size(64)',
   'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
   ' let job=id.x;if(job>=cfg.rows*cfg.blocksPerRow){return;}',
   ' let row=job/cfg.blocksPerRow;let block=job%cfg.blocksPerRow;',
   ' let b=blockBase(row,block);',
   ' var sum:f32=0.0;',
   ' for(var p:u32=0u;p<128u;p=p+1u){',
   '  sum+=getTrit(b,p)*x[block*128u+p];',
   ' }',
   ' partials[job]=sum*blockScale(b);',
   '}'
  ].join('\n');
  const second=hdr+[
   '@compute @workgroup_size(64)',
   'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
   ' let row=id.x;if(row>=cfg.rows){return;}',
   ' var sum:f32=0.0;',
   ' for(var block:u32=0u;block<cfg.blocksPerRow;block=block+1u){',
   '  sum+=partials[row*cfg.blocksPerRow+block];',
   ' }',
   ' y[row]=sum;',
   '}'
  ].join('\n');
  return [{code:first,entry:'main'},{code:second,entry:'main'}];
 }
 function denseShaders(){
  const hdr=base()+'@group(0) @binding(5) var<storage,read_write> denseWeights:array<f32>;\n';
  const unpack=hdr+[
   '@compute @workgroup_size(128)',
   'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
   ' let i=id.x;if(i>=cfg.rows*cfg.cols){return;}',
   ' let row=i/cfg.cols;let col=i%cfg.cols;',
   ' let block=col/128u;let b=blockBase(row,block);',
   ' denseWeights[i]=getTrit(b,col%128u)*blockScale(b);',
   '}'
  ].join('\n');
  const matvec=hdr+[
   '@compute @workgroup_size(64)',
   'fn main(@builtin(global_invocation_id) id:vec3<u32>){',
   ' let row=id.x;if(row>=cfg.rows){return;}',
   ' var sum:f32=0.0;',
   ' for(var col:u32=0u;col<cfg.cols;col=col+1u){',
   '  sum+=denseWeights[row*cfg.cols+col]*x[col];',
   ' }',
   ' y[row]=sum;',
   '}'
  ].join('\n');
  return {unpack:{code:unpack,entry:'main'},matvec:{code:matvec,entry:'main'}};
 }
 const STRATEGIES=Object.freeze([
  {id:'scalar',name:'A · 직렬 행 처리',family:'baseline',memoryMultiplier:1},
  {id:'lane32',name:'B · 32-lane 공유메모리',family:'cooperative',memoryMultiplier:1},
  {id:'packed_byte',name:'C · 압축바이트 직접 해독',family:'packed-access',memoryMultiplier:1},
  {id:'split_k',name:'D · Split-K 두 단계',family:'split-k',memoryMultiplier:1},
  {id:'predecode',name:'E · 일회성 해독 후 GEMV',family:'predecode',memoryMultiplier:0}
 ]);
 function makePlan(id,rows,cols){
  const descriptor=STRATEGIES.find(x=>x.id===id);
  if(!descriptor)throw Error('Unknown independent strategy '+id);
  if(!Number.isInteger(rows)||rows<1||!Number.isInteger(cols)||cols<128||cols%128)throw Error('Invalid dimensions');
  const blocks=cols/128;
  if(id==='scalar')return {descriptor,stages:[{code:AetherionNativeBench.SERIAL,entry:'main',dispatch:Math.ceil(rows/64)}],bytesScratch:4,bytesDense:4};
  if(id==='lane32')return {descriptor,stages:[{code:AetherionNativeBench.PARALLEL,entry:'main',dispatch:Math.ceil(rows/4)}],bytesScratch:4,bytesDense:4};
  if(id==='packed_byte')return {descriptor,stages:[{code:packedWordShader(),entry:'main',dispatch:Math.ceil(rows/4)}],bytesScratch:4,bytesDense:4};
  if(id==='split_k')return {descriptor,stages:splitShaders().map((p,i)=>({...p,dispatch:i===0?Math.ceil(rows*blocks/64):Math.ceil(rows/64)})),bytesScratch:rows*blocks*4,bytesDense:4};
  const stages=denseShaders();
  return {descriptor,preprocess:{...stages.unpack,dispatch:Math.ceil(rows*cols/128)},stages:[{...stages.matvec,dispatch:Math.ceil(rows/64)}],bytesScratch:4,bytesDense:rows*cols*4};
 }
 return Object.freeze({STRATEGIES,packedWordShader,splitShaders,denseShaders,makePlan});
})();
if(typeof globalThis!=='undefined')globalThis.AetherionKernelStrategies=AetherionKernelStrategies;
