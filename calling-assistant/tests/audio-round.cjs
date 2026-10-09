'use strict';
// Executes the package's actual audio interpreter with the installed local speech provider.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {interpretAudio}=require('../routes/service');
const {defaults,twiml}=require('../routes/policy');
const {LocalSTTProvider}=require(path.join(process.env.OSHAL_CORE_DIR||'/app','dist/features/voice-providers/providers/local-stt-provider.js'));
const root=process.argv[2], reportPath=process.argv[3];
if(!root||!reportPath) throw new Error('Usage: audio-round.cjs fixture-directory report.json');
function wave(samples,rate=16000){const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((s,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(s*32767))),44+i*2));return b;}
function samples(wav){let off=12;while(off+8<=wav.length){const len=wav.readUInt32LE(off+4);if(wav.toString('ascii',off,off+4)==='data')return Array.from({length:len/2},(_,i)=>wav.readInt16LE(off+8+i*2)/32768);off+=8+len+(len%2);}throw new Error('WAV data missing');}
const melody=(i)=>{const notes=[261.63,329.63,392,349.23,293.66,440,392,329.63];const f=notes[Math.floor(i/4000)%notes.length];return (Math.sin(2*Math.PI*f*i/16000)+.3*Math.sin(2*Math.PI*f*2*i/16000))*.14*Math.sin(Math.PI*(i%4000)/4000);};
let seed=841;const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/4294967296-.5)*.025;};
async function main(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'fixtures.json'),'utf8').replace(/^\uFEFF/,''));
 const cases=manifest.map(f=>({...f,audio:fs.readFileSync(path.join(root,f.file))}));
 cases.push({name:'instrumental-hold-music',expected:'wait',audio:wave(Array.from({length:128000},(_,i)=>melody(i)))},
  {name:'silence',expected:'wait',audio:wave(Array(64000).fill(0))},
  {name:'line-noise',expected:'wait',audio:wave(Array.from({length:64000},noise))});
 for(const base of cases.filter(x=>/menu-before|speech-choice|human/.test(x.name))){
   const pcm=samples(base.audio);
   cases.push({...base,name:base.name+'-quiet-noisy',degraded:true,audio:wave(pcm.map(s=>s*.45+noise()))});
   cases.push({...base,name:base.name+'-music-underlay',degraded:true,audio:wave(pcm.map((s,i)=>s+melody(i)*.35))});
   // Telephone-width downsampling with a low-pass average, encoded as genuine 8kHz PCM WAV.
   cases.push({...base,name:base.name+'-8khz',degraded:true,audio:wave(pcm.filter((_,i)=>i%2===0).map((s,i)=>(s+pcm[i*2+1])/2),8000)});
 }
 const provider=new LocalSTTProvider({timeoutMs:85000}), started=new Date().toISOString(), results=[];
 for(const fixture of cases){
  const start=Date.now();let row;
  try{const result=await interpretAudio(fixture.audio,{keywords:['claims'],responses:[{prompt:'say claims',say:'claims'}]},defaults,
    (audio,mimeType,options)=>provider.transcribe({audio,mimeType,...options}));
    let passed=result.decision.kind===fixture.expected;
    if(fixture.value && fixture.expected==='digits')passed=passed&&result.decision.digits===fixture.value;
    if(fixture.value && fixture.expected==='say')passed=passed&&result.decision.text===fixture.value;
    const rendered=twiml(result.decision,{...defaults,publicOrigin:'https://calling.example.test',from:'+12025550101',transferPhone:'+12025550102'},'11111111-1111-4111-8111-111111111111',1);
    if(result.decision.kind==='digits')assert.match(rendered,/<Play digits=/);
    if(result.decision.kind==='say')assert.match(rendered,/<Say voice=/);
    if(result.decision.kind==='wait')assert.doesNotMatch(rendered,/<Say|<Play|<Dial/);
    row={name:fixture.name,expected:fixture.expected,passed,safeAbstention:!passed&&fixture.degraded===true&&result.decision.kind==='wait',...result,twiml:rendered};
  }catch(e){row={name:fixture.name,expected:fixture.expected,passed:false,error:e.message};}
  row.durationMs=Date.now()-start;results.push(row);console.log(`${row.passed?'PASS':row.safeAbstention?'WAIT':'FAIL'} ${row.name}: ${row.error||row.decision.kind}`);
  fs.writeFileSync(reportPath,JSON.stringify({started,finished:new Date().toISOString(),source:'generated speech WAVs with noise, music and 8kHz variants; actual local ASR; no carrier call',total:cases.length,completed:results.length,passed:results.filter(r=>r.passed).length,results},null,2));
 }
 console.log(`AUDIO RESULT: ${results.filter(r=>r.passed).length}/${results.length}`);
 console.log(`SAFE ABSTENTIONS: ${results.filter(r=>r.safeAbstention).length}`);
 if(results.some(r=>!r.passed&&!r.safeAbstention))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
