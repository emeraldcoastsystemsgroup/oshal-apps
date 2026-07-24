/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 23:30:56 | roger.murphy@emeraldcoastsystemsgroup.com  | Add a full-surface character, inventory, potential, and current-resource view with explicit spell-slot availability.
 */

'use strict';

function inventoryOf(sheet) {
  if (!sheet) return { items: [], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
  const raw = sheet.inventory || {};
  const items = (Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []))
    .map((item, i) => typeof item === 'string'
      ? { id: `item-${i}`, name: item, category: 'gear', quantity: 1, equipped: false }
      : { ...item, quantity: Math.max(1, Number(item.quantity) || 1) });
  (sheet.actions || []).filter((action) => action.type === 'weapon').forEach((action) => {
    const recorded = items.some((item) => item.actionId === action.id
      || String(item.name).toLowerCase() === String(action.name).toLowerCase());
    if (!recorded) items.push({
      id: `action-${action.id}`, name: action.name, category: 'weapon',
      quantity: 1, equipped: true, actionId: action.id, looted: !!action.looted,
    });
  });
  const coins = (!Array.isArray(raw) && raw.coins) || sheet.coins || {};
  return {
    items,
    coins: Object.fromEntries(['cp', 'sp', 'ep', 'gp', 'pp']
      .map((key) => [key, Number(coins[key]) || 0])),
  };
}

function actionResourceStatus(token, action) {
  if (!action || action.type !== 'spell' || !action.slot) {
    const detail = action && action.type === 'spell' ? 'Cantrip · unlimited' : 'At will';
    return { available: true, label: 'READY', detail };
  }
  const level = String(action.slot), remaining = Number(token && token.slots && token.slots[level]) || 0;
  return remaining > 0
    ? { available: true, label: 'READY', detail: `${remaining} level-${level} slot${remaining === 1 ? '' : 's'} remaining` }
    : { available: false, label: 'SPENT', detail: `No level-${level} slots remaining` };
}

function spellSlotRows(token, sheet) {
  const levels = [...new Set(Object.keys(sheet.slots || {}).concat(Object.keys(token.slots || {})))]
    .sort((a, b) => Number(a) - Number(b));
  if (!levels.length) return '<span class="slot-meter none"><b>No spell slots</b><small>Cantrips remain unlimited.</small></span>';
  return levels.map((level) => {
    const current = Number(token.slots && token.slots[level]) || 0;
    const maximum = Math.max(current, Number(sheet.slots && sheet.slots[level]) || 0);
    return `<span class="slot-meter ${current ? 'ready' : 'spent'}"><b>Level ${esc(level)}</b><strong>${current} / ${maximum}</strong><small>${current ? 'available now' : 'spent until recovery'}</small></span>`;
  }).join('');
}

function characterActionCard(token, action) {
  const state = actionResourceStatus(token, action);
  const range = action.delivery === 'melee' ? 'melee'
    : action.delivery === 'self' ? 'self' : `${Number(action.range) || 0} ft`;
  return `<article class="character-action ${state.available ? 'ready' : 'spent'}">
    <header><b>${action.type === 'spell' ? '✦' : action.type === 'feature' ? '★' : '⚔'} ${esc(action.name)}</b><span>${state.label}</span></header>
    <p>${esc(effectStr(action))}</p>
    <small>${esc(range)}${action.slot ? ` · Level ${action.slot}` : ''} · ${esc(state.detail)}</small>
    ${action.text ? `<em>${esc(action.text)}</em>` : ''}
  </article>`;
}

