/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Isolate saved Audio session loading and revision operations, including explicit removals and empty project boundaries.
 */
'use strict';
window.AudioSession = class AudioSession {
    constructor(context) { Object.assign(this, context); }
    async fetchProjectsList() {
      try {
        const res = await fetch('/api/audio/editor/projects');
        if (!res.ok) return;
        const data = await res.json();
        this.state.projects = Array.isArray(data.projects) ? data.projects : [];
        this.renderProjectsSelectorAndTable();
        if (!this.state.currentProject && this.state.projects.length > 0) {
          await this.loadProjectById(this.state.projects[0].id);
        }
      } catch {}
    }

    renderProjectsSelectorAndTable() {
      const sel = this.el('select-project-list');
      const tbody = this.el('projects-tbody');
      if (sel) {
        sel.innerHTML = '<option value="">Unsaved Session</option>';
        this.state.projects.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.title} (Rev ${p.revision || 1})`;
          if (this.state.currentProject?.id === p.id) opt.selected = true;
          sel.appendChild(opt);
        });
      }
      if (tbody) {
        tbody.innerHTML = '';
        this.state.projects.forEach((p) => {
          const tr = document.createElement('tr');
          if (this.state.currentProject?.id === p.id) tr.className = 'active';
          const bpm = p.master?.tempo || p.tempo || 120;
          tr.innerHTML = `<td>${p.title}</td><td class="num">${bpm}</td><td class="num">${p.revision || 1}</td>`;
          tr.addEventListener('click', () => this.loadProjectById(p.id));
          tbody.appendChild(tr);
        });
      }
    }

    async loadProjectById(projectId) {
      if (!projectId) return;
      const res = await fetch(`/api/audio/editor/projects/${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const { project } = await res.json();
      if (!project) return;
      await this.applyServerProjectState(project);
      this.setStatus(`Loaded "${project.title}" (Rev ${project.revision || 1}).`);
    }

    async applyServerProjectState(project) {
      this.state.currentProject = project;
      this.state.isDirty = false;
      this.state.sampleRate = Number(project.sampleRate || 48000);
      this.state.tempo = Number(project.tempo || project.master?.tempo || 120);
      this.state.masterGainDb = Number(project.master?.masterGainDb ?? 0);
      if (this.el('project-title')) this.el('project-title').textContent = project.title;
      if (this.el('input-project-title')) this.el('input-project-title').value = project.title;
      if (this.el('input-tempo')) this.el('input-tempo').value = String(this.state.tempo);
      if (this.el('slider-master-gain')) this.el('slider-master-gain').value = String(this.state.masterGainDb);
      if (this.el('val-master-gain')) this.el('val-master-gain').textContent = `${this.state.masterGainDb.toFixed(1)} dB`;
      if (this.el('revision-badge')) this.el('revision-badge').textContent = `Rev ${project.revision || 1}`;

      const loaded = [];
      for (const s of project.stems || []) {
        const audio = await window.AudioUIHelpers.fetchStemPcm(s, this.state.sampleRate);
        const trk = this.createTrackObject(s.name || s.trackName, s.trackName || 'vocals', audio.left, this.state.sampleRate, audio.right);
        Object.assign(trk, {
          id: s.id, persisted: true, blobHash: s.blobHash,
          gainDb: Number(s.gainDb ?? 0), pan: Number(s.pan ?? 0),
          eqLowDb: Number(s.eqLowDb ?? 0), eqMidDb: Number(s.eqMidDb ?? 0), eqHighDb: Number(s.eqHighDb ?? 0),
          compRatio: Number(s.compRatio ?? 2.5), reverbMix: Number(s.reverbMix ?? 0.08),
          distortionMode: s.distortionMode || 'bypass', driveDb: Number(s.driveDb ?? 0),
          hpf: Boolean(s.hpf), ducking: Boolean(s.ducking), muted: Boolean(s.muted), solo: Boolean(s.solo),
        });
        this.recomputeTrackDsp(trk);
        loaded.push(trk);
      }
      this.state.tracks = loaded;
      this.state.removedStemIds.clear();
      this.state.selectedTrackIdx = Math.min(this.state.selectedTrackIdx, Math.max(0, loaded.length - 1));
      this.renderTracksDom();
      this.syncChannelStripFromSelectedTrack();
      this.renderProjectsSelectorAndTable();
      this.emitSurfaceContext();
    }

    async createNewProject({ preserveDraft = false } = {}) {
      const title = this.el('input-project-title')?.value?.trim() || 'Studio Arrangement';
      const tempo = Number(this.el('input-tempo')?.value) || 120;
      const sampleRate = Number(this.el('select-sample-rate')?.value) || 48000;
      const res = await fetch('/api/audio/editor/agent-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tempo, sampleRate }),
      });
      if (!res.ok) { this.setStatus('Unable to create project.', true); return null; }
      const { project } = await res.json();
      if (preserveDraft) this.state.currentProject = project;
      else await this.applyServerProjectState(project);
      await this.fetchProjectsList();
      this.setStatus(`Created session "${project.title}" (Rev ${project.revision}).`);
      return project;
    }

    async persistUnsavedStems(projectId) {
      for (const trk of this.state.tracks) {
        if (trk.persisted && trk.blobHash) continue;
        const b64 = window.AudioUIHelpers.encodeTrackToWavBase64(trk, this.state.sampleRate);
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

    pendingTrackRemovals(project) {
      const existing = new Set((project.stems || []).map(stem => stem.id));
      return [...this.state.removedStemIds].filter(id => existing.has(id))
        .map(trackId => ({ type: 'removeTrack', trackId }));
    }

    async saveCurrentProjectRevision() {
      let proj = this.state.currentProject || await this.createNewProject({ preserveDraft: true });
      if (!proj) return false;
      await this.persistUnsavedStems(proj.id);
      const freshRes = await fetch(`/api/audio/editor/projects/${encodeURIComponent(proj.id)}`);
      if (freshRes.ok) proj = (await freshRes.json()).project || proj;

      const title = this.el('input-project-title')?.value?.trim() || proj.title;
      const tempo = Number(this.el('input-tempo')?.value) || 120;
      const operations = [
        ...this.pendingTrackRemovals(proj),
        { type: 'rename', title },
        { type: 'setTempo', tempo },
        { type: 'setMaster', masterGainDb: this.state.masterGainDb, targetLufs: this.state.targetLufs },
        ...this.state.tracks.filter((t) => t.persisted).map((t) => ({
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
        body: JSON.stringify({ id: proj.id, baseRevision: proj.revision || 1, operations }),
      });
      if (!res.ok) { this.setStatus('Failed to save revision.', true); return false; }
      const data = await res.json();
      if (data.project) await this.applyServerProjectState(data.project);
      await this.fetchProjectsList();
      this.setStatus(`Saved revision ${data.project?.revision || ''}.`);
      return true;
    }
};
