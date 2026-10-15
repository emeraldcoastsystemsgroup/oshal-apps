/** Guide edits are proposals against the exact draft the model read. */
export function draftSnapshot({kind, title, outline, theme}) {
  return JSON.stringify([kind, title, outline, theme]);
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
        action.op === 'update_slide' ? `${action.bullets ? 'Replace body of' : 'Update heading of'} section ${action.index}: ${action.title || ''} ${(action.bullets || []).join(' · ')}` :
        action.op === 'add_slide' ? `Add section: ${action.title || ''}\n${(action.bullets || []).join('\n')}` :
        action.op === 'set_title' ? `Title: ${action.title}` : `Theme: ${action.theme}`;
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
