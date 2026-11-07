/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Surface bridge and document handoff helper saving dirty Audio Studio revisions before concierge reads and refreshing on completion.
 */

export function buildAudioContextSnapshot(state = {}) {
  const project = state.project || {};
  const tracks = Array.isArray(state.tracks) ? state.tracks : [];
  const revision = Number(project.revision || state.revision || 1);
  const tempo = Number(project.tempo || state.tempo || 120);
  const title = String(project.title || state.title || 'Audio Studio Session');
  return {
    surface: 'audio-studio',
    title,
    recordId: project.id ? String(project.id) : undefined,
    digest: `${title} · ${tracks.length} tracks · ${tempo} BPM · rev ${revision}`.slice(0, 240),
    fields: {
      projectId: project.id ? String(project.id) : '',
      revision: String(revision),
      trackCount: String(tracks.length),
      tempo: String(tempo),
      masterGainDb: String(state.masterGainDb ?? 0),
    },
  };
}

export function connectAudioEditorHandoff({
  getState,
  isDirty,
  saveProject,
  loadProject,
  applySurfaceField,
  applyCustomOp,
  registerSession,
}) {
  const register =
    registerSession ||
    globalThis?.__oshalDocumentHandoff?.registerDocumentSession ||
    ((spec) => {
      if (globalThis && typeof globalThis === 'object') {
        globalThis.__oshalDocumentSession = spec;
      }
      return () => {};
    });

  async function prepare() {
    if (typeof isDirty === 'function' && isDirty()) {
      const saved = await saveProject({ quiet: true });
      if (!saved) {
        throw new Error('Could not save current audio project revision before concierge handoff.');
      }
    }
    const state = typeof getState === 'function' ? getState() : {};
    const snap = buildAudioContextSnapshot(state);
    if (!snap.recordId) return null;
    return {
      app: 'audio',
      screen: 'surface',
      surface: 'audio-studio',
      title: snap.title,
      recordId: snap.recordId,
      digest: snap.digest,
      fields: snap.fields,
    };
  }

  async function refresh() {
    const state = typeof getState === 'function' ? getState() : {};
    const id = state?.project?.id || state?.currentProjectId;
    if (!id || typeof loadProject !== 'function') return;
    await loadProject(id, { quiet: true });
  }

  return register({
    app: 'audio',
    prepare,
    refresh,
    applySurfaceField,
    applyCustomOp,
  });
}
