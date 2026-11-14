/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Shrink Chromium's captured PNG bytes locally, preserving the entire confirmation picture within the native evidence budget. */
'use strict';
const zlib=require('node:zlib');
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC=Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function chunk(name,body){
  const type=Buffer.from(name),bytes=Buffer.concat([type,body]),out=Buffer.alloc(body.length+12);let crc=0xffffffff;
  for(const b of bytes)crc=CRC[(crc^b)&255]^(crc>>>8);
  out.writeUInt32BE(body.length);bytes.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function decode(bytes){
  if(!bytes.subarray(0,8).equals(SIGNATURE))throw Error('worker_png_invalid');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),type=bytes[25],channels=type===2?3:type===6?4:0;
  if(bytes[24]!==8||!channels||bytes[28]!==0)throw Error('worker_png_format');
  const parts=[];
  for(let at=8;at<bytes.length;){const size=bytes.readUInt32BE(at);if(bytes.toString('ascii',at+4,at+8)==='IDAT')parts.push(bytes.subarray(at+8,at+8+size));at+=size+12;}
  const stride=width*channels,raw=zlib.inflateSync(Buffer.concat(parts),{maxOutputLength:(stride+1)*height});
  const pixels=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];if(filter>4)throw Error('worker_png_filter');
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
      pixels[i]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
  }
  return {width,height,channels,pixels};
}
function encode(image){
  const {width,height,channels,pixels}=image,stride=width*channels,rows=Buffer.alloc((stride+1)*height),header=Buffer.alloc(13);
  for(let y=0;y<height;y++)pixels.copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride);
  header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=channels===3?2:6;
  return Buffer.concat([SIGNATURE,chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
function half(image){
  const width=Math.max(1,Math.floor(image.width/2)),height=Math.max(1,Math.floor(image.height/2)),c=image.channels,pixels=Buffer.alloc(width*height*c);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const source=(y*2*image.width+x*2)*c;image.pixels.copy(pixels,(y*width+x)*c,source,source+c);
  }
  return {width,height,channels:c,pixels};
}
function fit(bytes,maxBytes){
  if(bytes.length<=maxBytes)return bytes;
  let image=decode(bytes),out=bytes;
  while(out.length>maxBytes){image=half(image);out=encode(image);if(image.width===1&&image.height===1)break;}
  return out;
}
module.exports={fit};
