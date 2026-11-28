/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Decode actual FFmpeg exports and prove long titles fit landscape, portrait and square canvases across both timeline formats and export resolutions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real fixed native sandbox with its kernel-declared helper list and synthetic media.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Require the final period in decoded native pixels after a Unicode title, while saved text remains unchanged.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {titleFontSize} from '../tools/editor/title-layout.mjs';
import {createTimeline, addSource, appendSegment, addTitle} from '../tools/editor/timeline-model.mjs';
import {migrateMultitrack} from '../tools/editor/multitrack-model.mjs';

const run = promisify(execFile), require = createRequire(import.meta.url);
const {compileTimeline} = require('../routes/video-edit-compiler.js');
const root = await mkdtemp(join(tmpdir(),'video-title-layout-'));
after(() => rm(root,{recursive:true,force:true}));
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const TITLE = 'Open Swarm — Create. Save. Share.';

test('title sizing scales with the canvas and fits long text without changing its source', () => {
  assert.equal(titleFontSize('Opening','large',1280,720),72);
  const size = titleFontSize(TITLE,'large',1280,720);
  assert.ok(size > 0 && size < 72);
  assert.equal(titleFontSize(TITLE,'large',3840,2160),size*3);
  assert.equal(titleFontSize(TITLE,'large',640,360),Math.round(size/2));
  assert.equal(titleFontSize(TITLE,'invalid',1280,720),0);
  for(const size of ['constructor','__proto__','toString'])assert.equal(titleFontSize(TITLE,size,1280,720),0);
});

function titleBounds(bytes,width,height) {
  let left=width,right=-1,pixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const offset=(y*width+x)*3;
    if(bytes[offset]>180 && bytes[offset+1]>180 && bytes[offset+2]>180) {
      left=Math.min(left,x);right=Math.max(right,x);pixels++;
    }
  }
  return {left,right,pixels};
}

function finalGlyphHeight(bytes,width,height) {
  const columns=new Map();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const offset=(y*width+x)*3;
    if(Math.min(...bytes.subarray(offset,offset+3))>180) {
      const rows=columns.get(x)??[];rows.push(y);columns.set(x,rows);
    }
  }
  let x=Math.max(...columns.keys()),rows=[];
  while(columns.has(x))rows.push(...columns.get(x--));
  return Math.max(...rows)-Math.min(...rows)+1;
}

