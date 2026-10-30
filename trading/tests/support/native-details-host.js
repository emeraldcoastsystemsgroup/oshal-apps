/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Synthetic, read-only account-detail browser fixture using shipped routes, shell, scripts and styles. Never real broker access.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Serve the chart bars route from the same synthetic trading.bars intent for the holding comparison chart.
 */
'use strict';
const path=require('node:path'),fs=require('node:fs');
const {application}=require('./native-portfolio-host');
const {recordAccountValue}=require('../../routes/trading-account-values');
const root=path.resolve(__dirname,'../..'),express=require(path.resolve(root,'../scripts/toolchain/node_modules/express'));
async function detailsHost(){
 const h=application(),a=h.accounts[0];
 a.label='Example retirement …1234';a.cash=3000;a.positions=[{symbol:'ABC',qty:60,currentPrice:100,avgEntryPrice:95,marketValue:6000,unrealizedPl:300},{symbol:'SPY',qty:10,currentPrice:100,avgEntryPrice:90,marketValue:1000,unrealizedPl:100}];
 h.accounts.push({...a,accountId:'b',accountMasked:'…5678',label:'Example cash …5678',equity:5000,cash:5000,positions:[]});
 const original=h.ctx.intent;
 h.ctx.intent=async(name,input)=>name==='trading.accounts'?{accounts:h.accounts,errors:[],readAt:'2026-10-23T19:55:00Z'}:original(name,input);
 for(let i=1;i<23;i++)await recordAccountValue(h.ctx,'owner-a',{...a,equity:9500+i*20,cash:3000},'2026-10-'+String(i).padStart(2,'0')+'T19:55:00Z');
 h.app.get('/api/trading/bars',async(q,r)=>r.json(await h.ctx.intent('trading.bars',{symbol:String(q.query.symbol),timeframe:'1Day',connection:q.query.connection})));
 h.app.get('/api/trading/accounts',(_q,r)=>r.json({nativeReadOnly:true,accounts:h.accounts,books:[]}));
 h.app.get('/api/trading/summary',(_q,r)=>r.json({accounts:h.accounts.map(a=>({...a,nativeReadOnly:true,notTrading:true})),positions:[]}));
 h.app.get('/api/trading/status',(_q,r)=>r.json({liveEnabled:false,paperConfigured:false,liveConfigured:false,guardrails:{}}));
 h.app.get('/api/v1/agent/schedules',(_q,r)=>r.json({schedules:[{app:'intelligent-trades',name:'portfolio-watcher',status:'suspended'}]}));
 h.app.get('/api/trading/',(_q,r)=>{r.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");r.type('html').send(fs.readFileSync(path.join(root,'tools/trading.html'),'utf8'));});
 h.app.use('/api/trading/ui',express.static(path.join(root,'tools/ui')));
 h.app.use('/api/trading-charts/vendor',express.static(path.join(root,'tools/vendor')));
 h.app.get(/^\/shared\/.*\.js$/,(_q,r)=>r.type('js').send(''));
 h.app.get(/^\/shared\/.*\.css$/,(_q,r)=>r.type('css').send(''));
 h.app.get('/cockpit/js/app-handoff.js',(_q,r)=>r.type('js').send('export function receiveHandoff() {}'));
 h.app.get('/cockpit/js/app-workflows.js',(_q,r)=>r.type('js').send('export async function mountConnectedActions() {}'));
 const server=await new Promise(resolve=>{const s=h.app.listen(0,'127.0.0.1',()=>resolve(s));});
 return{...h,server,base:'http://127.0.0.1:'+server.address().port};
}
module.exports={detailsHost};
if(require.main===module)detailsHost().then(h=>process.stdout.write(h.base+'/api/trading/\n'));
