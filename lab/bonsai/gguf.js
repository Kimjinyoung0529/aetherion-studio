/* AETHERION GGUF Metadata Inspector v0.2
 * Streaming browser File.slice reader: reads selected tensors, never the entire multi-GB model.
 * Only metadata inspection + Prism GGML types 142/143; NOT a GGUF model runtime.
 */
'use strict';
const GGUFInspector=(()=>{
 const TYPE_SIZE={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
 class Reader{
  constructor(file){this.file=file;this.pos=0;this.cache=new Uint8Array();this.base=0;this.decoder=new TextDecoder('utf-8',{fatal:false});}
  async ensure(n){
   if(!Number.isSafeInteger(n)||n<0||n>1024*1024)throw Error('GGUF metadata read too large');
   if(this.pos>=this.base&&this.pos+n<=this.base+this.cache.byteLength)return;
   if(this.pos+n>this.file.size)throw Error('GGUF file truncated at byte '+this.pos);
   const available=Math.min(Math.max(n,262144),this.file.size-this.pos);
   this.cache=new Uint8Array(await this.file.slice(this.pos,this.pos+available).arrayBuffer());
   this.base=this.pos;
   if(this.cache.length<n)throw Error('Incomplete GGUF read');
  }
  async u8(){await this.ensure(1);return this.cache[this.pos++-this.base];}
  async u16(){await this.ensure(2);const i=this.pos-this.base;const v=this.cache[i]|(this.cache[i+1]<<8);this.pos+=2;return v;}
  async u32(){await this.ensure(4);const i=this.pos-this.base,c=this.cache;const v=(c[i]|c[i+1]<<8|c[i+2]<<16|c[i+3]<<24)>>>0;this.pos+=4;return v;}
  async u64(){const lo=await this.u32(),hi=await this.u32();const n=hi*4294967296+lo;if(!Number.isSafeInteger(n))throw Error('GGUF u64 exceeds JavaScript safe integer');return n;}
  async skip(size){if(!Number.isSafeInteger(size)||size<0||this.pos+size>this.file.size)throw Error('GGUF metadata size invalid');this.pos+=size;}
  async str(limit=4096){
   const n=await this.u64();
   if(n>1e8)throw Error('Suspicious GGUF string length');
   if(n>limit){await this.skip(n);return null;}
   await this.ensure(n);
   const s=this.decoder.decode(this.cache.subarray(this.pos-this.base,this.pos-this.base+n));this.pos+=n;return s;
  }
  async metadataValue(type,depth=0){
   if(depth>1)throw Error('Nested metadata too deep');
   switch(type){
    case 0:return this.u8();
    case 1:{const n=await this.u8();return n>127?n-256:n;}
    case 2:return this.u16();
    case 3:{const n=await this.u16();return n>32767?n-65536:n;}
    case 4:return this.u32();
    case 5:{const n=await this.u32();return n>2147483647?n-4294967296:n;}
    case 6:{await this.ensure(4);const p=this.pos-this.base;const v=new DataView(this.cache.buffer,this.cache.byteOffset).getFloat32(p,true);this.pos+=4;return v;}
    case 7:return !!(await this.u8());
    case 8:return this.str(2048);
    case 9:{
     const elemType=await this.u32(),count=await this.u64();
     if(count>5e6)throw Error('Metadata array too large');
     if(elemType===8){
      for(let i=0;i<count;i++)await this.str(0); // skip token strings without allocating
     }else{
      const size=TYPE_SIZE[elemType];
      if(!size)throw Error('Unsupported GGUF metadata array type '+elemType);
      await this.skip(count*size);
     }
     return '<array: '+count+' values>';
    }
    case 10:return this.u64();
    case 11:{const n=await this.u64();return n>Number.MAX_SAFE_INTEGER/2?null:n;}
    case 12:{await this.ensure(8);const p=this.pos-this.base;const v=new DataView(this.cache.buffer,this.cache.byteOffset).getFloat64(p,true);this.pos+=8;return v;}
    default:throw Error('Unknown GGUF metadata value type '+type);
   }
  }
 }
 async function inspect(file){
  if(!file||typeof file.slice!=='function')throw Error('먼저 GGUF 모델 파일을 선택하세요');
  if(file.size<128)throw Error('GGUF 파일이 너무 작습니다');
  const r=new Reader(file);
  const magic=await r.u32();
  if(magic!==0x46554747)throw Error('GGUF magic header mismatch');
  const version=await r.u32();
  if(version!==3&&version!==2)throw Error('GGUF v2/v3만 검사할 수 있습니다. version='+version);
  const nTensors=await r.u64(),nMeta=await r.u64();
  if(nTensors>100000||nMeta>100000)throw Error('Suspicious GGUF table size');
  const metadata={};
  for(let k=0;k<nMeta;k++){
   const key=await r.str(2048);
   if(key===null)throw Error('GGUF metadata key too long');
   const type=await r.u32();
   const value=await r.metadataValue(type);
   if(value!==null && (key==='general.alignment'||key==='general.architecture'||key==='general.name'||key==='tokenizer.ggml.model'||key==='general.file_type'))metadata[key]=value;
  }
  const tensors=[];
  for(let t=0;t<nTensors;t++){
   const name=await r.str(2048);
   if(name===null)throw Error('GGUF tensor name too long');
   const nDims=await r.u32();
   if(nDims<1||nDims>4)throw Error('Invalid GGUF tensor dimension count: '+nDims);
   const dims=[];
   for(let i=0;i<nDims;i++){
    const dim=await r.u64();if(dim<1||dim>100000000)throw Error('Invalid GGUF tensor dimension');
    dims.push(dim);
   }
   const type=await r.u32(),offset=await r.u64();
   tensors.push({name,dims,type,offset});
  }
  const alignment=metadata['general.alignment']||32;
  if(!Number.isSafeInteger(alignment)||alignment<1||alignment>4096||alignment&(alignment-1))throw Error('Unsupported GGUF tensor alignment');
  const dataStart=Math.ceil(r.pos/alignment)*alignment;
  if(dataStart>file.size)throw Error('GGUF tensor data missing');
  const supported=tensors.filter(x=>(x.type===142||x.type===143)&&x.dims[0]%128===0&&x.dims.length>=2);
  const summary={
   fileName:file.name,size:file.size,version,nTensors,nMeta,alignment,dataStart,
   metadata,supportedCount:supported.length,tensors:supported
  };
  return summary;
 }
 async function readTensorRows(file,header,tensor,desiredRows=32){
  if(tensor.type!==142&&tensor.type!==143)throw Error('지원하지 않는 PTQ/PQ 타입');
  const cols=tensor.dims[0];
  if(cols%128!==0||cols>16384)throw Error('지원하지 않는 텐서 열 크기: '+cols);
  const totalRows=tensor.dims.slice(1).reduce((a,b)=>a*b,1);
  const rows=Math.min(desiredRows,totalRows,128);
  if(!Number.isSafeInteger(totalRows)||rows<1)throw Error('잘못된 GGUF 행 수');
  const bytesPerRow=(cols/128)*(tensor.type===143?28:34);
  const length=rows*bytesPerRow;
  if(length>4*1024*1024)throw Error('샘플 텐서가 너무 큽니다 (4MB 초과)');
  const absolute=header.dataStart+tensor.offset;
  const fullSize=totalRows*bytesPerRow;
  if(!Number.isSafeInteger(fullSize)||absolute+fullSize>file.size)throw Error('GGUF tensor content exceeds file size');
  const raw=new Uint8Array(await file.slice(absolute,absolute+length).arrayBuffer());
  if(raw.length!==length)throw Error('GGUF tensor truncated');
  return {bytes:raw,rows,cols,format:tensor.type,blockCount:rows*(cols/128)};
 }
 return Object.freeze({inspect,readTensorRows});
})();