test('actual long-title MP4 glyphs stay inside the safe area in v1 and v2 at every output size',async () => {
  const source=join(root,'clip.mp4');
  await run('ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=32x18:r=30','-frames:v','3',
    '-c:v','libx264','-pix_fmt','yuv420p','-y',source],{timeout:20000});
  let base=addSource(createTimeline('Title fitting'),{kind:'video',asset:'aaaaaaaa-0000-4000-8000-000000000001',
    name:'Actual black clip',frames:3,width:32,height:18,audio:false}).document;
  base=appendSegment(base,'v1');
  base=addTitle(base,{text:TITLE,start:0,end:3,position:'center',size:'large'}).document;
  for(const version of [1,2])for(const [resolution,aspectRatio] of [['720p','16:9'],['1080p','9:16'],['4k','1:1']]) {
    const document={...(version===1?base:migrateMultitrack(base)),aspectRatio};
    const compiled=compileTimeline({document,media:{v1:source},variant:'export',resolution,fps:30,fontFile:FONT});
    const folder=join(root,`${version}-${resolution}`);await mkdir(folder);
    for(const file of compiled.files)await writeFile(join(folder,file.name),file.text);
    assert.equal(document.titles[0].text,TITLE,'rendering never rewrites the saved title');
    assert.equal(compiled.files[0].text,TITLE+'\u200b\u200b','only the encoder file receives invisible byte-count padding');
    await run('ffmpeg',compiled.args,{cwd:folder,timeout:30000});
    const {stdout}=await run('ffmpeg',['-v','error','-i',join(folder,'output.mp4'),'-frames:v','1',
      '-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:compiled.width*compiled.height*3+65536,timeout:30000});
    assert.equal(stdout.length,compiled.width*compiled.height*3);
    const bounds=titleBounds(stdout,compiled.width,compiled.height),label=`v${version} ${resolution} ${aspectRatio}`;
    assert.ok(bounds.pixels>50,label+' renders actual glyphs');
    assert.ok(bounds.left>=compiled.width*0.04,label+' keeps the first glyph inside the frame');
    assert.ok(bounds.right<=compiled.width*0.96,label+' keeps the last glyph inside the frame');
  }
});

test('the actual fixed native sandbox loads its admitted helpers and exports a fitted title',async () => {
  assert.ok(process.env.OSHAL_KERNEL_ROOT,'Set OSHAL_KERNEL_ROOT to the reviewed kernel source for the native renderer contract.');
  const native=join(process.env.OSHAL_KERNEL_ROOT,'crates/oshald/src/video_editor_executor');
  const contract=await readFile(join(native,'renderer.rs'),'utf8');
  const helpers=/const HELPERS:[\s\S]*?= &\[([\s\S]*?)\];/.exec(contract);
  assert.ok(helpers,'the renderer declares its closed helper list');
  const workspace=join(root,'native');
  for(const name of ['helpers','media','work'])await mkdir(join(workspace,name),{recursive:true});
  for(const [,source,name] of helpers[1].matchAll(/\("([^"]+)", "([^"]+)"\)/g)) {
    await copyFile(new URL('../'+source,import.meta.url),join(workspace,'helpers',name));
  }
  await copyFile(join(native,'native-render.cjs'),join(workspace,'helpers/native-render.cjs'));
  await run('ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=32x18:r=30','-frames:v','3',
    '-c:v','libx264','-pix_fmt','yuv420p','-y',join(workspace,'media/clip.mp4')],{timeout:20000});
  let document=addSource(createTimeline('Native title fitting'),{kind:'video',asset:'aaaaaaaa-0000-4000-8000-000000000001',
    name:'Actual black clip',frames:3,width:32,height:18,audio:false}).document;
  document=addTitle(appendSegment(document,'v1'),{text:TITLE,start:0,end:3,position:'center',size:'large'}).document;
  await writeFile(join(workspace,'work/input.json'),JSON.stringify({op:'encode',document,media:{v1:'/media/clip.mp4'},variant:'export'}));
  const args=['--unshare-all','--die-with-parent','--new-session','--clearenv'];
  for(const dir of ['/usr','/lib','/lib64','/etc/ld.so.cache','/etc/alternatives'])if(existsSync(dir))args.push('--ro-bind',dir,dir);
  args.push('--proc','/proc','--dev','/dev','--tmpfs','/tmp');
  for(const name of ['helpers','media'])args.push('--ro-bind',join(workspace,name),'/'+name);
  args.push('--bind',join(workspace,'work'),'/work','--chdir','/work','--setenv','PATH','/usr/bin',
    '--setenv','LANG','C','--','/usr/bin/node','/helpers/native-render.cjs');
  const {stdout}=await run('bwrap',args,{timeout:30000});
  const receipt=JSON.parse(stdout);assert.equal(receipt.output.frames,3);
  const {stdout:bytes}=await run('ffmpeg',['-v','error','-i',join(workspace,'work/output.mp4'),'-frames:v','1',
    '-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:1280*720*3+65536,timeout:30000});
  const bounds=titleBounds(bytes,1280,720);assert.ok(bounds.pixels>50);
  assert.ok(bounds.left>=1280*0.04 && bounds.right<=1280*0.96,'actual native glyphs fit the canvas');
  assert.ok(finalGlyphHeight(bytes,1280,720)<titleFontSize(TITLE,'large',1280,720)/3,
    'the final period actually renders; a Unicode dash must not drop the last e and period');
});
