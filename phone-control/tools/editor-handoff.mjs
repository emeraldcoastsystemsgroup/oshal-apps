/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | OSHAL Surface Bridge and Document Handoff adapter for Phone & Device Control.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: context only. The concierge rail reads which phone or computer is open and how it stands; it is given nothing to press, because a package bot does not drive computers (ADR-205 D5) - Ask Jarvis to do it opens the kernel's page for that computer, where Jarvis can.
 */

/**
 * @description What the concierge rail is told about the open view. Pure.
 * @param {{mode?:string,phone?:object|null,computer?:object|null,phones?:object[],computers?:object[]}} state The page.
 * @returns {{surface:string,title:string,recordId?:string,digest:string,fields:object}} The context.
 */
export function buildPhoneControlContextSnapshot(state = {}) {
  const phone = state.phone || null;
  const computer = state.computer || null;
  const phones = Array.isArray(state.phones) ? state.phones.length : 0;
  const computers = Array.isArray(state.computers) ? state.computers.length : 0;
  const title = phone?.name || computer?.name || 'Phone & Device Control';
  const kind = phone ? (phone.platform === 'android' ? 'Android phone' : 'iPhone') : computer ? 'computer' : 'nothing selected';
  return {
    surface: state.mode === 'connect' ? 'phone-control-config' : 'phone-control-execution',
    title,
    recordId: phone?.id || (computer ? String(computer.id) : undefined),
    digest: `${title} (${kind}) · ${phones} phones · ${computers} computers${phone && !phone.controlEnabled ? ' · control off' : ''}`.slice(0, 240),
    fields: {
      deviceId: phone?.id || '',
      platform: phone?.platform || (computer ? 'computer' : ''),
      controlEnabled: phone ? String(phone.controlEnabled) : '',
      computerName: computer?.name || '',
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
