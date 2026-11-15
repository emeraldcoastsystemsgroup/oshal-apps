/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Calendar's event view (calendar 1.4.0; Roger, 2026-11-14: "can't cancel or modify existing
 *   meeting", and every tool the assistant has, the screen has too). Opening an event shows its time, place, notes and, for a
 *   Google Calendar meeting read fresh, its guests, organizer and how it repeats, with Edit and Cancel meeting (Decline for a
 *   meeting the person was invited to), as the leading calendar products do: Edit opens the same form as a new event; Cancel
 *   asks in the page first; a meeting with guests asks whether to tell them (Don't tell them / Tell them); a repeating one asks
 *   this meeting or all meetings in the series. The writes are the same routes the assistant's approved cards use.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the view says "In your Open Swarm calendar" and the cancel question "It comes off your Open Swarm
 *   calendar." (Roger, 2026-11-13: what a person sees names the product Open Swarm; the "source" value and the path keep oshal). * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the agenda also lists events of the person's other Google calendars (Roger, 2026-11-15: "i would
 *   think it would have a combination of calendars"). Such an event's view says which calendar it is on and that it is changed in
 *   Google Calendar, with a link there; Edit and Cancel meeting stay for the primary calendar and Open Swarm, where the routes act.
 */

/** The asks a change or a cancellation needs for a Google meeting: which occurrences, and whether its guests are told. */
async function googleAsks(ctx, meeting, verb) {
  let appliesTo;
  if (meeting.repeating) {
    const which = await ctx.choose({ title: `${verb} a repeating meeting`, text: `“${meeting.title}” repeats ${meeting.repeating}.`,
      choices: [{ label: 'This meeting', value: 'This one only' }, { label: 'All meetings in the series', value: 'The whole series', primary: true }] });
    if (!which) return null;
    appliesTo = which;
  }
  let guests = 'None';
  if (meeting.guests.length) {
    const names = meeting.guests.map((g) => g.name).join(', '), has = meeting.guests.length === 1 ? 'has' : 'have';
    const ask = verb === 'Cancel'
      ? { title: `Cancel “${meeting.title}”?`, text: `${names} ${has} this meeting on their calendar. Tell them it is cancelled?`, dismiss: 'Keep it',
        choices: [{ label: "Cancel, don't tell them", value: 'Will not be told', destructive: true }, { label: 'Cancel and tell them', value: 'Will be told', destructive: true }] }
      : { title: 'Tell the guests?', text: `${names} ${has} this meeting on their calendar. Tell them about the change?`,
        choices: [{ label: "Don't tell them", value: 'Will not be told' }, { label: 'Tell them', value: 'Will be told', primary: true }] };
    const told = await ctx.choose(ask);
    if (!told) return null;
    guests = told;
  }
  return { appliesTo, guests };
}

/** The view's lines: when, where, notes, and for Google its organizer, guests and repeat. */
function details(ctx, ev, meeting) {
  const lines = [ctx.element('p', ctx.clockOf(ev), 'calendar-view-when')];
  const add = (text, cls) => { if (text) lines.push(ctx.element('p', text, cls || 'calendar-view-line')); };
  add(meeting?.repeating ? `Repeats ${meeting.repeating}` : '');
  add(ev.location || meeting?.location);
  add(ev.notes || meeting?.notes, 'calendar-view-notes');
  if (meeting && meeting.you === 'invited') add(`Organized by ${meeting.organizer}`);
  if (meeting?.guests?.length) add(`Guests: ${meeting.guests.map((g) => `${g.name} (${g.answer})`).join(', ')}`);
  add(ev.source === 'oshal' ? 'In your Open Swarm calendar' : ev.calendar ? `In your Google Calendar: ${ev.calendar}` : 'In your Google Calendar', 'calendar-meta');
  return lines;
}

/**
 * @description Open one event of the agenda: its details, Edit and Cancel meeting (or Decline). A Google meeting is read fresh
 * first, so its guests and revision are current; until then, and when it cannot be read, its actions stay hidden.
 * @param {Document} doc - The page.
 * @param {object} ev - The agenda event (source, id, title, start, end, allDay, location, notes, url, revision).
 * @param {object} ctx - The workspace's helpers: zone, element, clockOf, request, choose, confirm, layer, edit, done, refresh.
 * @returns {Promise<void>} Once the view is open.
 */
export async function openEventView(doc, ev, ctx) {
  const dialog = ctx.element('dialog', null, 'calendar-confirm calendar-view'), head = ctx.element('div', null, 'calendar-sheet-head'), title = ctx.element('h2', ev.title);
  const close = ctx.element('button', 'Close', 'calendar-tertiary'), body = ctx.element('div', null, 'calendar-view-body'), actions = ctx.element('div', null, 'calendar-confirm-actions calendar-view-actions');
  close.type = 'button'; title.id = `calendar-view-${Math.random().toString(36).slice(2)}`;
  dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('data-no-glass', ''); dialog.setAttribute('data-ds-sheet', '');
  head.append(title, close); dialog.append(head, body, actions); doc.body.append(dialog);
  const history = ctx.layer({ isOpen: () => dialog.open, close: () => shut(true) });
  function shut(fromBack = false) { if (dialog.open) dialog.close(); dialog.remove(); return fromBack ? Promise.resolve() : history.closed(); }
  close.onclick = () => shut(); dialog.addEventListener('cancel', (e) => { e.preventDefault(); shut(); }); dialog.addEventListener('click', (e) => { if (e.target === dialog) shut(); });
  body.replaceChildren(...details(ctx, ev, null));
  dialog.showModal(); history.opened(); close.focus({ preventScroll: true });
  let meeting = null;
  if (ev.source === 'google' && ev.calendar) { otherCalendar(ctx, body, ev); return; }
  if (ev.source === 'google') {
    const status = ctx.element('p', 'Reading it from Google Calendar…', 'calendar-meta'); body.append(status);
    try { meeting = (await ctx.request(`/meetings/google/${encodeURIComponent(ev.id)}?${new URLSearchParams({ timeZone: ctx.zone })}`)).meeting; }
    catch (e) { status.textContent = e.message; return; }
    title.textContent = meeting.title; body.replaceChildren(...details(ctx, { ...ev, title: meeting.title, location: meeting.location, notes: meeting.notes }, meeting));
  }
  const button = (label, cls, run) => { const b = ctx.element('button', label, cls); b.type = 'button'; b.onclick = async () => { await shut(); run(); }; actions.append(b); return b; };
  const mine = !meeting || meeting.you === 'organizer';
  if (!meeting || meeting.canChange) button('Edit', '', () => ctx.edit(ev, meeting));
  if (mine) button('Cancel meeting', 'calendar-destructive', () => cancelMeeting(ctx, ev, meeting));
  else button('Decline', 'calendar-destructive', () => declineMeeting(ctx, ev, meeting));
}

/** An event of another Google calendar: where it is changed, and a link to it there. */
function otherCalendar(ctx, body, ev) {
  body.append(ctx.element('p', `To change it, open it in Google Calendar. Calendar Preparation changes events on your primary calendar and in Open Swarm.`, 'calendar-meta'));
  try {
    const url = new URL(ev.url);
    if (url.protocol === 'https:' && /^(calendar|www)\.google\.com$/.test(url.hostname) && !url.username && !url.password) {
      const a = ctx.element('a', 'Open in Google Calendar'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener'; body.append(a);
    }
  } catch (_) { /* no link to offer */ }
}

/** Cancel an OSHAL event or a Google meeting, after the page asks; the answer offers Undo where it can be put back. */
async function cancelMeeting(ctx, ev, meeting) {
  const when = ctx.clockOf(ev);
  if (!meeting) {
    if (!await ctx.confirm({ title: `Cancel “${ev.title}”?`, text: `${when}. It comes off your Open Swarm calendar.`, action: 'Cancel meeting', dismiss: 'Keep it', destructive: true })) return;
    const out = await ctx.run(() => ctx.request(`/meetings/oshal/${encodeURIComponent(ev.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ev.title, start: ev.start, timeZone: ctx.zone }) }));
    if (out) ctx.done('Meeting cancelled.', () => ctx.request('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.undo) }), 'Meeting put back.');
    return;
  }
  const asks = meeting.repeating || meeting.guests.length ? await googleAsks(ctx, meeting, 'Cancel') : { guests: 'None' };
  if (!asks) return;
  if (!meeting.guests.length && !await ctx.confirm({ title: `Cancel “${meeting.title}”?`, text: `${when}. It comes off your Google Calendar.`, action: 'Cancel meeting', dismiss: 'Keep it', destructive: true })) return;
  const out = await ctx.run(() => ctx.request('/meetings/google/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: meeting.revision, title: meeting.title, start: meeting.start, timeZone: ctx.zone, guests: asks.guests, ...(asks.appliesTo ? { appliesTo: asks.appliesTo } : {}), confirm: true }) }));
  if (!out) return;
  if (out.undo) ctx.done('Meeting cancelled.', () => ctx.request('/google-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.undo) }), 'Meeting put back.');
  else ctx.done(out.where || 'Meeting cancelled.');
}

/** Decline a Google invitation, after the page asks whether its organizer is told. */
async function declineMeeting(ctx, ev, meeting) {
  const told = await ctx.choose({ title: `Decline “${meeting.title}”?`, text: `${ctx.clockOf(ev)}. It stays on ${meeting.organizer}'s calendar.`,
    choices: [{ label: `Decline without telling ${meeting.organizer}`, value: 'Will not be told' }, { label: `Decline and tell ${meeting.organizer}`, value: 'Will be told', primary: true }] });
  if (!told) return;
  let appliesTo;
  if (meeting.repeating) {
    appliesTo = await ctx.choose({ title: 'Decline a repeating meeting', text: `“${meeting.title}” repeats ${meeting.repeating}.`, choices: [{ label: 'This meeting', value: 'This one only' }, { label: 'All meetings in the series', value: 'The whole series', primary: true }] });
    if (!appliesTo) return;
  }
  const out = await ctx.run(() => ctx.request('/meetings/google/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: meeting.revision, title: meeting.title, start: meeting.start, timeZone: ctx.zone, organizer: told, ...(appliesTo ? { appliesTo } : {}), confirm: true }) }));
  if (out) ctx.done('Invitation declined.');
}

/**
 * @description The body of a change from the edit form: only the fields the person changed, with the meeting named as it was.
 * @param {object} ev - The agenda event.
 * @param {object|null} meeting - The Google meeting read fresh, or null for an OSHAL event.
 * @param {{title:string,start:string,end:string|undefined,allDay:boolean,location:string,notes:string}} was - The form as it opened.
 * @param {{title:string,start:string,end:string|undefined,allDay:boolean,location:string,notes:string}} now - The form as saved.
 * @param {string} zone - The person's zone.
 * @returns {object|null} The request body, or null when nothing changed.
 */
export function changeBody(ev, meeting, was, now, zone) {
  const body = { title: meeting ? meeting.title : ev.title, start: meeting ? meeting.start : ev.start, timeZone: zone, confirm: true };
  if (meeting) body.revision = meeting.revision; else { body.id = ev.id; body.revision = ev.revision; }
  if (now.title !== was.title) body.newTitle = now.title;
  if (now.start !== was.start || now.allDay !== was.allDay) body.newStart = now.start;
  if (now.end && (now.end !== was.end || now.allDay !== was.allDay)) body.newEnd = now.end;
  if (now.location !== was.location) body.newLocation = now.location;
  if (now.notes !== was.notes) body.newNotes = now.notes;
  return Object.keys(body).some((k) => k.startsWith('new')) ? body : null;
}

/** Save an edit: the asks a Google meeting needs, then the change; the answer offers Undo. */
export async function saveChange(ctx, ev, meeting, body) {
  if (meeting) {
    const asks = await googleAsks(ctx, meeting, 'Change');
    if (!asks) return false;
    Object.assign(body, { guests: asks.guests }, asks.appliesTo ? { appliesTo: asks.appliesTo } : {});
  }
  const path = meeting ? '/meetings/google' : `/meetings/oshal/${encodeURIComponent(ev.id)}`;
  const out = await ctx.request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const undo = out.undo ? () => ctx.request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.undo) }) : null;
  ctx.done(out.already ? 'That change was already saved.' : 'Meeting changed.', undo, 'Change undone.');
  return true;
}
