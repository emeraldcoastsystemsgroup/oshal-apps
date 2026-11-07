/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | OSHAL Surface Bridge and Document Handoff adapter for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: context only. The concierge rail reads which phone or computer is open and how it stands; it is given nothing to press, because a package bot does not drive computers (ADR-205 D5) - Ask Jarvis to do it opens the kernel's page for that computer, where Jarvis can.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: recognize TV devices and accept both phone/computer and selectedPhone/selectedComputer state shapes when building concierge context snapshots.
 */

/**
 * @description What the concierge rail is told about the open view. Pure.
 * @param {{mode?:string,phone?:object|null,computer?:object|null,selectedPhone?:object|null,selectedComputer?:object|null,phones?:object[],computers?:object[],phoneCount?:number,computerCount?:number}} state The page.
 * @returns {{surface:string,title:string,recordId?:string,digest:string,fields:object}} The context.
 */
export function buildPhoneControlContextSnapshot(state = {}) {
  const phone = state.phone || state.selectedPhone || null;
  const computer = state.computer || state.selectedComputer || null;
  const rdp = state.rdp || state.selectedRdp || null;
  const phones = Array.isArray(state.phones) ? state.phones.length : Number(state.phoneCount || 0);
  const computers = Array.isArray(state.computers) ? state.computers.length : Number(state.computerCount || 0);
  const rdpCount = Array.isArray(state.rdpSessions) ? state.rdpSessions.length : Number(state.rdpCount || 0);
  const rdpName = rdp ? `${rdp.username ? `${rdp.username}@` : ''}${rdp.host}:${rdp.port || 3389}` : '';
  const title = phone?.name || computer?.name || rdpName || 'Phone & Device Control';
  const kind = phone
    ? (phone.form === 'tv' ? 'TV' : phone.platform === 'android' ? 'Android phone' : 'iPhone')
    : computer ? 'computer' : rdp ? 'RDP desktop' : 'nothing selected';
  return {
    surface: state.mode === 'connect' ? 'phone-control-config' : 'phone-control-execution',
    title,
    recordId: phone?.id || (computer ? String(computer.id) : rdp ? String(rdp.sessionId) : undefined),
    digest: `${title} (${kind}) · ${phones} devices · ${computers + rdpCount} desktops${phone && !phone.controlEnabled ? ' · control off' : ''}`.slice(0, 240),
    fields: {
      targetKey: phone ? `phone:${phone.id}` : computer ? `computer:${computer.id}` : rdp ? `rdp:${rdp.sessionId}` : '',
      deviceId: phone?.id || '',
      rdpSessionId: rdp?.sessionId || '',
      platform: phone?.platform || (computer ? 'computer' : rdp ? 'rdp' : ''),
      controlEnabled: phone ? String(phone.controlEnabled) : '',
      computerName: computer?.name || rdpName,
      phoneCount: String(phones),
      computerCount: String(computers)
    }
  };
}

/**
 * @description Register the page with the cockpit's document handoff so the rail can read its context.
 * @param {{getState:Function,registerSession?:Function}} options The page's state and the registry.
 * @returns {Function} Unregister.
 */
export function connectPhoneControlHandoff({ getState, registerSession }) {
  const register = registerSession || globalThis?.__oshalDocumentHandoff?.registerDocumentSession;
  if (typeof register !== 'function') return () => {};
  return register({
    app: 'phone-control',
    async prepare() {
      const snapshot = buildPhoneControlContextSnapshot(getState());
      return snapshot.recordId ? { app: 'phone-control', screen: 'surface', ...snapshot } : null;
    },
    async refresh() {}
  });
}
