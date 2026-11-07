/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | OSHAL Audio Studio multitrack workbench controller, Web Audio DSP graph, surface bridge, and revision-locked concierge integration.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Wire real CAS stem WAV reload, full 5-stage channel strip persistence, stereo Web Audio playback, file import, slice/loop/filler tools, Kokoro TTS, mic capture, and Cockpit concierge handoff.
 */
'use strict';

(function () {
  const StudioState = {
    audioCtx: null,
    sampleRate: 48000,
    isPlaying: false,
    startTime: 0,
    pauseOffset: 0,
    playheadSec: 0,
    animFrameId: null,
    masterGainDb: 0.0,
    targetLufs: -14.0,
    tempo: 120,
    tracks: [],
    selectedTrackIdx: 0,
    activeSourceNodes: [],
    currentProject: null,
    projects: [],
    isDirty: false,
    isRecording: false,
    mediaRecorder: null,
    recordedChunks: [],
  };

  const el = (id) => document.getElementById(id);

  function setStatus(message, isError = false) {
    const node = el('status');
    if (!node) return;
    node.textContent = message || '';
    node.className = isError ? 'status error' : 'status';
  }

  function ensureAudioContext() {
    if (!StudioState.audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) StudioState.audioCtx = new Ctor({ sampleRate: StudioState.sampleRate });
    }
    if (StudioState.audioCtx && StudioState.audioCtx.state === 'suspended') {
      StudioState.audioCtx.resume().catch(() => {});
    }
    return StudioState.audioCtx;
  }

  function createTrackObject(name, role, leftPcm, sampleRate, rightPcm = null) {
    const sr = sampleRate || StudioState.sampleRate;
    const rawL = new Float32Array(leftPcm);
    const rawR = rightPcm ? new Float32Array(rightPcm) : new Float32Array(rawL);
    const track = {
      id: 'local_' + Math.random().toString(36).slice(2, 10),
      persisted: false,
      blobHash: null,
      name: name || 'Audio Stem',
      role: role || 'vocals',
      sampleRate: sr,
      rawPcm: rawL,
      rawPcmRight: rawR,
      processedLeft: new Float32Array(rawL),
      processedRight: new Float32Array(rawR),
      peaks: window.DSPEngine.computeWaveformPeaks(rawL, 220),
      gainDb: 0.0,
      pan: 0.0,
      muted: false,
      solo: false,
      hpf: role === 'vocals',
      ducking: role === 'bass',
      eqLowDb: 0.0,
      eqMidDb: 0.0,
      eqHighDb: 0.0,
      compRatio: 2.5,
      reverbMix: 0.08,
      distortionMode: 'bypass',
      driveDb: 0.0,
    };
    recomputeTrackDsp(track);
    return track;
  }

  function recomputeTrackDsp(track) {
    if (!window.DSPEngine || !track) return;
    const sr = track.sampleRate || StudioState.sampleRate;
    const strip = window.DSPEngine.processStemChannel([track.rawPcm, track.rawPcmRight || track.rawPcm], sr, track);
    track.processedLeft = strip.left;
    track.processedRight = strip.right;
    track.peaks = window.DSPEngine.computeWaveformPeaks(strip.monoTrigger, 220);
  }

  function renderStereoMix() {
    const entries = StudioState.tracks.map((t) => ({
      id: t.id,
      sampleRate: t.sampleRate || StudioState.sampleRate,
      channels: [t.rawPcm, t.rawPcmRight || t.rawPcm],
      config: t,
    }));
    if (entries.length === 0) {
      const empty = new Float32Array(StudioState.sampleRate);
      return { left: empty, right: empty, lufsIntegrated: -60, durationSeconds: 1 };
    }
    return window.DSPEngine.renderMultitrackMixdown(entries, StudioState.sampleRate, {
      masterGainDb: StudioState.masterGainDb,
      targetLufs: StudioState.targetLufs,
      normalize: false,
    });
  }

  function updateMasterLufsMeter() {
    if (!window.DSPEngine || StudioState.tracks.length === 0) return;
    const mix = renderStereoMix();
    const lufs = Number.isFinite(mix.lufsIntegrated) ? Math.max(-60, mix.lufsIntegrated) : -24;
    if (el('master-lufs-value')) el('master-lufs-value').textContent = `${lufs.toFixed(1)} LUFS`;
    if (el('master-lufs-fill')) {
      const pct = Math.max(5, Math.min(100, ((lufs + 48) / 48) * 100));
      el('master-lufs-fill').style.width = `${pct.toFixed(0)}%`;
    }
  }

  function renderStemsSummaryTable() {
    const tbody = el('stems-tbody');
    if (el('track-count-badge')) el('track-count-badge').textContent = `${StudioState.tracks.length} stems`;
    if (!tbody) return;
    tbody.innerHTML = '';
    StudioState.tracks.forEach((t, idx) => {
      const tr = document.createElement('tr');
      if (idx === StudioState.selectedTrackIdx) tr.className = 'active';
      tr.innerHTML = `<td>${t.name}</td><td>${t.role}</td><td class="num">${Number(t.gainDb || 0).toFixed(1)}</td><td class="num">${Number(t.pan || 0).toFixed(2)}</td><td class="num">${Number(t.eqLowDb || 0).toFixed(1)} / ${Number(t.eqMidDb || 0).toFixed(1)} / ${Number(t.eqHighDb || 0).toFixed(1)}</td>`;
      tr.addEventListener('click', () => selectTrackIndex(idx));
      tbody.appendChild(tr);
    });
  }

  function selectTrackIndex(idx) {
    StudioState.selectedTrackIdx = Math.max(0, Math.min(idx, StudioState.tracks.length - 1));
    syncChannelStripFromSelectedTrack();
    renderTracksDom();
  }

  function buildTrackCardDom(track, idx) {
    const card = document.createElement('div');
    card.className = 'track-card' + (idx === StudioState.selectedTrackIdx ? ' selected' : '');
    const roleKey = String(track.role || track.name || idx).toLowerCase();
    card.innerHTML = `
      <div class="track-head">
        <span class="track-title">${idx + 1}. ${track.name} (${track.role})</span>
        <div class="track-controls-inline">
          <label class="check-label">dB <input type="number" class="trk-gain" step="0.5" value="${Number(track.gainDb || 0).toFixed(1)}" data-bridge-field="track:${roleKey}:gainDb"></label>
          <label class="check-label">Pan <input type="number" class="trk-pan" step="0.05" min="-1" max="1" value="${Number(track.pan || 0).toFixed(2)}" data-bridge-field="track:${roleKey}:pan"></label>
          <input type="hidden" class="trk-eq-low" value="${Number(track.eqLowDb || 0)}" data-bridge-field="track:${roleKey}:eqLowDb">
          <input type="hidden" class="trk-eq-mid" value="${Number(track.eqMidDb || 0)}" data-bridge-field="track:${roleKey}:eqMidDb">
          <input type="hidden" class="trk-eq-high" value="${Number(track.eqHighDb || 0)}" data-bridge-field="track:${roleKey}:eqHighDb">
          <input type="hidden" class="trk-comp-ratio" value="${Number(track.compRatio || 2.5)}" data-bridge-field="track:${roleKey}:compRatio">
          <input type="hidden" class="trk-reverb-mix" value="${Number(track.reverbMix || 0.08)}" data-bridge-field="track:${roleKey}:reverbMix">
          <label class="check-label"><input type="checkbox" class="trk-duck" ${track.ducking ? 'checked' : ''} data-bridge-field="track:${roleKey}:ducking"> Duck</label>
          <button type="button" class="btn ghost btn-select-trk">Strip</button>
          <button type="button" class="btn danger btn-remove-trk">Remove</button>
        </div>
      </div>
      <canvas class="track-waveform" width="760" height="72"></canvas>
    `;
    bindTrackCardEvents(card, track, idx);
    window.AudioUIHelpers.drawTrackWaveform(card.querySelector('canvas'), track, StudioState.playheadSec);
    return card;
  }

  function bindTrackCardEvents(card, track, idx) {
    card.querySelector('.btn-select-trk').addEventListener('click', () => {
      selectTrackIndex(idx);
      setMobilePane('right');
    });
    card.querySelector('.btn-remove-trk').addEventListener('click', () => {
      StudioState.tracks.splice(idx, 1);
      StudioState.isDirty = true;
      selectTrackIndex(StudioState.selectedTrackIdx);
    });
    card.querySelector('.trk-gain').addEventListener('change', (e) => {
      track.gainDb = Number(e.target.value) || 0;
      recomputeTrackDsp(track);
      StudioState.isDirty = true;
      renderTracksDom();
      syncChannelStripFromSelectedTrack();
    });
    card.querySelector('.trk-pan').addEventListener('change', (e) => {
      track.pan = Math.max(-1, Math.min(1, Number(e.target.value) || 0));
      recomputeTrackDsp(track);
      StudioState.isDirty = true;
      renderStemsSummaryTable();
      syncChannelStripFromSelectedTrack();
    });
    card.querySelector('.trk-duck').addEventListener('change', (e) => {
      track.ducking = Boolean(e.target.checked);
      StudioState.isDirty = true;
      syncChannelStripFromSelectedTrack();
      updateMasterLufsMeter();
    });
    const canvas = card.querySelector('canvas');
    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const dur = (track.processedLeft?.length || 0) / (track.sampleRate || StudioState.sampleRate);
      StudioState.pauseOffset = ratio * dur;
      StudioState.playheadSec = StudioState.pauseOffset;
      formatTimecode(StudioState.playheadSec);
      renderTracksDom();
    });
  }

  function renderTracksDom() {
    const container = el('track-list');
    if (!container) return;
    container.innerHTML = '';
    StudioState.tracks.forEach((track, idx) => container.appendChild(buildTrackCardDom(track, idx)));
    renderStemsSummaryTable();
    updateMasterLufsMeter();
  }

  function syncChannelStripFromSelectedTrack() {
    const track = StudioState.tracks[StudioState.selectedTrackIdx];
    if (!track) {
      if (el('selected-track-label')) el('selected-track-label').textContent = 'None';
      return;
    }
    if (el('selected-track-label')) el('selected-track-label').textContent = `${track.name} (${track.role})`;
    const fields = [
      ['strip-gain-db', track.gainDb ?? 0], ['strip-pan', track.pan ?? 0],
      ['strip-eq-low', track.eqLowDb ?? 0], ['strip-eq-mid', track.eqMidDb ?? 0], ['strip-eq-high', track.eqHighDb ?? 0],
      ['strip-comp-ratio', track.compRatio ?? 2.5], ['strip-reverb-mix', track.reverbMix ?? 0.08],
      ['strip-distortion-mode', track.distortionMode || 'bypass'], ['strip-drive-db', track.driveDb ?? 0],
    ];
    for (const [id, val] of fields) { if (el(id)) el(id).value = String(val); }
    for (const [id, flag] of [['strip-hpf', track.hpf], ['strip-ducking', track.ducking], ['strip-mute', track.muted], ['strip-solo', track.solo]]) {
      if (el(id)) el(id).checked = Boolean(flag);
    }
  }

  function applyChannelStripEdits() {
    const track = StudioState.tracks[StudioState.selectedTrackIdx];
    if (!track) return;
    track.gainDb = Number(el('strip-gain-db')?.value) || 0;
    track.pan = Math.max(-1, Math.min(1, Number(el('strip-pan')?.value) || 0));
    track.eqLowDb = Number(el('strip-eq-low')?.value) || 0;
    track.eqMidDb = Number(el('strip-eq-mid')?.value) || 0;
    track.eqHighDb = Number(el('strip-eq-high')?.value) || 0;
    track.compRatio = Math.max(1, Number(el('strip-comp-ratio')?.value) || 2.5);
    track.reverbMix = Math.max(0, Math.min(1, Number(el('strip-reverb-mix')?.value) || 0.08));
    track.distortionMode = el('strip-distortion-mode')?.value || 'bypass';
    track.driveDb = Math.max(0, Number(el('strip-drive-db')?.value) || 0);
    track.hpf = Boolean(el('strip-hpf')?.checked);
    track.ducking = Boolean(el('strip-ducking')?.checked);
    track.muted = Boolean(el('strip-mute')?.checked);
    track.solo = Boolean(el('strip-solo')?.checked);
    recomputeTrackDsp(track);
    StudioState.isDirty = true;
    renderTracksDom();
  }

  function formatTimecode(sec) {
    const mins = String(Math.floor(sec / 60)).padStart(2, '0');
    const secs = (sec % 60).toFixed(3).padStart(6, '0');
    if (el('timecode')) el('timecode').textContent = `${mins}:${secs}`;
  }

  function startPlayback() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    stopPlayback(false);
    const mix = renderStereoMix();
    const audioBuf = ctx.createBuffer(2, mix.left.length, StudioState.sampleRate);
    audioBuf.getChannelData(0).set(mix.left);
    audioBuf.getChannelData(1).set(mix.right);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    const offset = Math.min(StudioState.pauseOffset, Math.max(0, audioBuf.duration - 0.05));
    src.start(0, offset);
    StudioState.startTime = ctx.currentTime - offset;
    StudioState.isPlaying = true;
    StudioState.activeSourceNodes.push(src);
    src.onended = () => { if (StudioState.isPlaying) stopPlayback(true); };
    tickPlayhead();
  }

  function stopPlayback(resetOffset = true) {
    StudioState.activeSourceNodes.forEach((n) => { try { n.stop(); } catch {} });
    StudioState.activeSourceNodes = [];
    StudioState.isPlaying = false;
    if (StudioState.animFrameId) cancelAnimationFrame(StudioState.animFrameId);
    if (resetOffset) {
      StudioState.pauseOffset = 0;
      StudioState.playheadSec = 0;
      formatTimecode(0);
    }
  }

  function tickPlayhead() {
    if (!StudioState.isPlaying || !StudioState.audioCtx) return;
    StudioState.playheadSec = StudioState.audioCtx.currentTime - StudioState.startTime;
    formatTimecode(StudioState.playheadSec);
    StudioState.animFrameId = requestAnimationFrame(tickPlayhead);
  }

  function loadDefaultArrangement() {
    const sr = StudioState.sampleRate;
    const rock = window.DSPEngine.generateRockSongStems(6.0, sr);
    StudioState.tracks = [
      createTrackObject('Drums & Kit', 'drums', rock.drums, sr),
      createTrackObject('Sub & Analog Bass', 'bass', rock.bass, sr),
      createTrackObject('Rhythm Guitar', 'other', rock.rhythm, sr),
      createTrackObject('Lead Guitar', 'guitar', rock.lead, sr),
      createTrackObject('Lead Vocal Stem', 'vocals', rock.vocals, sr),
    ];
    StudioState.selectedTrackIdx = 0;
    renderTracksDom();
    syncChannelStripFromSelectedTrack();
  }

  async function fetchProjectsList() {
    try {
      const res = await fetch('/api/audio/editor/projects');
      if (!res.ok) return;
      const data = await res.json();
      StudioState.projects = Array.isArray(data.projects) ? data.projects : [];
      renderProjectsSelectorAndTable();
      if (!StudioState.currentProject && StudioState.projects.length > 0) {
        await loadProjectById(StudioState.projects[0].id);
      }
    } catch {}
  }

  function renderProjectsSelectorAndTable() {
    const sel = el('select-project-list');
    const tbody = el('projects-tbody');
    if (sel) {
      sel.innerHTML = '<option value="">Unsaved Session</option>';
      StudioState.projects.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.title} (Rev ${p.revision || 1})`;
        if (StudioState.currentProject?.id === p.id) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    if (tbody) {
      tbody.innerHTML = '';
      StudioState.projects.forEach((p) => {
        const tr = document.createElement('tr');
        if (StudioState.currentProject?.id === p.id) tr.className = 'active';
        const bpm = p.master?.tempo || p.tempo || 120;
        tr.innerHTML = `<td>${p.title}</td><td class="num">${bpm}</td><td class="num">${p.revision || 1}</td>`;
        tr.addEventListener('click', () => loadProjectById(p.id));
        tbody.appendChild(tr);
      });
    }
  }

  async function loadProjectById(projectId) {
    if (!projectId) return;
    const res = await fetch(`/api/audio/editor/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) return;
    const { project } = await res.json();
    if (!project) return;
    await applyServerProjectState(project);
    setStatus(`Loaded "${project.title}" (Rev ${project.revision || 1}).`);
  }

  async function applyServerProjectState(project) {
    StudioState.currentProject = project;
    StudioState.isDirty = false;
    StudioState.sampleRate = Number(project.sampleRate || 48000);
    StudioState.tempo = Number(project.tempo || project.master?.tempo || 120);
    StudioState.masterGainDb = Number(project.master?.masterGainDb ?? 0);
    if (el('project-title')) el('project-title').textContent = project.title;
    if (el('input-project-title')) el('input-project-title').value = project.title;
    if (el('input-tempo')) el('input-tempo').value = String(StudioState.tempo);
    if (el('slider-master-gain')) el('slider-master-gain').value = String(StudioState.masterGainDb);
    if (el('val-master-gain')) el('val-master-gain').textContent = `${StudioState.masterGainDb.toFixed(1)} dB`;
    if (el('revision-badge')) el('revision-badge').textContent = `Rev ${project.revision || 1}`;

    if (Array.isArray(project.stems) && project.stems.length > 0) {
      const loaded = [];
      for (const s of project.stems) {
        const audio = await window.AudioUIHelpers.fetchStemPcm(s, StudioState.sampleRate);
        const trk = createTrackObject(s.name || s.trackName, s.trackName || 'vocals', audio.left, StudioState.sampleRate, audio.right);
        Object.assign(trk, {
          id: s.id, persisted: true, blobHash: s.blobHash,
          gainDb: Number(s.gainDb ?? 0), pan: Number(s.pan ?? 0),
          eqLowDb: Number(s.eqLowDb ?? 0), eqMidDb: Number(s.eqMidDb ?? 0), eqHighDb: Number(s.eqHighDb ?? 0),
          compRatio: Number(s.compRatio ?? 2.5), reverbMix: Number(s.reverbMix ?? 0.08),
          distortionMode: s.distortionMode || 'bypass', driveDb: Number(s.driveDb ?? 0),
          hpf: Boolean(s.hpf), ducking: Boolean(s.ducking), muted: Boolean(s.muted), solo: Boolean(s.solo),
        });
        recomputeTrackDsp(trk);
        loaded.push(trk);
      }
      StudioState.tracks = loaded;
      StudioState.selectedTrackIdx = Math.min(StudioState.selectedTrackIdx, Math.max(0, loaded.length - 1));
      renderTracksDom();
      syncChannelStripFromSelectedTrack();
    }
    renderProjectsSelectorAndTable();
    emitSurfaceContext();
  }

  async function createNewProject() {
    const title = el('input-project-title')?.value?.trim() || 'Studio Arrangement';
    const tempo = Number(el('input-tempo')?.value) || 120;
    const sampleRate = Number(el('select-sample-rate')?.value) || 48000;
    const res = await fetch('/api/audio/editor/agent-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, tempo, sampleRate }),
    });
    if (!res.ok) { setStatus('Unable to create project.', true); return null; }
    const { project } = await res.json();
    StudioState.currentProject = project;
    await fetchProjectsList();
    setStatus(`Created session "${project.title}" (Rev ${project.revision}).`);
    return project;
  }

  async function persistUnsavedStems(projectId) {
    for (const trk of StudioState.tracks) {
      if (trk.persisted && trk.blobHash) continue;
      const b64 = window.AudioUIHelpers.encodeTrackToWavBase64(trk, StudioState.sampleRate);
      const res = await fetch(`/api/audio/editor/projects/${encodeURIComponent(projectId)}/stems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: trk.name, trackName: trk.role, audioBase64: b64, mimeType: 'audio/wav' }),
      });
      if (res.ok) {
        const out = await res.json();
        trk.id = out.stem.id;
        trk.blobHash = out.blobHash;
        trk.persisted = true;
      }
    }
  }

  async function saveCurrentProjectRevision() {
    let proj = StudioState.currentProject || await createNewProject();
    if (!proj) return false;
    await persistUnsavedStems(proj.id);
    const freshRes = await fetch(`/api/audio/editor/projects/${encodeURIComponent(proj.id)}`);
    if (freshRes.ok) proj = (await freshRes.json()).project || proj;

    const title = el('input-project-title')?.value?.trim() || proj.title;
    const tempo = Number(el('input-tempo')?.value) || 120;
    const operations = [
      { type: 'rename', title },
      { type: 'setTempo', tempo },
      { type: 'setMaster', masterGainDb: StudioState.masterGainDb, targetLufs: StudioState.targetLufs },
      ...StudioState.tracks.filter((t) => t.persisted).map((t) => ({
        type: 'setChannelStrip',
        trackId: t.id,
        config: {
          name: t.name, role: t.role, gainDb: t.gainDb, pan: t.pan, hpf: t.hpf, ducking: t.ducking,
          muted: t.muted, solo: t.solo, eqLowDb: t.eqLowDb, eqMidDb: t.eqMidDb, eqHighDb: t.eqHighDb,
          compRatio: t.compRatio, reverbMix: t.reverbMix, distortionMode: t.distortionMode, driveDb: t.driveDb,
        },
      })),
    ];
    const res = await fetch(`/api/audio/editor/projects/${encodeURIComponent(proj.id)}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proj.id, baseRevision: proj.revision || 1, operations: operations.slice(0, 32) }),
    });
    if (!res.ok) { setStatus('Failed to save revision.', true); return false; }
    const data = await res.json();
    if (data.project) await applyServerProjectState(data.project);
    await fetchProjectsList();
    setStatus(`Saved revision ${data.project?.revision || ''}.`);
    return true;
  }

  async function handleFileImport(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setStatus(`Decoding "${file.name}"...`);
    try {
      const ctx = ensureAudioContext();
      const decoded = await window.AudioUIHelpers.decodeBrowserFile(file, ctx, StudioState.sampleRate);
      const trk = createTrackObject(file.name, 'vocals', decoded.left, StudioState.sampleRate, decoded.right);
      StudioState.tracks.push(trk);
      StudioState.selectedTrackIdx = StudioState.tracks.length - 1;
      StudioState.isDirty = true;
      renderTracksDom();
      syncChannelStripFromSelectedTrack();
      setMobilePane('center');
      setStatus(`Imported "${file.name}" (${(decoded.left.length / StudioState.sampleRate).toFixed(1)}s).`);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`, true);
    }
  }

  async function synthesizeVoiceTrack(auditionOnly) {
    const text = el('tts-input-text')?.value?.trim();
    const persona = el('select-voice-persona')?.value || 'morgan_freeman';
    if (!text) { setStatus('Enter narration text first.', true); return; }
    setStatus(`Synthesizing "${persona}" voice...`);
    const res = await fetch('/api/audio/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, persona, projectId: auditionOnly ? undefined : StudioState.currentProject?.id, trackName: 'vocals' }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      setStatus(errJson.message || 'Voice synthesis service unavailable.', true);
      return;
    }
    const out = await res.json();
    const wavRes = await fetch(out.downloadUrl);
    const wav = window.DSPEngine.decodeWav(await wavRes.arrayBuffer());
    const pcm = window.DSPEngine.resampleChannel(wav.channels[0], wav.sampleRate, StudioState.sampleRate);
    if (auditionOnly) {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      const buf = ctx.createBuffer(1, pcm.length, StudioState.sampleRate);
      buf.getChannelData(0).set(pcm);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      setStatus(`Auditioning "${persona}" (${out.durationSeconds}s).`);
      return;
    }
    const trk = createTrackObject(`Voice (${persona})`, 'vocals', pcm, StudioState.sampleRate);
    if (out.stem?.id) { trk.id = out.stem.id; trk.blobHash = out.blobHash; trk.persisted = true; }
    StudioState.tracks.push(trk);
    StudioState.isDirty = true;
    renderTracksDom();
    setMobilePane('center');
    setStatus(`Added "${persona}" narration stem (${out.durationSeconds}s).`);
  }

  async function toggleMicRecording() {
    if (StudioState.isRecording && StudioState.mediaRecorder) {
      StudioState.mediaRecorder.stop();
      StudioState.isRecording = false;
      if (el('btn-transport-record')) el('btn-transport-record').textContent = 'Record Take';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Microphone capture is not available in this browser context.', true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      StudioState.recordedChunks = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size > 0) StudioState.recordedChunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(StudioState.recordedChunks, { type: rec.mimeType || 'audio/webm' });
        const file = new File([blob], 'mic_take.webm', { type: blob.type });
        const decoded = await window.AudioUIHelpers.decodeBrowserFile(file, ensureAudioContext(), StudioState.sampleRate);
        let left = decoded.left;
        if (el('chk-mod-active')?.checked) {
          left = window.DSPEngine.applyLiveModulationRack(left, StudioState.sampleRate, {
            persona: el('select-mod-persona')?.value || 'none',
            pitchShiftSemitones: Number(el('mod-pitch-shift')?.value || 0),
            tubeDriveDb: Number(el('mod-tube-drive')?.value || 1.5),
            gateThresholdDb: Number(el('mod-gate-thresh')?.value || -42),
          });
        }
        StudioState.tracks.push(createTrackObject('Live Mic Take', 'vocals', left, StudioState.sampleRate));
        StudioState.isDirty = true;
        renderTracksDom();
        setStatus('Recorded live microphone take onto timeline.');
      };
      StudioState.mediaRecorder = rec;
      StudioState.isRecording = true;
      rec.start();
      if (el('btn-transport-record')) el('btn-transport-record').textContent = 'Stop Recording';
      setStatus('Recording microphone take...');
    } catch (err) {
      setStatus(`Microphone permission declined: ${err.message}`, true);
    }
  }

  async function renderAndDownloadMaster(forceFormat) {
    const format = forceFormat || el('select-export-format')?.value || 'wav';
    const saved = await saveCurrentProjectRevision();
    if (!saved || !StudioState.currentProject) {
      const mix = renderStereoMix();
      window.DSPEngine.normalizeStereoLoudness(mix.left, mix.right, -14.0, -1.0, StudioState.sampleRate);
      const wav = window.DSPEngine.encodeWav([mix.left, mix.right], StudioState.sampleRate);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      a.download = 'studio_master.wav';
      a.click();
      return;
    }
    setStatus(`Rendering -14.0 LUFS ${format.toUpperCase()} master...`);
    const res = await fetch(`/api/audio/editor/projects/${encodeURIComponent(StudioState.currentProject.id)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: StudioState.currentProject.id, format, normalize: true }),
    });
    if (!res.ok) { setStatus('Master render failed.', true); return; }
    const out = await res.json();
    setStatus(`Master rendered (${out.mixdown.lufsIntegrated} LUFS, ${format.toUpperCase()}).`);
    const a = document.createElement('a');
    a.href = out.downloadUrl;
    a.download = `${(StudioState.currentProject.title || 'master').replace(/\s+/g, '_')}.${format}`;
    a.click();
  }

  async function runConciergeInstruction(instructionText) {
    const instruction = String(instructionText || el('concierge-input')?.value || '').trim();
    if (!instruction) return;
    await saveCurrentProjectRevision();
    const res = await fetch('/api/audio/editor/concierge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: StudioState.currentProject?.id, instruction }),
    });
    if (!res.ok) { setStatus('Concierge adjustment failed.', true); return; }
    const data = await res.json();
    if (Array.isArray(data.surfaceDirectives)) data.surfaceDirectives.forEach(applySurfaceBridgeDirective);
    if (data.project) await applyServerProjectState(data.project);
    const log = el('concierge-messages');
    if (log) {
      const item = document.createElement('div');
      item.className = 'concierge-msg';
      item.textContent = data.summary || `Applied: ${instruction}`;
      log.appendChild(item);
      log.scrollTop = log.scrollHeight;
    }
    setStatus(data.summary || 'Mixing recipe applied.');
  }

  function applyClientMacro(macroKey) {
    if (macroKey === 'broadcast') {
      const mix = renderStereoMix();
      const diff = Math.max(-18, Math.min(12, -14.0 - mix.lufsIntegrated));
      StudioState.masterGainDb = Number((StudioState.masterGainDb + diff).toFixed(1));
      if (el('slider-master-gain')) el('slider-master-gain').value = String(StudioState.masterGainDb);
      if (el('val-master-gain')) el('val-master-gain').textContent = `${StudioState.masterGainDb.toFixed(1)} dB`;
      StudioState.isDirty = true;
      updateMasterLufsMeter();
      setStatus(`Calibrated master bus to -14.0 LUFS (${StudioState.masterGainDb} dB trim).`);
      return;
    }
    const preset = window.AudioUIHelpers.CLIENT_MACROS[macroKey];
    const trk = StudioState.tracks[StudioState.selectedTrackIdx];
    if (!preset || !trk) return;
    Object.assign(trk, preset);
    delete trk.label;
    recomputeTrackDsp(trk);
    StudioState.isDirty = true;
    syncChannelStripFromSelectedTrack();
    renderTracksDom();
    setStatus(`Applied ${preset.label} to "${trk.name}".`);
  }

  function setMobilePane(pane) {
    document.body.dataset.mobilePane = pane;
    document.querySelectorAll('.pane-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.paneTarget === pane);
    });
  }

  function emitSurfaceContext() {
    try {
      window.parent.postMessage({
        channel: 'oshal-surface-bridge',
        v: 1,
        app: 'audio',
        op: 'context',
        payload: {
          surface: 'audio-studio',
          projectId: StudioState.currentProject?.id || null,
          projectTitle: StudioState.currentProject?.title || el('input-project-title')?.value || 'Studio Arrangement',
          revision: StudioState.currentProject?.revision || 1,
          tempo: StudioState.tempo,
          trackCount: StudioState.tracks.length,
        },
      }, '*');
    } catch {}
  }

  function applySurfaceBridgeDirective(msg) {
    if (!msg || msg.channel !== 'oshal-surface-bridge') return;
    if (msg.op === 'set_field' && msg.field) {
      const target = document.querySelector(`[data-bridge-field="${msg.field}"]`);
      if (target) {
        if (target.type === 'checkbox') target.checked = msg.value === 'true' || msg.value === true;
        else target.value = String(msg.value ?? '');
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function bindTimelineEditAndMacroControls() {
    el('btn-slice-at-playhead')?.addEventListener('click', () => {
      const trk = StudioState.tracks[StudioState.selectedTrackIdx];
      if (!trk) return;
      const dur = trk.rawPcm.length / trk.sampleRate;
      const cut = StudioState.playheadSec > 0.1 && StudioState.playheadSec < dur - 0.1 ? StudioState.playheadSec : dur / 2;
      const partA = window.DSPEngine.sliceBuffer(trk.rawPcm, 0, cut, trk.sampleRate);
      const partB = window.DSPEngine.shiftBuffer(window.DSPEngine.sliceBuffer(trk.rawPcm, cut, dur, trk.sampleRate), cut, trk.sampleRate);
      trk.rawPcm = partA;
      trk.rawPcmRight = new Float32Array(partA);
      trk.persisted = false;
      recomputeTrackDsp(trk);
      StudioState.tracks.splice(StudioState.selectedTrackIdx + 1, 0, createTrackObject(`${trk.name} (Slice B)`, trk.role, partB, trk.sampleRate));
      StudioState.isDirty = true;
      renderTracksDom();
      setStatus(`Sliced "${trk.name}" at ${cut.toFixed(2)}s.`);
    });
    el('btn-loop-all')?.addEventListener('click', () => {
      StudioState.tracks.forEach((t) => {
        t.rawPcm = window.DSPEngine.repeatBuffer(t.rawPcm, 16.0, t.sampleRate);
        t.rawPcmRight = window.DSPEngine.repeatBuffer(t.rawPcmRight || t.rawPcm, 16.0, t.sampleRate);
        t.persisted = false;
        recomputeTrackDsp(t);
      });
      StudioState.isDirty = true;
      renderTracksDom();
      setStatus('Extended all tracks to 16.0s loop.');
    });
    el('btn-insert-filler')?.addEventListener('click', () => {
      const trk = StudioState.tracks[StudioState.selectedTrackIdx];
      if (!trk) return;
      const type = el('select-riff-type')?.value || 'filler_drum_roll';
      const filler = window.DSPEngine.generateSyntheticAudio(type, 1.0, trk.sampleRate);
      window.DSPEngine.insertFiller(trk.rawPcm, filler, StudioState.playheadSec, trk.sampleRate);
      trk.rawPcmRight = new Float32Array(trk.rawPcm);
      trk.persisted = false;
      recomputeTrackDsp(trk);
      StudioState.isDirty = true;
      renderTracksDom();
      setStatus(`Inserted ${type} at ${StudioState.playheadSec.toFixed(2)}s.`);
    });
    const macroBindings = [
      ['btn-preset-clean-voice', 'clean_voice'], ['btn-preset-duck', 'auto_duck'],
      ['btn-preset-punchy', 'punchy'], ['btn-preset-warm', 'warm'],
      ['btn-preset-space', 'space'], ['btn-preset-broadcast', 'broadcast'],
    ];
    for (const [id, key] of macroBindings) el(id)?.addEventListener('click', () => applyClientMacro(key));
  }

  function bindNavigationAndSurfaceBridge() {
    el('btn-nav-create-home')?.addEventListener('click', () => {
      try { window.parent.postMessage({ type: 'app-navigate', tool: 'create-home' }, '*'); } catch {}
    });
    el('btn-nav-concierge-toggle')?.addEventListener('click', () => {
      setMobilePane('right');
      el('concierge-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    el('btn-cockpit-ask')?.addEventListener('click', async () => {
      const prompt = el('concierge-input')?.value?.trim() || 'Inspect my current Audio Studio mix and suggest mastering improvements.';
      await saveCurrentProjectRevision();
      try { window.parent.postMessage({ type: 'oshal-cockpit-ask', app: 'audio', prompt }, '*'); } catch {}
      setStatus('Sent active session context to Cockpit Concierge.');
    });
    document.querySelectorAll('.pane-tab').forEach((btn) => {
      btn.addEventListener('click', () => setMobilePane(btn.dataset.paneTarget || 'center'));
    });
    window.addEventListener('message', (event) => {
      if (event?.data?.channel === 'oshal-surface-bridge') applySurfaceBridgeDirective(event.data);
    });
    import('/api/audio/editor-handoff.mjs')
      .then((mod) => {
        mod.connectAudioEditorHandoff?.({
          getState: () => ({ project: StudioState.currentProject, tracks: StudioState.tracks, masterGainDb: StudioState.masterGainDb }),
          isDirty: () => StudioState.isDirty,
          saveProject: () => saveCurrentProjectRevision(),
          loadProject: (id) => loadProjectById(id),
        });
      })
      .catch(() => {});
  }

  function bindTransportAndSessionControls() {
    el('btn-play')?.addEventListener('click', startPlayback);
    el('btn-pause')?.addEventListener('click', () => {
      if (StudioState.isPlaying && StudioState.audioCtx) {
        StudioState.pauseOffset = StudioState.audioCtx.currentTime - StudioState.startTime;
        stopPlayback(false);
      }
    });
    el('btn-stop')?.addEventListener('click', () => stopPlayback(true));
    el('btn-transport-record')?.addEventListener('click', toggleMicRecording);
    el('btn-mod-start-mic')?.addEventListener('click', toggleMicRecording);
    el('btn-create-project')?.addEventListener('click', createNewProject);
    el('btn-save-project')?.addEventListener('click', saveCurrentProjectRevision);
    el('btn-refresh-projects')?.addEventListener('click', fetchProjectsList);
    el('select-project-list')?.addEventListener('change', (e) => { if (e.target.value) loadProjectById(e.target.value); });
    el('audio-file-input')?.addEventListener('change', handleFileImport);
    el('btn-load-rock-song')?.addEventListener('click', () => { loadDefaultArrangement(); setStatus('Loaded 5-stem arrangement.'); });
  }

  function bindGeneratorAndMasterControls() {
    el('btn-add-instrument')?.addEventListener('click', () => {
      const type = el('select-instrument-type')?.value || 'drums';
      const pcm = window.DSPEngine.generateSyntheticAudio(type, 4.0, StudioState.sampleRate);
      StudioState.tracks.push(createTrackObject(`Instrument (${type})`, type, pcm, StudioState.sampleRate));
      StudioState.isDirty = true;
      renderTracksDom();
      setMobilePane('center');
    });
    el('btn-add-riff-track')?.addEventListener('click', () => {
      const type = el('select-riff-type')?.value || 'riff_rock_guitar';
      const pcm = window.DSPEngine.generateSyntheticAudio(type, 4.0, StudioState.sampleRate);
      StudioState.tracks.push(createTrackObject(`Riff (${type})`, 'other', pcm, StudioState.sampleRate));
      StudioState.isDirty = true;
      renderTracksDom();
      setMobilePane('center');
    });
    el('btn-audition-voice')?.addEventListener('click', () => synthesizeVoiceTrack(true));
    el('btn-inject-voice-track')?.addEventListener('click', () => synthesizeVoiceTrack(false));
    el('btn-export-wav')?.addEventListener('click', () => renderAndDownloadMaster('wav'));
    el('btn-render-mixdown')?.addEventListener('click', () => renderAndDownloadMaster());
    el('btn-download-master')?.addEventListener('click', () => renderAndDownloadMaster());
    el('btn-live-publish')?.addEventListener('click', publishSelectedTrackLive);
    el('slider-master-gain')?.addEventListener('input', (e) => {
      StudioState.masterGainDb = Number(e.target.value) || 0;
      if (el('val-master-gain')) el('val-master-gain').textContent = `${StudioState.masterGainDb.toFixed(1)} dB`;
      StudioState.isDirty = true;
      updateMasterLufsMeter();
    });
    el('selected-channel-controls')?.addEventListener('change', applyChannelStripEdits);
    el('btn-concierge-send')?.addEventListener('click', () => runConciergeInstruction());
    document.querySelectorAll('.concierge-chip').forEach((btn) => {
      btn.addEventListener('click', () => runConciergeInstruction(btn.dataset.prompt));
    });
  }

  async function publishSelectedTrackLive() {
    const trk = StudioState.tracks[StudioState.selectedTrackIdx];
    if (!trk) return;
    const proj = StudioState.currentProject || await createNewProject();
    if (!proj) return;
    const b64 = window.AudioUIHelpers.encodeTrackToWavBase64(trk, StudioState.sampleRate);
    const persona = el('select-mod-persona')?.value || 'none';
    const res = await fetch('/api/audio/live/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: proj.id, name: trk.name, audioBase64: b64, synthesizePersona: persona }),
    });
    if (res.ok) setStatus(`Published mastered -14.0 LUFS take for "${trk.name}".`);
  }

  function bindStudioControls() {
    bindTransportAndSessionControls();
    bindGeneratorAndMasterControls();
    bindTimelineEditAndMacroControls();
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadDefaultArrangement();
    bindNavigationAndSurfaceBridge();
    bindStudioControls();
    fetchProjectsList();
  });
})();
