// AETHERION Native Autoregressive Transformer v0.3
// All 1-layer Transformer arithmetic is performed directly in WGSL.
// 202-character vocabulary, dim=16, head=1, context=48.
struct Options { count:u32, unused0:u32, unused1:u32, unused2:u32 };
@group(0) @binding(0) var<storage,read> tokens:array<u32>;
@group(0) @binding(1) var<storage,read> weights:array<u32>;
@group(0) @binding(2) var<storage,read> scales:array<f32>;
@group(0) @binding(3) var<storage,read_write> logits:array<f32>;
@group(0) @binding(4) var<uniform> options:Options;
fn q8(offset:u32,scaleId:u32)->f32 {
 let raw=(weights[offset/4u] >> ((offset%4u)*8u)) & 255u;
 let signed=select(i32(raw),i32(raw)-256,raw>=128u);
 return f32(signed)*scales[scaleId];
}
fn embed(pos:u32)->array<f32,16> {
 var v:array<f32,16>;
 let tok=min(tokens[pos],201u);
 for(var d:u32=0u;d<16u;d=d+1u) {
  v[d]=q8(tok*16u+d,0u)+q8(3232u+pos*16u+d,1u);
 }
 return v;
}
fn norm(v:array<f32,16>)->array<f32,16> {
 var out:array<f32,16>;
 var mean:f32=0.0;
 for(var d:u32=0u;d<16u;d=d+1u){mean+=v[d];}
 mean/=16.0;
 var variance:f32=0.0;
 for(var d:u32=0u;d<16u;d=d+1u){let z=v[d]-mean;variance+=z*z;}
 let inv=inverseSqrt(variance/16.0+0.00001);
 for(var d:u32=0u;d<16u;d=d+1u){out[d]=(v[d]-mean)*inv;}
 return out;
}
fn linear(input:array<f32,16>,offset:u32,scaleId:u32)->array<f32,16> {
 var out:array<f32,16>;
 for(var row:u32=0u;row<16u;row=row+1u){
  var sum:f32=0.0;
  for(var col:u32=0u;col<16u;col=col+1u){
   sum+=q8(offset+row*16u+col,scaleId)*input[col];
  }
  out[row]=sum;
 }
 return out;
}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 if(gid.x!=0u){return;}
 let T=min(options.count,48u);
 if(T==0u){return;}
 let residual=embed(T-1u);
 let q=linear(norm(residual),4000u,2u);
 var weighted:array<f32,16>;
 for(var d:u32=0u;d<16u;d=d+1u){weighted[d]=0.0;}
 var total:f32=0.0;
 var biggest:f32=-1e30;
 // For the final causal query, attention only sees positions 0..T-1.
 for(var pos:u32=0u;pos<T;pos=pos+1u){
  let input=norm(embed(pos));
  let k=linear(input,4256u,3u);
  let v=linear(input,4512u,4u);
  var score:f32=0.0;
  for(var d:u32=0u;d<16u;d=d+1u){score+=q[d]*k[d];}
  score/=4.0;
  if(score>biggest){
   let factor=exp(biggest-score);
   for(var d:u32=0u;d<16u;d=d+1u){weighted[d]=weighted[d]*factor+v[d];}
   total=total*factor+1.0;
   biggest=score;
  }else{
   let factor=exp(score-biggest);
   for(var d:u32=0u;d<16u;d=d+1u){weighted[d]+=v[d]*factor;}
   total+=factor;
  }
 }
 var attention:array<f32,16>;
 for(var d:u32=0u;d<16u;d=d+1u){attention[d]=weighted[d]/max(total,1e-20);}
 let projected=linear(attention,4768u,5u);
 var hidden:array<f32,16>;
 for(var d:u32=0u;d<16u;d=d+1u){hidden[d]=residual[d]+projected[d];}
 let middle=norm(hidden);
 var ff:array<f32,32>;
 for(var row:u32=0u;row<32u;row=row+1u){
  var sum:f32=q8(5536u+row,7u);
  for(var col:u32=0u;col<16u;col=col+1u){sum+=q8(5024u+row*16u+col,6u)*middle[col];}
  ff[row]=max(sum,0.0);
 }
 var finalHidden:array<f32,16>;
 for(var row:u32=0u;row<16u;row=row+1u){
  var sum:f32=q8(6080u+row,9u);
  for(var col:u32=0u;col<32u;col=col+1u){sum+=q8(5568u+row*32u+col,8u)*ff[col];}
  finalHidden[row]=hidden[row]+sum;
 }
 let z=norm(finalHidden);
 for(var tok:u32=0u;tok<202u;tok=tok+1u){
  var value:f32=q8(6096u+tok,10u);
  for(var col:u32=0u;col<16u;col=col+1u){value+=q8(tok*16u+col,0u)*z[col];}
  logits[tok]=value;
 }
}
