/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep stock research/chart/search available as declared read-only API tools for Jarvis, using owned module mounts and only data selectors.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const yamlRoots=[__dirname,path.resolve(__dirname,'../../scripts/toolchain'),...(process.env.OSHAL_FRAMEWORK?[path.resolve(process.env.OSHAL_FRAMEWORK)]:[])];
const yaml=require(require.resolve('js-yaml',{paths:yamlRoots}));
const manifest=yaml.load(fs.readFileSync(path.join(__dirname,'../oshal-app.yaml'),'utf8'));
const tools=new Map(manifest.tools.map(t=>[t.name,t]));
test('Jarvis can discover real Trading module stock research, candle and symbol-search reads',()=>{
 for(const[name,endpoint]of [['trading_stock_info','GET /api/trading/research/{input.symbol}'],['trading_stock_chart','GET /api/trading-charts/bars?symbol={input.symbol}&timeframe={input.timeframe}'],['trading_symbol_search','GET /api/trading/symbols/search?q={input.q}'],['trading_company_search','GET /api/trading/companies/search?q={input.q}']]){
  const t=tools.get(name);assert.ok(t,name+' must be declared');assert.equal(t.type,'api');assert.equal(t.executor.executorType,'api');assert.equal(t.executor.apiEndpoint,endpoint);assert.equal(t.requiresApproval,false);assert.equal(t.defaultAuthMode,'auto');assert.ok(t.routingTags.includes('stock'));
  for(const key of ['subject','owner','tenant','accountNumber','connection','url','apply'])assert.equal(t.inputSchema.properties[key],undefined,'tool input must not select '+key);
 }
 assert.ok(tools.has('trading_book_facts'),'existing caller-owned account summary remains available');
});
test('stock read schemas require their data selector and advertise only implemented chart intervals',()=>{
 assert.deepEqual(tools.get('trading_stock_info').inputSchema.required,['symbol']);assert.deepEqual(tools.get('trading_symbol_search').inputSchema.required,['q']);
 assert.deepEqual(tools.get('trading_stock_chart').inputSchema.properties.timeframe.enum,['5Min','15Min','1Hour','1Day','1Week']);
 assert.match(tools.get('trading_stock_info').description,/timestamp/);assert.match(tools.get('trading_stock_info').description,/unavailable/);
});

test('analyst uses declared stock reads and discloses provenance and missing data',()=>{
 const persona=yaml.load(fs.readFileSync(path.join(__dirname,'../personas/trading-analyst.yaml'),'utf8'));
 for(const name of ['trading_stock_info','trading_stock_chart','trading_symbol_search','trading_company_search'])assert.equal(persona.authorizations[name],'auto');
 assert.match(persona.perspective,/quote timestamp/);assert.match(persona.perspective,/unavailable sections/);
 assert.doesNotMatch(persona.perspective,/you do not fetch anything/i);
});
