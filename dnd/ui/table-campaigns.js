/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add an explicit themed campaign shelf before party selection so a signed-in player chooses the story they intend to start.
 */

'use strict';

let selectedAdventureId = '';

/** @description Summarize authored chapter types without promising generated content. */
function adventureChapterSummary(adventure) {
  const scenes = adventure.scenes || [];
  const investigations = scenes.filter((scene) => scene.kind === 'exploration').length;
  const battles = scenes.length - investigations;
  return [
    investigations ? `${investigations} investigation${investigations === 1 ? '' : 's'}` : '',
    battles ? `${battles} battle${battles === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');
}

/** @description Render one campaign card with its genre, premise, and play shape. */
function adventureCard(adventure) {
  const theme = adventure.theme || {};
  const first = (adventure.scenes || [])[0] || {};
  const map = `${API}/art/map/${encodeURIComponent(first.id || '')}`;
  return `<article class="adventure-card" data-adventure="${esc(adventure.id)}">
    <div class="adventure-art" style="background-image:url('${map}')">
      <span>${esc(theme.label || 'Fantasy adventure')}</span>
    </div>
    <div class="adventure-copy"><h2>${esc(adventure.title)}</h2>
      <p>${esc(adventure.summary || '')}</p>
      <small>${esc(adventureChapterSummary(adventure))}</small>
      <button class="big" data-choose-adventure="${esc(adventure.id)}">Choose this campaign</button>
    </div>
  </article>`;
}

/** @description Open the adventure shelf without changing or auto-resuming any saved game. */
function showAdventureLibrary() {
  const adventures = content && content.adventures || [content.adventure];
  const cards = adventures.map(adventureCard).join('');
  overlay(`<h1>Choose a campaign</h1>
    <p>Each campaign is a separate saved table. Investigations remember shared clues; battles use the same visible turn, movement, action, dice, and rewind rules.</p>
    <div class="adventure-grid">${cards}</div>
    <div class="library-actions"><button class="big ghost" id="adventureBack">Back to My Games</button></div>`,
  'adventure-library');
  document.querySelectorAll('[data-choose-adventure]').forEach((button) => {
    button.onclick = () => {
      selectedAdventureId = button.dataset.chooseAdventure;
      activateAdventure(selectedAdventureId);
      showPartyBuilder();
    };
  });
  $('adventureBack').onclick = () => void showGameMenu();
}

/** @description Keep selected adventure identity explicit when a fresh-game path resets. */
function resetAdventureSelection() {
  selectedAdventureId = '';
  activateAdventure(content && content.adventure && content.adventure.id);
}
