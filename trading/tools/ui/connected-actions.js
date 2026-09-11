/* Selected research context is advisory. Only the explicit Research button fetches a new stock. */
import {receiveHandoff} from '/cockpit/js/app-handoff.js';
import {mountConnectedActions} from '/cockpit/js/app-workflows.js';
(async () => {
  const panel = document.getElementById('researchDraftPanel'), draft = document.getElementById('researchDraft');
  receiveHandoff({app:'intelligent-trades',action:'review-research',contextType:'research-brief',version:1,fields:['title','notes','sourceUrl']}, context => {
    draft.value = [context.title,context.notes,context.sourceUrl ? 'Source: '+context.sourceUrl : ''].filter(Boolean).join('\n\n');
    panel.hidden = false;draft.focus();
    document.getElementById('researchDraftStatus').textContent = 'Draft ready. Enter a stock ticker to research; no order is prepared.';
  });
  document.getElementById('researchDraftGo').onclick = () => {
    const ticker = document.getElementById('researchTicker').value.trim().toUpperCase();
    if(!/^[A-Z.\-]{1,10}$/.test(ticker)){document.getElementById('researchDraftStatus').textContent='Enter a valid stock ticker.';return;}
    researchSymbol(ticker);
  };
  const element=document.querySelector('.connected-app-actions');
  await mountConnectedActions({app:'intelligent-trades',element,contextForOffer:()=>{
    if(!panel.hidden&&draft.value.trim())return {title:'Review my market research',notes:draft.value.trim().slice(0,2000)};
    // Only the currently displayed, successfully loaded research result supplies evidence.
    const result=document.getElementById('rsBody');
    if(VIEW!=='research'||SUB!=='stock'||!RS_SYM||!result||result.querySelector('.spin,.err'))return null;
    const notes=result.innerText.trim();return notes?{title:'Research for '+RS_SYM,notes:('Stock research for '+RS_SYM+'. '+notes).slice(0,2000)}:null;
  }});
  element.querySelectorAll('button').forEach(button=>button.classList.add('btn'));
})();
