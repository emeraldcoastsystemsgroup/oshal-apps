/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0, the Devices view: the rail of your phones and computers, the selected one's screen in a device frame and its controls. An Android phone's screen is read from the phone about every 1.5 s while this view is open and visible; a tap or drag on it, the keys, typing, opening an app and reading the words on screen each run one bridge command on the computer the phone is connected to. An iPhone takes keys, typing, apps by name and pointer steps from the Bluetooth keyboard; its screen cannot be shown. A computer shows its own picture and opens the kernel's page to work on it. Nothing is sent while Allow control is off.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: with no phone and no computer the Devices view is only the empty card and its one primary, Set up a computer; the empty phone frame and the history column stay hidden until there is something to show. The hint no longer says the list is on the left, which it is not on a phone.
 */

import { readFrame, tapPoint, swipeFromDrag, createQueue, workHref, computerStanding, phoneReachable } from '/api/phone-control/ui/computer-link.js';

const FRAME_GAP_MS = 1500;
const COMPUTER_FRAME_MS = 2000;
const ANDROID = { label: 'Android', short: 'A' };
const IPHONE = { label: 'iPhone', short: 'i' };

/** @description Mount the Devices view. @param {object} app The page. @returns {void} */
export function mountStage(app) {
  const $ = app.byId;
  const queue = createQueue();
  const view = { generation: 0, frame: null, pictureUrl: '', apps: [], computerTag: '', drag: null };

  const selectedPhone = () => (app.state.selected?.kind === 'phone' ? app.state.phones.find((p) => p.id === app.state.selected.id) || null : null);
  const selectedComputer = () => (app.state.selected?.kind === 'computer' ? app.computer(app.state.selected.id) : null);
  const status = (text) => { $('stageStatus').textContent = text; };

  function railItem(label, sub, tone, selected, onPick) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pc-rail-item${selected ? ' is-selected' : ''}`;
    button.setAttribute('aria-pressed', String(selected));
    const dot = document.createElement('span');
    dot.className = `pc-dot ${tone}`;
    const name = document.createElement('span');
    name.className = 'pc-rail-name';
    name.textContent = label;
    const small = document.createElement('small');
    small.textContent = sub;
    name.append(small);
    button.append(dot, name);
    button.addEventListener('click', onPick);
    item.append(button);
    return item;
  }

  function renderRail() {
    const phones = $('phoneRail');
    const computers = $('computerRail');
    phones.replaceChildren(...app.state.phones.map((phone) => {
      const report = app.state.reports.get(phone.computerNodeId)?.report || null;
      const reachable = phoneReachable(phone, report);
      const kind = phone.platform === 'android' ? ANDROID : IPHONE;
      const selected = app.state.selected?.kind === 'phone' && app.state.selected.id === phone.id;
      return railItem(phone.name, `${kind.label} · ${reachable ? 'connected' : 'last seen offline'}`, reachable ? 'tone-ok' : 'tone-warn',
        selected, () => select({ kind: 'phone', id: phone.id }));
    }));
    computers.replaceChildren(...app.state.computerList.map((computer) => {
      const standing = computerStanding(computer);
      const selected = app.state.selected?.kind === 'computer' && String(app.state.selected.id) === String(computer.id);
      return railItem(computer.name || `Computer ${String(computer.id).slice(0, 8)}`, standing.text, standing.tone, selected,
        () => select({ kind: 'computer', id: computer.id }));
    }));
    const any = Boolean(app.state.phones.length || app.state.computerList.length);
    $('railEmpty').hidden = any;
    // With nothing to show, the screen is the empty card and its one primary, not an empty phone frame.
    $('stageCard').hidden = !any;
    $('sideColumn').hidden = !any;
  }

  function select(choice) {
    app.state.selected = choice;
    view.generation += 1;
    view.frame = null;
    view.apps = [];
    view.computerTag = '';
    showPicture(null);
    renderStage();
    renderRail();
    void loadHistory();
    app.emit();
    const phone = selectedPhone();
    if (phone?.platform === 'android' && phone.controlEnabled) {
      void loadApps(phone, view.generation);
      void frameLoop(view.generation);
    }
    if (choice.kind === 'computer') void computerLoop(view.generation);
  }

  function showPicture(blob) {
    const image = $('screenImage');
    if (view.pictureUrl) URL.revokeObjectURL(view.pictureUrl);
    view.pictureUrl = blob ? URL.createObjectURL(blob) : '';
    image.hidden = !blob;
    if (blob) image.src = view.pictureUrl; else image.removeAttribute('src');
  }

  function setVisible(id, visible) { $(id).hidden = !visible; }

  function renderStage() {
    const phone = selectedPhone();
    const computer = selectedComputer();
    const frame = $('deviceFrame');
    frame.dataset.kind = phone ? phone.platform : computer ? 'computer' : 'none';
    setVisible('allowControlLabel', Boolean(phone));
    setVisible('controlBar', Boolean(phone));
    setVisible('typeForm', Boolean(phone));
    setVisible('openForm', Boolean(phone));
    setVisible('pointerPad', phone?.platform === 'ios');
    setVisible('screenTextCard', phone?.platform === 'android');
    setVisible('computerActions', Boolean(computer));
    for (const button of document.querySelectorAll('[data-android-only]')) button.hidden = phone?.platform !== 'android';
    for (const button of document.querySelectorAll('[data-ios-only]')) button.hidden = phone?.platform !== 'ios';
    if (phone) renderPhoneHead(phone);
    else if (computer) renderComputerHead(computer);
    else {
      $('stageTitle').textContent = 'Choose a device';
      $('stageSub').textContent = 'Choose a phone or a computer from your list.';
      $('screenNote').textContent = 'Choose a phone or a computer.';
    }
  }

  function renderPhoneHead(phone) {
    const host = app.computer(phone.computerNodeId);
    $('stageTitle').textContent = phone.name;
    $('stageSub').textContent = `${phone.platform === 'android' ? 'Android over Wi-Fi' : 'iPhone over Bluetooth'} · through ${host?.name || 'a computer that is not listed now'}`;
    $('allowControl').checked = phone.controlEnabled;
    $('askJarvis').href = workHref(phone.computerNodeId);
    $('screenNote').textContent = phone.platform === 'ios'
      ? "iPhone screens can't be shown here: Apple mirrors only to AirPlay receivers. Type, Home, Spotlight, apps and the pointer still work."
      : phone.controlEnabled ? 'Reading the phone’s screen…' : 'Allow control is off: nothing is sent to this phone.';
    $('appInput').placeholder = phone.platform === 'ios' ? 'App name, for example Notes' : 'App name or package';
  }

  function renderComputerHead(computer) {
    const standing = computerStanding(computer);
    $('stageTitle').textContent = computer.name || 'Computer';
    $('stageSub').textContent = `${computer.platform || 'computer'} · ${standing.text}`;
    $('workOnIt').href = workHref(computer.id);
    $('screenNote').textContent = standing.usable ? 'Waiting for the first picture…' : standing.text;
  }

  /** One bridge command for the selected phone, with its history line. */
  async function phoneCommand(phone, verb, args, action, summary, limitMs) {
    if (!phone.controlEnabled) { status('Allow control is off: nothing was sent.'); return null; }
    const host = app.computer(phone.computerNodeId);
    if (!computerStanding(host).usable) {
      status(`${host?.name || 'The computer this phone is connected to'} is not taking commands now: ${computerStanding(host).text}.`);
      return null;
    }
    let reply;
    try {
      reply = await app.computers.bridge(phone.computerNodeId, verb, args, limitMs);
    } catch (error) {
      reply = { ok: false, error: 'refused', message: error.message, exitCode: null };
    }
    if (action) {
      await app.remember({ computerNodeId: phone.computerNodeId, phoneId: phone.id, action, summary, ok: Boolean(reply.ok),
        exitCode: reply.exitCode ?? null, error: reply.ok ? null : reply.message || reply.error });
      void loadHistory();
    }
    return reply;
  }

  function press(action, summary, verb, args, after) {
    const phone = selectedPhone();
    if (!phone) return;
    status(`${summary}…`);
    void queue.press(async () => {
      const reply = await phoneCommand(phone, verb, { ...args, ...(phone.platform === 'android' ? { serial: phone.address } : {}) }, action, summary);
      if (!reply) return;
      status(reply.ok ? `${summary}: done.` : reply.message || 'It did not work.');
      if (reply.ok && after) after(reply);
    });
  }

  async function frameLoop(generation) {
    while (generation === view.generation) {
      const phone = selectedPhone();
      const visible = document.visibilityState === 'visible' && app.state.mode === 'devices';
      if (!phone || phone.platform !== 'android' || !phone.controlEnabled) return;
      if (visible) {
        const send = async (verb, args) => (await phoneCommand(phone, verb, args)) || { ok: false, message: $('stageStatus').textContent };
        const job = queue.refresh(() => readFrame(send, phone.address));
        if (job) {
          try {
            const frame = await job;
            if (generation !== view.generation) return;
            view.frame = frame;
            showPicture(new Blob([frame.bytes], { type: frame.mime }));
            $('screenNote').textContent = '';
            status(frame.slow ? 'This computer has no ffmpeg, so each picture is a full PNG and slow.' : '');
          } catch (error) {
            if (generation !== view.generation) return;
            $('screenNote').textContent = error.message;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS));
    }
  }

  async function computerLoop(generation) {
    while (generation === view.generation) {
      const computer = selectedComputer();
      if (!computer) return;
      if (document.visibilityState === 'visible' && app.state.mode === 'devices' && computerStanding(computer).usable) {
        try {
          const response = await app.computers.screen(computer.id, view.computerTag);
          if (generation !== view.generation) return;
          if (response.status === 200) {
            view.computerTag = response.headers.get('etag') || '';
            showPicture(await response.blob());
            $('screenNote').textContent = '';
          } else if (response.status === 404) {
            showPicture(null);
            $('screenNote').textContent = 'Waiting for a picture from that computer…';
          }
          else if (response.status !== 304) $('screenNote').textContent = `The screen could not be read (HTTP ${response.status}).`;
        } catch (error) {
          $('screenNote').textContent = `The screen could not be read: ${error.message}`;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, COMPUTER_FRAME_MS));
    }
  }

  async function loadApps(phone, generation) {
    const reply = await queue.press(() => phoneCommand(phone, 'adb-apps', { serial: phone.address }));
    if (generation !== view.generation || !reply?.ok) return;
    view.apps = reply.apps;
    $('appList').replaceChildren(...reply.apps.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.label = name.split('.').pop();
      return option;
    }));
  }

  function androidPackageFor(text) {
    const wanted = text.trim().toLowerCase();
    if (view.apps.includes(text.trim())) return text.trim();
    const squashed = wanted.replace(/\s+/g, '');
    return view.apps.find((name) => name.split('.').pop().toLowerCase() === squashed)
      || view.apps.find((name) => name.toLowerCase().includes(squashed)) || null;
  }

  function wireControls() {
    for (const button of document.querySelectorAll('.pc-key')) {
      button.addEventListener('click', () => {
        const phone = selectedPhone();
        if (!phone) return;
        if (phone.platform === 'android') press(`key ${button.dataset.key.toLowerCase()}`, button.textContent.trim(), 'adb-key', { key: button.dataset.key });
        else press(`key ${button.dataset.ios.toLowerCase()}`, button.textContent.trim(), 'ble-key', { key: button.dataset.ios });
      });
    }
    $('refreshScreen').addEventListener('click', () => {
      const phone = selectedPhone();
      if (phone?.platform === 'android') { view.generation += 1; void frameLoop(view.generation); }
    });
    $('typeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const phone = selectedPhone();
      const text = $('typeInput').value;
      if (!phone || !text) return;
      const verb = phone.platform === 'android' ? 'adb-text' : 'ble-type';
      press('type', `Type ${text.length} characters`, verb, { text }, () => { $('typeInput').value = ''; });
    });
    $('openForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const phone = selectedPhone();
      const name = $('appInput').value.trim();
      if (!phone || !name) return;
      if (phone.platform === 'ios') return press('open app', `Open ${name}`, 'ble-open', { name });
      const pkg = androidPackageFor(name);
      if (!pkg) return status(view.apps.length ? `No app on this phone matches ${name}.` : 'The phone’s apps have not been read yet.');
      return press('open app', `Open ${pkg}`, 'adb-launch', { package: pkg });
    });
    for (const button of document.querySelectorAll('.pc-move')) {
      button.addEventListener('click', () => press('pointer', `Move the pointer ${button.textContent.trim().toLowerCase()}`, 'ble-mouse',
        { dx: Number(button.dataset.dx), dy: Number(button.dataset.dy) }));
    }
    $('pointerClick').addEventListener('click', () => press('pointer', 'Click', 'ble-mouse', { dx: 0, dy: 0, click: true }));
    $('allowControl').addEventListener('change', () => void setControl($('allowControl').checked));
    $('readScreen').addEventListener('click', readScreen);
    wirePicture();
  }

  function wirePicture() {
    const image = $('screenImage');
    const local = (event) => { const box = image.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top, box }; };
    image.addEventListener('pointerdown', (event) => { view.drag = { ...local(event), at: performance.now() }; });
    image.addEventListener('pointerup', (event) => {
      const start = view.drag;
      view.drag = null;
      if (!start || !view.frame) return;
      const end = local(event);
      try {
        const swipe = swipeFromDrag(start, end, end.box, view.frame, performance.now() - start.at);
        if (swipe) return press('swipe', 'Swipe', 'adb-swipe', swipe);
        const point = tapPoint(end, end.box, view.frame);
        return press('tap', `Tap at ${point.x}, ${point.y}`, 'adb-tap', point);
      } catch (error) {
        return status(error.message);
      }
    });
  }

  async function setControl(enabled) {
    const phone = selectedPhone();
    if (!phone) return;
    try {
      const { device } = await app.records.updatePhone(phone.id, { controlEnabled: enabled });
      app.state.phones = app.state.phones.map((item) => (item.id === device.id ? device : item));
      select({ kind: 'phone', id: device.id });
      status(enabled ? 'Control is on.' : 'Control is off: nothing is sent to this phone.');
    } catch (error) {
      $('allowControl').checked = !enabled;
      status(`Allow control could not be saved: ${error.message}`);
    }
  }

  function readScreen() {
    const phone = selectedPhone();
    if (phone?.platform !== 'android') return;
    press('read screen', 'Read the screen', 'adb-ui', {}, (reply) => {
      const body = $('screenTextBody');
      if (!reply.items.length) {
        body.innerHTML = '<tr class="ks-empty-row"><td colspan="4">No words on this screen.</td></tr>';
        return;
      }
      body.replaceChildren(...reply.items.map((item) => {
        const row = document.createElement('tr');
        for (const value of [item.text, item.x, item.y]) {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          if (typeof value === 'number') cell.className = 'ks-num';
          row.append(cell);
        }
        const cell = document.createElement('td');
        const tap = document.createElement('button');
        tap.type = 'button';
        tap.className = 'ks-btn ks-btn-sm';
        tap.textContent = 'Tap';
        tap.addEventListener('click', () => press('tap', `Tap ${item.text}`, 'adb-tap', { x: item.x, y: item.y }));
        cell.append(tap);
        row.append(cell);
        return row;
      }));
      $('screenTextHelp').textContent = `${reply.items.length} on screen in ${reply.package || 'the current app'}${reply.truncated ? ' (the first ones only)' : ''}.`;
      app.refreshTables();
    });
  }

  async function loadHistory() {
    const phone = selectedPhone();
    const body = $('historyBody');
    try {
      const history = await app.records.history(phone?.id);
      if (!history.length) {
        body.innerHTML = '<tr class="ks-empty-row"><td colspan="4">Nothing sent yet.</td></tr>';
        return;
      }
      body.replaceChildren(...history.map((event) => {
        const row = document.createElement('tr');
        const cells = [new Date(event.createdAt).toLocaleString(), event.action, event.error ? `${event.summary}: ${event.error}` : event.summary];
        for (const value of cells) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
        const result = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = `ks-pill ${event.ok ? 'tone-ok' : 'tone-warn'}`;
        pill.textContent = event.ok ? 'Worked' : 'Failed';
        result.append(pill);
        row.append(result);
        return row;
      }));
      app.refreshTables();
    } catch (error) {
      body.innerHTML = '';
      status(`History could not be read: ${error.message}`);
    }
  }

  app.select = select;
  wireControls();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && selectedPhone()?.platform === 'android') { view.generation += 1; void frameLoop(view.generation); }
  });
  app.onChange(() => {
    renderRail();
    if (!app.state.selected) {
      const first = app.state.phones[0] ? { kind: 'phone', id: app.state.phones[0].id } : app.state.computerList[0] ? { kind: 'computer', id: app.state.computerList[0].id } : null;
      if (first) select(first);
    } else renderStage();
  });
}
