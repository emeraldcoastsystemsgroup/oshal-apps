/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Independently decode bounded fixture RGBA8 PNG pixels and create a procedural owned source for engine self-tests.
 */
import { crc32, inflateSync, deflateSync } from 'node:zlib';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const check = ok => { if (!ok) throw new Error('motion_selftest_invalid_png'); };
function dimensions(width, height) { check(width > 0 && height > 0 && width <= 1024 && height <= 1024); }
const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c; };
/** Fixture decoder only; actual application raster admission uses Sharp and the Rust decoder. */
export function decodePng(png) {
  check(Buffer.isBuffer(png) && png.length <= 12 * 1024 * 1024 && png.subarray(0,8).equals(signature));
  let pos=8, width, height, ended=false; const compressed=[];
  while (pos < png.length) {
    check(pos+12<=png.length); const length=png.readUInt32BE(pos), end=pos+12+length; check(end<=png.length);
    const name=png.subarray(pos+4,pos+8), data=png.subarray(pos+8,end-4); check(crc32(Buffer.concat([name,data]))===png.readUInt32BE(end-4));
    const kind=name.toString('ascii');
    if(kind==='IHDR'){check(width===undefined&&pos===8&&length===13);width=data.readUInt32BE(0);height=data.readUInt32BE(4);dimensions(width,height);check(data[8]===8&&data[9]===6&&data[10]===0&&data[11]===0&&data[12]===0);}
    else if(kind==='IDAT'){check(width!==undefined);compressed.push(data);}
    else if(kind==='IEND'){check(length===0&&end===png.length);ended=true;break;}
    else check(!/^[A-Z]/.test(kind));
    pos=end;
  }
  check(ended&&compressed.length>0);
  const stride=width*4, raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});check(raw.length===(stride+1)*height);
  const pixels=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];check(filter<=4);
    for(let x=0;x<stride;x++){
      const index=y*stride+x,a=x>=4?pixels[index-4]:0,b=y?pixels[index-stride]:0,c=y&&x>=4?pixels[index-stride-4]:0;
      pixels[index]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
  }
  return {width,height,pixels};
}
function chunk(name,data){const header=Buffer.alloc(8),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);header.write(name,4);tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name),data])));return Buffer.concat([header,data,tail]);}
export function sourcePng(width=16,height=8){
  dimensions(width,height);const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;raw[i]=255;raw[i+3]=128;}
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
