/* CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep contextual Career navigation on the admitted toolbar, carrying only a tool's query and reporting stored counts truthfully. */
(()=>{'use strict';document.documentElement.dataset.embedded=String(window.parent!==window);
 document.addEventListener('click',event=>{const link=event.target.closest?.('a[data-career-tool]');if(!link||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();CareerJobActions.navigate(link.dataset.careerTool,link.href);});
 let pending=null;
 async function readCounts(){try{const response=await fetch('/api/career-hunter/jobs/stats',{cache:'no-store'});if(!response.ok)return null;const data=await response.json();document.querySelectorAll('[data-stage-count]').forEach(el=>{const value=data[el.dataset.stageCount];el.textContent=Number.isFinite(value)?String(value):'';});return data;}catch{return null;}}
 function counts(){if(!pending)pending=readCounts().finally(()=>{pending=null;});return pending;}
 window.CareerNavigation={refreshCounts:counts};void counts();
})();
