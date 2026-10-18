/* AETHERION Native Prism Block Codec v0.2
 * Reference: PrismML-Eng/llama.cpp (prism), ggml-quants.c / ggml-common.h
 * Compatible block *layout* for PTQ1_0 (143) and PQ2_0 (142).
 * Model execution requires Hadamard + full Qwen3.5 graph; not supplied here.
 * No external AI inference library.
 */
'use strict';
const PrismBlocks=(()=>{
  const FORMATS=Object.freeze({
    143:{name:'PTQ1_0',bytes:28,bits:1.75},
    142:{name:'PQ2_0',bytes:34,bits:2.125}
  });
  const POW3=[1,3,9,27,81];
  function assertShape(rows,cols,format){
    if(!FORMATS[format])throw Error('지원하지 않는 GGML 텐서 타입: '+format);
    if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols)||rows<1||cols<128||cols%128!==0||rows>4096||cols>4096)throw Error('블록 형태가 올바르지 않습니다: cols는 128의 배수여야 합니다.');
  }
  function f16ToNumber(h){
    const s=h&0x8000?-1:1, exp=(h>>>10)&31, frac=h&1023;
    if(exp===0)return s*Math.pow(2,-14)*(frac/1024);
    if(exp===31)return frac?NaN:s*Infinity;
    return s*Math.pow(2,exp-15)*(1+frac/1024);
  }
  function numberToF16(n){
    if(!Number.isFinite(n))throw Error('유한한 스케일만 허용됩니다');
    const a=new ArrayBuffer(4),v=new DataView(a);v.setFloat32(0,n,true);
    const b=v.getUint32(0,true),sgn=(b>>>16)&0x8000;
    let exp=((b>>>23)&255)-127+15,man=b&0x7fffff;
    if(exp<=0){if(exp<-10)return sgn;man=(man|0x800000)>>> (1-exp);return sgn|((man+0x1000)>>>13)}
    if(exp>=31)return sgn|0x7c00;
    man+=0x1000;if(man&0x800000){man=0;exp++;if(exp>=31)return sgn|0x7c00;}
    return sgn|(exp<<10)|(man>>>13);
  }
  function getBlocks(rows,cols,format){assertShape(rows,cols,format);return rows*(cols/128);}
  function decodeAt(bytes,blockIndex,pos,format){
    const blockSize=FORMATS[format]?.bytes;
    if(!blockSize)throw Error('잘못된 포맷');
    if(!(bytes instanceof Uint8Array))throw Error('Uint8Array가 필요합니다');
    if(!Number.isInteger(blockIndex)||blockIndex<0||!Number.isInteger(pos)||pos<0||pos>=128)throw Error('블록/위치 범위 초과');
    const start=blockIndex*blockSize;if(start+blockSize>bytes.length)throw Error('블록 데이터 누락');
    let q,scaleBits;
    if(format===142){
      const b=bytes[start+2+(pos>>>2)];q=(b>>>((pos%4)*2))&3;
      scaleBits=bytes[start]|(bytes[start+1]<<8);
      return (q-1)*f16ToNumber(scaleBits);
    }
    let packed,n;
    if(pos<80){n=Math.floor(pos/16);packed=bytes[start+(pos%16)]}
    else if(pos<120){n=Math.floor((pos-80)/8);packed=bytes[start+16+((pos-80)%8)]}
    else{n=Math.floor((pos-120)/2);packed=bytes[start+24+((pos-120)%2)]}
    const octet=(packed*POW3[n])&255;
    q=((octet*3)>>>8)-1;
    scaleBits=bytes[start+26]|(bytes[start+27]<<8);
    return q*f16ToNumber(scaleBits);
  }
  function decodeMatrix(bytes,rows,cols,format){
    const blocks=getBlocks(rows,cols,format);
    if(bytes.length!==blocks*FORMATS[format].bytes)throw Error('버퍼 길이가 GGUF 블록 규격과 다릅니다');
    const out=new Float32Array(rows*cols);
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const block=r*(cols/128)+Math.floor(c/128);
        out[r*cols+c]=decodeAt(bytes,block,c%128,format);
      }
    }
    return out;
  }
  function randFactory(seed){let s=seed>>>0;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0}}
  function packFixture(rows,cols,format,seed=0x16b02){
    const blockCount=getBlocks(rows,cols,format),blockSize=FORMATS[format].bytes;
    const buf=new Uint8Array(blockCount*blockSize);
    const expected=new Float32Array(rows*cols);
    const rng=randFactory(seed);
    for(let block=0;block<blockCount;block++){
      const trits=new Int8Array(128);
      for(let i=0;i<128;i++)trits[i]=(rng()%3)-1;
      const start=block*blockSize;
      const scale=f16ToNumber(numberToF16([0.125,0.25,0.5,1,1.5,2][block%6]));
      const code=numberToF16(scale);
      const base=block*128;
      for(let i=0;i<128;i++)expected[base+i]=trits[i]*scale;
      if(format===142){
        buf[start]=code&255;buf[start+1]=code>>>8;
        for(let i=0;i<128;i++){
          buf[start+2+(i>>>2)]|=(trits[i]+1)<<((i%4)*2);
        }
      }else{
        // Exact PTQ1_0 tensor layout in Prism's ggml-quants.c:
        // stage 16 bytes * 5 values, then 8 bytes * 5, then 2 bytes * 4.
        for(let j=0;j<24;j++){
          const width=j<16?16:8,stage=j<16?0:80,offset=j<16?j:j-16;
          let base3=0;
          for(let n=0;n<5;n++)base3=base3*3+(trits[stage+n*width+offset]+1);
          buf[start+j]=Math.floor((base3*256+242)/243);
        }
        for(let h=0;h<2;h++){
          let base3=0;
          for(let n=0;n<4;n++)base3=base3*3+(trits[120+n*2+h]+1);
          base3*=3;
          buf[start+24+h]=Math.floor((base3*256+242)/243);
        }
        buf[start+26]=code&255;buf[start+27]=code>>>8;
      }
    }
    const actual=decodeMatrix(buf,rows,cols,format);
    for(let i=0;i<actual.length;i++){
      if(Math.abs(actual[i]-expected[i])>0.0001)throw Error('Prism packing roundtrip failed at index '+i+': '+actual[i]+' / '+expected[i]);
    }
    return {bytes:buf,reference:expected,rows,cols,format,blockCount};
  }
  function referenceMatvec(weights,rows,cols,activation){
    if(weights.length!==rows*cols||activation.length!==cols)throw Error('참조 행렬/벡터 모양 오류');
    const out=new Float32Array(rows);
    for(let r=0;r<rows;r++){
      let total=Math.fround(0);
      for(let c=0;c<cols;c++)total=Math.fround(total+Math.fround(weights[r*cols+c]*activation[c]));
      out[r]=total;
    }
    return out;
  }
  function randomActivation(cols,seed=0xabcde){
    const rng=randFactory(seed),x=new Float32Array(cols);
    for(let i=0;i<cols;i++)x[i]=Math.fround(((rng()%2001)-1000)/500);
    return x;
  }
  function bytesAsU32(bytes){
    const aligned=new Uint8Array(Math.ceil(bytes.length/4)*4);aligned.set(bytes);
    return new Uint32Array(aligned.buffer);
  }
  function maxError(a,b){
    if(a.length!==b.length)throw Error('다른 길이의 결과');
    let worst=0;
    for(let i=0;i<a.length;i++){
      if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('NaN/Inf 발견');
      worst=Math.max(worst,Math.abs(a[i]-b[i]));
    }
    return worst;
  }
  return Object.freeze({FORMATS,packFixture,decodeAt,decodeMatrix,getBlocks,
    numberToF16,f16ToNumber,referenceMatvec,randomActivation,bytesAsU32,maxError});
})();
