import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// A deterministic original icon, no external assets or fonts.
function png(size){
  const crc=data=>{let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),len=Buffer.alloc(4),checksum=Buffer.alloc(4);len.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  const bytes=Buffer.alloc(size*(1+size*4));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,p=y*(1+size*4)+1+x*4;
    let color=[16,100,86,255];
    if(u>.27&&u<.73&&v>.2&&v<.8)color=[249,247,239,255];
    if(u>.37&&u<.63&&((v>.37&&v<.42)||(v>.51&&v<.56)||(v>.65&&v<.70)))color=[16,100,86,255];
    color.forEach((c,i)=>bytes[p+i]=c);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))]);
}
for(const target of ['safari','chromium']){
  const out=path.join(root,'dist',target);await mkdir(path.join(out,'icons'),{recursive:true});
  await build({absWorkingDir:root,entryPoints:['src/background.js','src/popup.js','src/options.js'],outdir:out,bundle:true,format:'iife',target:['safari16','chrome110'],logLevel:'warning'});
  for(const name of ['popup.html','options.html','styles.css'])await copyFile(path.join(root,'src',name),path.join(out,name));
  const manifest=JSON.parse(await readFile(path.join(root,'src/manifest.json'),'utf8'));
  if(target==='chromium')manifest.background={service_worker:'background.js'};
  await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const size of [48,96,128,256,512])await writeFile(path.join(out,'icons',`icon-${size}.png`),png(size));
}
console.log('Built dist/safari and dist/chromium. No credentials included.');
