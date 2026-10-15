/* Selected research context is advisory. Only the explicit Research button fetches a new stock.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | With no research draft and no loaded stock research, a connected action opened nothing and the shell said "Select or enter the work to continue first" on a screen with nothing to select. The research draft panel now opens for the work to be written there, and the person is told exactly that. Guard: scripts/phone-screens.browser.cjs (intelligent-trades).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The research hand-off is the report's summary (researchSummaryText over RS_REPORT), not the screen's innerText, which carried the Buy, + Watchlist and chart controls. Guard: tests/research-handoff-summary.test.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Research opened on its default sub-tab (SUB null, which is the stock tab) counted as nothing loaded, so Review with Finance said there was nothing to hand on beside a loaded report. The stock tab is SUB 'stock' or the default. Guard: tests/research-handoff-summary.test.js.
 */
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
  const nothing='Nothing on this screen to hand on yet. Write the research to continue under “Continue your research” above (or research a stock first), then choose the action again.';
  await mountConnectedActions({app:'intelligent-trades',element,contextForOffer:()=>{
    if(!panel.hidden&&draft.value.trim())return {title:'Review my market research',notes:draft.value.trim().slice(0,2000)};
    // Only the currently displayed, successfully loaded research result supplies evidence.
    const result=document.getElementById('rsBody');
    const loaded=VIEW==='research'&&(SUB||'stock')==='stock'&&RS_SYM&&result&&!result.querySelector('.spin,.err');
    // The report's own summary, never the screen text (that carried Buy, + Watchlist and the chart controls).
    const notes=loaded&&RS_REPORT&&RS_REPORT.symbol===RS_SYM?researchSummaryText(RS_REPORT):'';
    if(notes)return {title:'Research for '+RS_SYM,notes:notes.slice(0,2000)};
    // Nothing to hand on: open the draft panel so the work can be written here, and say so.
    panel.hidden=false;draft.focus();
    throw new Error(nothing);
  }});
  element.querySelectorAll('button').forEach(button=>button.classList.add('btn'));
})();
