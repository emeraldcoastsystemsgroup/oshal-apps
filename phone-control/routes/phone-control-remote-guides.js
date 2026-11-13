/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose a nonexecuting Fire TV phone-app operating packet; current owner tools and observed target evidence remain required.
 */
'use strict';

/** Read-only instructions, never a connection report or an action receipt. */
function fireTvGuide() {
  return {
    version: 1, kind: 'operating-guide', executed: false,
    connection_verified: false, playback_verified: false,
    package: 'com.amazon.storm.lightning.client.aosp',
    required_native_tools: ['app.open', 'screen.read', 'desktop.control.pinned'],
    authority: 'existing-original-owner-native-tools-only',
    target_selection: 'exact-user-requested-target-required',
    preferred_existing_path: 'existing-selected-remote-first',
    missing_target_evidence: 'stop-before-input',
    uncertain_result: 'unverified-no-automatic-retry',
    steps: [
      "Use the original owner's current phone or their explicitly selected owned phone. This guide grants no control and does not choose a phone or TV.",
      "Read the phone first. A locked phone, missing live accessibility read or unavailable current control stops here; ask for the exact local interaction needed, never claim background service means unlocked.",
      "Use the installed Amazon Fire TV phone app, by this exact package. A launch request is not visible opening: read again and require its activePackage. No installed match means stop, not install or sign in automatically.",
      "First inspect the existing Remote screen. Preserve the remote the person has already selected; a current user-selected remote can be context without inventing a device name. For their wake/resume request, use its observed centre/select only once after the current target is uniquely verified. Selection acknowledgement is not playback. Do not select a different TV or search for content merely to resume.",
      "Read the already paired devices and the selected remote target. Use only the exact requested Fire Stick whose identity is established by the person's selection and fresh visible evidence. Never choose the first/last-used device, a similar name, an old address or a duplicate name.",
      "Read the selected target again before sending any remote input. If its identity cannot be distinguished, stop before input; never interpret an old saved TV label as proof.",
      "For every phone input use computer.control with expected_app equal to this package, and coordinates or text from the latest real read. If the guard is unsupported or refuses, stop; never omit it to continue.",
      "Only when the person requests different content and the existing selected remote is verified: for a programme request, verify its current date, exact title and service with an available official source. Search through observed controls, select that exact programme and only a nonpurchase Watch, Resume or Play action. Read again after each navigation.",
      "If the requested programme is already playing, preserve it. Never change power, account, subscription, purchase or another TV. Do not activate a recurring job or retry an uncertain command."
    ],
    verification: [
      "Report phone app foreground, exact selected target, request acknowledgement and actual TV playback evidence separately. Acknowledgement is not playback verification.",
      "Only a fresh observation of the same television or an explicitly attributed user witness verifies what is playing. Without it say requested and unverified; the phone's own page is not the TV screen.",
      "Remember a demonstrated path only as owner-scoped evidence, not as permission or a new device identity. Recheck current authority, package and target on every reuse."
    ]
  };
}

/** Mount behind the package's existing verified-owner middleware. No native intent, network or store write. */
function mountRemoteGuides(router) {
  router.get('/remote-apps/fire-tv/guide', (req, res) => {
    if (Object.keys(req.query || {}).length || Object.keys(req.body || {}).length) {
      return res.status(400).json({ error: 'guide_input_invalid', message: 'This guide takes no device, action or link.' });
    }
    return res.json(fireTvGuide());
  });
}
module.exports = { mountRemoteGuides };
