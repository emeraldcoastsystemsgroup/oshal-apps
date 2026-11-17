/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: the portfolio overview's charts, drawn as inline SVG like the account details page (no chart library, no network): a value line with a light wash under it, daily change bars that are green when the value rose and red when it fell, a small trendline with bars for each account card, and a percent-change comparison of several lines. Each chart is drawn at the width of its box, so its text stays at its real size on a phone, and is redrawn when that width changes. A day with no record breaks the line and draws no bar. Every label is escaped. This module makes no request and changes nothing.
 */
'use strict';
// A private lexical block keeps classic-script names isolated, as account-story.js does.
{
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fixed=value=>Math.round(value*10)/10;
 const DOLLARS=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
 const COMPACT=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});

 /** @description Dollars and cents, or a dash when the figure is not known. @param {number|null} value @returns {string} */
 const money=value=>finite(value)?DOLLARS.format(value):'—';
 /** @description Signed dollars (+$1.00, -$1.00, $0.00), or a dash. @param {number|null} value @returns {string} */
 const signedMoney=value=>!finite(value)?'—':value===0?DOLLARS.format(0):(value<0?'-':'+')+DOLLARS.format(Math.abs(value));
 /** @description Short dollars for an axis ($31.2K), or a dash. @param {number|null} value @returns {string} */
 const compactMoney=value=>!finite(value)?'—':Math.abs(value)<1000?DOLLARS.format(Math.round(value)).replace(/\.00$/,''):COMPACT.format(value);
 /** @description A signed percent with two places (+2.31%), or a dash. @param {number|null} value @param {number} [places] @returns {string} */
 const signedPercent=(value,places=2)=>!finite(value)?'—':(value>0?'+':value<0?'-':'')+Math.abs(value).toFixed(places)+'%';
 /** @description A calendar day in words without moving it into the reader's time zone. @param {string} day @param {boolean} [year] @returns {string} */
 const dayWords=(day,year)=>/^\d{4}-\d{2}-\d{2}$/.test(String(day))?new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',...(year?{year:'numeric'}:{}),timeZone:'UTC'}):'an unknown day';

 /**
  * @description Round tick values between two numbers, about `count` of them.
  * @param {number} min Lowest value on the axis.
  * @param {number} max Highest value on the axis.
  * @param {number} count Wanted number of ticks.
  * @returns {Array<number>} The ticks, lowest first.
  */
 function ticks(min,max,count){
  if(!(max>min))return [min];
  const raw=(max-min)/Math.max(1,count),power=10**Math.floor(Math.log10(raw)),unit=raw/power;
  const step=(unit<=1?1:unit<=2?2:unit<=2.5?2.5:unit<=5?5:10)*power,out=[];
  for(let value=Math.ceil(min/step)*step;value<=max+step*1e-9;value+=step)out.push(Math.round(value/step)*step);
  return out;
 }

 /** @description The box a chart draws in: its pixel size and the plot inside its margins. */
 function frame(width,height,margin){
  const w=Math.max(200,Math.round(finite(width)?width:600)),h=Math.round(height);
  return {w,h,left:margin.l,right:w-margin.r,top:margin.t,bottom:h-margin.b};
 }
 /** @description The centre of the i-th of n day bands, so a line point sits over its bar. */
 function bandX(box,n){const band=(box.right-box.left)/Math.max(1,n);return i=>box.left+band*(i+0.5);}
 /** @description A linear vertical scale. */
 function scaleY(box,min,max){return value=>box.bottom-(value-min)/((max-min)||1)*(box.bottom-box.top);}

 /**
  * @description The unbroken runs of a series: a day with no value ends a run, so a gap is never drawn across.
  * @param {Array<number|null>} values One value per day.
  * @returns {Array<Array<number>>} Index runs.
  */
 function runs(values){
  const out=[];let current=[];
  values.forEach((value,i)=>{if(finite(value))current.push(i);else if(current.length){out.push(current);current=[];}});
  if(current.length)out.push(current);
  return out;
 }

 /** @description Hit areas over every day band, larger than the marks; the page's tooltip reads data-pf-chart and data-pf-i. */
 function hitAreas(box,n,chart){
  const band=(box.right-box.left)/Math.max(1,n);
  return '<g class="pf-hits">'+Array.from({length:n},(_,i)=>'<rect class="pf-hit" data-pf-chart="'+escape(chart)+'" data-pf-i="'+i+'" x="'+fixed(box.left+band*i)+'" y="'+box.top+'" width="'+fixed(Math.max(band,1))+'" height="'+(box.bottom-box.top)+'"/>').join('')+'</g>';
 }
 /** @description First and last day under the plot, and the middle one when there is room. */
 function dayAxis(box,days,x){
  if(!days.length)return '';
  const marks=[[0,'start'],[days.length-1,'end']];
  if(box.w>=480&&days.length>4)marks.splice(1,0,[Math.floor((days.length-1)/2),'middle']);
  return marks.filter((m,i,list)=>list.findIndex(o=>o[0]===m[0])===i).map(([i,anchor])=>'<text class="pf-axis" x="'+fixed(anchor==='start'?box.left:anchor==='end'?box.right:x(i))+'" y="'+(box.h-6)+'" text-anchor="'+anchor+'">'+escape(dayWords(days[i]))+'</text>').join('');
 }
 /** @description Horizontal hairlines with their labels on the left. */
 function gridLines(box,values,y,label){
  return values.map(v=>'<line class="pf-grid" x1="'+box.left+'" x2="'+box.right+'" y1="'+fixed(y(v))+'" y2="'+fixed(y(v))+'"/><text class="pf-axis" x="'+(box.left-8)+'" y="'+fixed(y(v)+4)+'" text-anchor="end">'+escape(label(v))+'</text>').join('');
 }

 /**
  * @description A value line over days: a light wash under each unbroken run, the line, a dot for a lone day between gaps, a
  *   ringed dot on the newest value, round dollar ticks and the first and last day, and a hover area over each day.
  * @param {Array<{day:string,value:number|null}>} points The days in the range.
  * @param {{width:number,height?:number,chart:string,label:string}} options Box width, chart id (for the tooltip) and the chart's name.
  * @returns {string} SVG markup.
  */
 function valueChart(points,options){
  const box=frame(options.width,options.height||220,{l:64,r:16,t:14,b:26}),values=points.map(p=>p.value),known=values.filter(finite);
  const lo=Math.min(...known),hi=Math.max(...known),pad=((hi-lo)||Math.max(Math.abs(hi)*0.01,1))*0.15;
  const scale=ticks(lo-pad,hi+pad,4),x=bandX(box,points.length),y=scaleY(box,Math.min(lo-pad,scale[0]),Math.max(hi+pad,scale.at(-1)));
  const lines=runs(values).map(run=>{
   const path=run.map(i=>fixed(x(i))+','+fixed(y(values[i]))).join(' ');
   if(run.length===1)return '<circle class="pf-dot" cx="'+fixed(x(run[0]))+'" cy="'+fixed(y(values[run[0]]))+'" r="3"/>';
   return '<polygon class="pf-area" points="'+fixed(x(run[0]))+','+box.bottom+' '+path+' '+fixed(x(run.at(-1)))+','+box.bottom+'"/><polyline class="pf-line" points="'+path+'"/>';
  }).join('');
  const lastIndex=values.map((v,i)=>finite(v)?i:-1).filter(i=>i>=0).at(-1);
  return '<svg class="pf-svg" data-pf-svg="'+escape(options.chart)+'" viewBox="0 0 '+box.w+' '+box.h+'" width="'+box.w+'" height="'+box.h+'" role="img" aria-label="'+escape(options.label)+'">'+
   gridLines(box,scale,y,compactMoney)+lines+'<circle class="pf-end" cx="'+fixed(x(lastIndex))+'" cy="'+fixed(y(values[lastIndex]))+'" r="4"/>'+
   dayAxis(box,points.map(p=>p.day),x)+'<line class="pf-cross" x1="0" x2="0" y1="'+box.top+'" y2="'+box.bottom+'" visibility="hidden"/>'+hitAreas(box,points.length,options.chart)+'</svg>';
 }

 /**
  * @description One bar's outline: square at the zero line, 4px round corners at the value end.
  * @param {number} x Left edge. @param {number} width Bar width. @param {number} base Zero line. @param {number} end Value end.
  * @returns {string} SVG path data.
  */
 function barPath(x,width,base,end){
  const up=end<base,height=Math.abs(base-end),r=Math.min(4,width/2,height),edge=up?end+r:end-r;
  return 'M'+fixed(x)+','+fixed(base)+'V'+fixed(edge)+'Q'+fixed(x)+','+fixed(end)+' '+fixed(x+r)+','+fixed(end)+'H'+fixed(x+width-r)+'Q'+fixed(x+width)+','+fixed(end)+' '+fixed(x+width)+','+fixed(edge)+'V'+fixed(base)+'Z';
 }

 /**
  * @description Daily change bars around a zero line: green when the value rose, red when it fell, a thin grey mark when it
  *   did not move, nothing on a day that cannot be computed. Bars are at most 24px wide with a gap between them.
  * @param {Array<{day:string,change:number|null}>} changes One entry per day, aligned with the value chart's days.
  * @param {{width:number,height?:number,chart:string,label:string,axis?:boolean}} options Box, chart id ('' for no hover areas), name and whether to label the axis.
  * @returns {string} SVG markup.
  */
 function barsChart(changes,options){
  const axis=options.axis!==false,box=frame(options.width,options.height||96,axis?{l:64,r:16,t:8,b:8}:{l:2,r:2,t:2,b:2}),known=changes.map(c=>c.change).filter(finite);
  const hi=Math.max(0,...known),lo=Math.min(0,...known),span=(hi-lo)||1,y=scaleY(box,lo-span*0.04,hi+span*0.04),x=bandX(box,changes.length);
  const band=(box.right-box.left)/Math.max(1,changes.length),width=Math.max(1,Math.min(24,band-2)),zero=y(0);
  const bars=changes.map((c,i)=>{
   if(!finite(c.change))return '';
   // A move too small to see still gets one pixel in its direction; no move at all is a grey pixel.
   const raw=y(c.change),end=Math.abs(raw-zero)<1?zero+(c.change<0?1:-1):raw,kind=c.change>0?'details-gain-bar':c.change<0?'details-loss-bar':'pf-flat-bar';
   return '<path class="'+kind+'" data-pf-sign="'+(c.change>0?'up':c.change<0?'down':'flat')+'" d="'+barPath(x(i)-width/2,width,zero,end)+'"/>';
  }).join('');
  const labels=axis?[hi>0?[hi,y(hi)+4]:null,lo<0?[lo,y(lo)+4]:null].filter(Boolean).map(([v,at])=>'<text class="pf-axis" x="'+(box.left-8)+'" y="'+fixed(Math.min(Math.max(at,box.top+10),box.bottom))+'" text-anchor="end">'+escape((v>0?'+':'-')+compactMoney(Math.abs(v)))+'</text>').join(''):'';
  return '<svg class="pf-svg pf-bars" data-pf-svg="'+escape(options.chart)+'" viewBox="0 0 '+box.w+' '+box.h+'" width="'+box.w+'" height="'+box.h+'" role="img" aria-label="'+escape(options.label)+'">'+
   '<line class="pf-zero" x1="'+box.left+'" x2="'+box.right+'" y1="'+fixed(zero)+'" y2="'+fixed(zero)+'"/>'+labels+bars+(options.chart?hitAreas(box,changes.length,options.chart):'')+'</svg>';
 }

 /**
  * @description A card's small trendline in the account's colour over its daily bars, with no axes.
  * @param {Array<{day:string,value:number|null}>} points The days in the range.
  * @param {Array<{day:string,change:number|null}>} changes The daily changes of the same days.
  * @param {{width:number,slot:number,label:string}} options Box width, colour slot and the chart's name.
  * @returns {string} SVG markup (two stacked charts).
  */
 function sparkline(points,changes,options){
  const box=frame(options.width,56,{l:4,r:4,t:6,b:4}),values=points.map(p=>p.value),known=values.filter(finite);
  const lo=Math.min(...known),hi=Math.max(...known),pad=((hi-lo)||Math.max(Math.abs(hi)*0.01,1))*0.1,x=bandX(box,points.length),y=scaleY(box,lo-pad,hi+pad);
  const lines=runs(values).map(run=>run.length===1?'<circle class="pf-s'+options.slot+'-fill" cx="'+fixed(x(run[0]))+'" cy="'+fixed(y(values[run[0]]))+'" r="2.5"/>'
   :'<polyline class="pf-spark pf-s'+options.slot+'" points="'+run.map(i=>fixed(x(i))+','+fixed(y(values[i]))).join(' ')+'"/>').join('');
  return '<svg class="pf-svg pf-spark-line" viewBox="0 0 '+box.w+' '+box.h+'" width="'+box.w+'" height="'+box.h+'" role="img" aria-label="'+escape(options.label)+'">'+lines+'</svg>'+
   barsChart(changes,{width:options.width,height:30,axis:false,chart:'',label:options.label+', daily change'});
 }

 /**
  * @description Several percent-change lines on one axis with a zero line: each account in its colour and the benchmarks in
  *   two greys. A day a series has no value breaks its line.
  * @param {Array<string>} days The comparison's days.
  * @param {Array<{key:string,css:string,points:Array<{day:string,pct:number|null}>}>} series The lines, drawn in order.
  * @param {{width:number,height?:number,chart:string,label:string}} options Box, chart id (for the tooltip) and the chart's name.
  * @returns {string} SVG markup.
  */
 function compareChart(days,series,options){
  const box=frame(options.width,options.height||240,{l:56,r:16,t:14,b:26}),x=bandX(box,days.length);
  const byDay=series.map(s=>{const map=new Map(s.points.map(p=>[p.day,p.pct]));return days.map(day=>map.has(day)?map.get(day):null);});
  const all=byDay.flat().filter(finite),hi=Math.max(0,...all),lo=Math.min(0,...all),pad=((hi-lo)||1)*0.12,scale=ticks(lo-pad,hi+pad,4);
  const y=scaleY(box,Math.min(lo-pad,scale[0]),Math.max(hi+pad,scale.at(-1)));
  const lines=series.map((s,k)=>runs(byDay[k]).map(run=>run.length===1?'<circle class="'+escape(s.css)+'-fill" cx="'+fixed(x(run[0]))+'" cy="'+fixed(y(byDay[k][run[0]]))+'" r="3"/>'
   :'<polyline class="pf-cmp '+escape(s.css)+'" data-pf-series="'+escape(s.key)+'" points="'+run.map(i=>fixed(x(i))+','+fixed(y(byDay[k][i]))).join(' ')+'"/>').join('')).join('');
  return '<svg class="pf-svg" data-pf-svg="'+escape(options.chart)+'" viewBox="0 0 '+box.w+' '+box.h+'" width="'+box.w+'" height="'+box.h+'" role="img" aria-label="'+escape(options.label)+'">'+
   gridLines(box,scale,y,v=>signedPercent(v,scale.length>1&&scale[1]-scale[0]<1?1:0))+'<line class="pf-zero" x1="'+box.left+'" x2="'+box.right+'" y1="'+fixed(y(0))+'" y2="'+fixed(y(0))+'"/>'+lines+
   dayAxis(box,days,x)+'<line class="pf-cross" x1="0" x2="0" y1="'+box.top+'" y2="'+box.bottom+'" visibility="hidden"/>'+hitAreas(box,days.length,options.chart)+'</svg>';
 }

 const api={money,signedMoney,compactMoney,signedPercent,dayWords,ticks,runs,barPath,valueChart,barsChart,sparkline,compareChart};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof globalThis==='object')globalThis.PortfolioCharts=api;
}
