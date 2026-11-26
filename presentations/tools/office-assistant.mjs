/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guide edits are proposals against the exact draft the model read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Display speaker notes updates in `update_slide` proposal reviews.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include cover subtitle in draft snapshots and display `set_subtitle` / `set_title.subtitle` in proposal reviews (CREATE-TOOL-PRESENTATIONS-15).
 */
export function draftSnapshot({kind, title, outline, theme, subtitle = ''}) {
  return JSON.stringify([kind, title, outline, theme, subtitle]);
}

export function createProposalReview({host, readDraft, applyActions, onMessage}) {
  let pending = null;
  function clear() { pending = null; host.replaceChildren(); host.hidden = true; }
  function propose(actions, baseline) {
    clear();
    if (!Array.isArray(actions) || !actions.length) return;
    pending = {actions: structuredClone(actions), baseline};
    host.hidden = false;
    const heading = document.createElement('strong');
    heading.textContent = 'Review suggested changes';
    const list = document.createElement('ul');
    for (const action of actions) {
      const item = document.createElement('li');
      item.textContent = action.op === 'set_outline' ? `Replace outline with ${action.slides?.length || 0} sections:\n${(action.slides || []).map(s => [s.title,...(s.bullets || [])].join('\n')).join('\n\n')}` :
        action.op === 'update_cell' ? `Sheet ${action.index}, cell ${action.cell}: ${action.value}` :
        action.op === 'update_slide' ? `${action.bullets ? 'Replace body of' : action.notes !== undefined && action.title == null ? 'Update speaker notes on' : 'Update heading of'} section ${action.index}: ${action.title || ''} ${(action.bullets || []).join(' · ')}${typeof action.notes === 'string' ? (action.notes ? ' · Notes: ' + action.notes : ' · Clear speaker notes') : ''}` :
        action.op === 'add_slide' ? `Add section: ${action.title || ''}\n${(action.bullets || []).join('\n')}` :
        action.op === 'set_subtitle' ? (action.subtitle ? `Cover subtitle: ${action.subtitle}` : 'Clear cover subtitle') :
        action.op === 'set_title' ? `Title: ${action.title}${typeof action.subtitle === 'string' ? (action.subtitle ? ` · Subtitle: ${action.subtitle}` : ' · Clear subtitle') : ''}` : `Theme: ${action.theme}`;
      list.append(item);
    }
    const apply = document.createElement('button');
    apply.type = 'button'; apply.className = 'btn'; apply.textContent = 'Apply changes';
    apply.addEventListener('click', () => {
      if (!pending) return;
      if (draftSnapshot(readDraft()) !== pending.baseline) {
        clear(); onMessage('The draft changed while these suggestions were being prepared. Ask again using the current draft.'); return;
      }
      const actionsToApply = pending.actions;
      clear();
      const note = applyActions(actionsToApply);
      if (note) onMessage(note);
    });
    const discard = document.createElement('button');
    discard.type = 'button'; discard.className = 'btn ghost'; discard.textContent = 'Discard';
    discard.addEventListener('click', clear);
    host.append(heading, list, apply, discard);
  }
  clear();
  return {propose, clear};
}