function characterInventoryRows(inventory, actions) {
  if (!inventory.items.length) return '<p class="empty-pack">Nothing recorded in this pack yet.</p>';
  return inventory.items.map((item) => {
    const action = item.actionId && actions.find((candidate) => candidate.id === item.actionId);
    const detail = action ? effectStr(action) : (item.notes || item.description || item.category || 'gear');
    const icon = item.category === 'weapon' ? '⚔' : item.category === 'armor' ? '🛡'
      : item.category === 'tool' ? '🧰' : item.category === 'consumable' ? '🧪' : '◆';
    return `<div class="inventory-item"><span class="item-icon">${icon}</span><span><b>${esc(item.name)}</b><small>${item.quantity > 1 ? `×${item.quantity} · ` : ''}${item.equipped ? 'equipped · ' : ''}${esc(detail)}</small></span></div>`;
  }).join('');
}

function showCharacterSheet(token) {
  if (!token || token.kind !== 'pc') return;
  const sheet = boardSheets[token.slug] || sheetOf(token) || {};
  const inventory = inventoryOf(sheet), actions = sheet.actions || [];
  const ready = actions.filter((action) => actionResourceStatus(token, action).available);
  const abilities = sheet.abilities ? ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((key) =>
    `<span><small>${key.toUpperCase()}</small><b>${sheet.abilities[key]}</b><em>${(sheet.mods && sheet.mods[key] >= 0 ? '+' : '') + ((sheet.mods && sheet.mods[key]) || 0)}</em></span>`).join('') : '';
  const features = (sheet.features || []).map((feature) => `<li>${esc(feature)}</li>`).join('') || '<li>No features recorded.</li>';
  const coins = ['pp', 'gp', 'ep', 'sp', 'cp'].filter((key) => inventory.coins[key])
    .map((key) => `<span><b>${inventory.coins[key]}</b> ${key.toUpperCase()}</span>`).join('') || '<span>no coin</span>';
  const saves = deathSaveScore(token);
  const condition = isDowned(token) ? `<span>☠ <b>${token.stable ? 'STABLE' : `DOWN · S${saves.successes}/F${saves.failures}`}</b></span>`
    : token.dead ? '<span>☠ <b>FALLEN</b></span>' : '<span class="alive"><b>ALIVE</b></span>';
  overlay(`<div class="sheet-head"><span class="sheet-portrait" style="background-image:url('${API}/art/token/${encodeURIComponent(token.slug)}')"></span><div><div class="sheet-kicker">Full character · current resources · inventory</div><h1>${esc(sheet.name || token.name)}</h1><p>${esc(`${sheet.race || ''} ${sheet.class || ''}`.trim())} · Level ${Number(sheet.level) || 1}</p></div></div>
    <div class="character-sheet-scroll">
      <section class="sheet-section character-now"><h2>Available right now <small>${ready.length} of ${actions.length} actions ready</small></h2>
        <div class="sheet-vitals"><span>❤ <b>${token.hp}/${token.maxHp}</b> HP</span>${condition}<span>🛡 <b>${token.ac}</b> AC</span><span>👟 <b>${token.speed}</b> ft</span></div>
        <div class="slot-grid">${spellSlotRows(token, sheet)}</div>
        <div class="character-action-grid ready-now">${ready.map((action) => characterActionCard(token, action)).join('') || '<p>No actions currently available.</p>'}</div>
      </section>
      ${abilities ? `<section class="sheet-section"><h2>Ability scores</h2><div class="ability-grid">${abilities}</div></section>` : ''}
      <section class="sheet-section"><h2>Full potential <small>Known abilities, including spent resources</small></h2><div class="character-action-grid">${actions.map((action) => characterActionCard(token, action)).join('')}</div></section>
      <section class="sheet-section"><h2>🎒 Actual inventory <small>${inventory.items.length} kinds of gear</small></h2><div class="inventory-grid">${characterInventoryRows(inventory, actions)}</div><div class="coins">${coins}</div></section>
      <section class="sheet-section"><h2>★ Features</h2><ul>${features}</ul></section>
    </div>
    <button class="big character-close" id="sheetClose">Back to the table</button>`, 'character-sheet');
  $('overlayCard').classList.add('character-full');
  $('sheetClose').onclick = closeOverlay;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { actionResourceStatus, inventoryOf, spellSlotRows };
}
