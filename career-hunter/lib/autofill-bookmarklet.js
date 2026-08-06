/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Generate a bounded per-user offline application autofill bookmarklet with conservative ATS field matching and no submit or network capability.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refuse unknown and lookalike hosts before decoding PII, reject hidden/off-screen honeypots, and state the field-event boundary accurately.
 */

'use strict';

const MAX_FIELD_CHARS = 512;
const CORE_FIELDS = ['fullName', 'email', 'phone'];

const FIELD_DEFINITIONS = Object.freeze([
  { key: 'fullName', label: 'full name', aliases: ['full name', 'legal name', 'applicant name'], attrs: ['fullname', 'legalname', 'applicantname', 'name'], autocomplete: ['name'] },
  { key: 'firstName', label: 'first name', aliases: ['first name', 'given name'], attrs: ['firstname', 'givenname', 'fname'], autocomplete: ['given name'] },
  { key: 'middleName', label: 'middle name', aliases: ['middle name'], attrs: ['middlename', 'mname'], autocomplete: ['additional name'] },
  { key: 'lastName', label: 'last name', aliases: ['last name', 'family name', 'surname'], attrs: ['lastname', 'familyname', 'surname', 'lname'], autocomplete: ['family name'] },
  { key: 'email', label: 'email', aliases: ['email', 'email address'], attrs: ['email', 'emailaddress'], autocomplete: ['email'] },
  { key: 'phone', label: 'phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number'], attrs: ['phone', 'phonenumber', 'mobile', 'mobilenumber'], autocomplete: ['tel'] },
  { key: 'addressLine1', label: 'address', aliases: ['street address', 'address line 1', 'address 1'], attrs: ['address', 'addressline1', 'streetaddress'], autocomplete: ['street address', 'address line1'] },
  { key: 'addressLine2', label: 'address line 2', aliases: ['address line 2', 'address 2', 'apartment', 'suite'], attrs: ['addressline2', 'address2', 'apartment', 'suite'], autocomplete: ['address line2'] },
  { key: 'city', label: 'city', aliases: ['city', 'town'], attrs: ['city', 'town'], autocomplete: ['address level2'] },
  { key: 'state', label: 'state', aliases: ['state', 'province', 'region'], attrs: ['state', 'province', 'region'], autocomplete: ['address level1'] },
  { key: 'postalCode', label: 'postal code', aliases: ['postal code', 'zip code', 'zip'], attrs: ['postalcode', 'zipcode', 'zip'], autocomplete: ['postal code'] },
  { key: 'country', label: 'country', aliases: ['country'], attrs: ['country'], autocomplete: ['country', 'country name'] },
  { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin', 'linkedin profile', 'linkedin url'], attrs: ['linkedin', 'linkedinurl'], autocomplete: [] },
  { key: 'website', label: 'portfolio', aliases: ['portfolio', 'portfolio url', 'website', 'personal website'], attrs: ['portfolio', 'portfoliourl', 'website'], autocomplete: ['url'] },
  { key: 'github', label: 'GitHub', aliases: ['github', 'github profile', 'github url'], attrs: ['github', 'githuburl'], autocomplete: [] },
  { key: 'currentCompany', label: 'current company', aliases: ['current company', 'current employer'], attrs: ['currentcompany', 'currentemployer'], autocomplete: ['organization'] },
  { key: 'currentTitle', label: 'current title', aliases: ['current title', 'job title', 'current position'], attrs: ['currenttitle', 'jobtitle', 'currentposition'], autocomplete: ['organization title'] },
  { key: 'workAuthorization', label: 'work authorization', aliases: ['authorized to work', 'work authorization', 'legally authorized'], attrs: ['workauthorization', 'authorizedtowork', 'legallyauthorized'], autocomplete: [] },
  { key: 'sponsorship', label: 'sponsorship', aliases: ['require sponsorship', 'need sponsorship', 'visa sponsorship'], attrs: ['requiresponsorship', 'needsponsorship', 'visasponsorship'], autocomplete: [] },
]);

const DIRECT_SELECTORS = Object.freeze({
  greenhouse: {
    firstName: ['#first_name', '[name="job_application[first_name]"]'],
    lastName: ['#last_name', '[name="job_application[last_name]"]'],
    email: ['#email', '[name="job_application[email]"]'],
    phone: ['#phone', '[name="job_application[phone]"]'],
  },
  ashby: {
    fullName: ['[name="_systemfield_name"]'],
    email: ['[name="_systemfield_email"]'],
    phone: ['[name="_systemfield_phone"]'],
    linkedin: ['[name="_systemfield_linkedin"]'],
  },
  lever: {
    fullName: ['[name="name"]'], email: ['[name="email"]'], phone: ['[name="phone"]'],
    linkedin: ['[name="urls[LinkedIn]"]'], github: ['[name="urls[GitHub]"]'],
    website: ['[name="urls[Portfolio]"]'],
  },
  workday: {
    firstName: ['[data-automation-id="legalNameSection_firstName"]'],
    lastName: ['[data-automation-id="legalNameSection_lastName"]'],
    email: ['[data-automation-id="email"]'],
    phone: ['[data-automation-id="phone-number"]'],
  },
});

/** Return a plain record or an empty record for malformed profile sections. */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Convert an approved scalar to a bounded printable field value without inventing content. */
function scalar(value, booleanAnswers = false) {
  if (booleanAnswers && typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, MAX_FIELD_CHARS);
}

/** Find the first exact alias present in the ordered profile sections. */
function pick(sections, aliases, booleanAnswers = false) {
  for (const section of sections) {
    for (const alias of aliases) {
      if (!Object.prototype.hasOwnProperty.call(section, alias)) continue;
      const value = scalar(section[alias], booleanAnswers);
      if (value) return value;
    }
  }
  return '';
}

/** Derive conventional name components only when the profile omitted explicit components. */
function nameParts(fullName) {
  const comma = fullName.split(',').map((part) => part.trim()).filter(Boolean);
  if (comma.length === 2) {
    const given = comma[1].split(/\s+/).filter(Boolean);
    return { firstName: given[0] || '', middleName: given.slice(1).join(' '), lastName: comma[0] };
  }
  const parts = fullName.split(/\s+/).filter(Boolean);
  const suffix = /^(?:jr\.?|sr\.?|i{2,3}|iv)$/i.test(parts.at(-1) || '') ? parts.pop() : '';
  if (parts.length < 2) return { firstName: parts[0] || '', middleName: '', lastName: '' };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts.at(-1), suffix };
}

/** Derive city/state only from an unambiguous comma-delimited location string. */
function locationParts(location) {
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { city: parts[0], state: parts[1] } : { city: '', state: '' };
}

/** Build ordered shallow sections from the canonical career profile and Apply overlay. */
function profileSections(careerDb, applyProfile) {
  const career = record(careerDb);
  const overlay = record(applyProfile);
  return [overlay, record(overlay.profile), record(overlay.contact), record(overlay.address),
    record(overlay.legal), record(overlay.eligibility), record(career.profile),
    record(career.contact), career];
}

/** Add one nonempty bounded value to the normalized bookmarklet payload. */
function setField(target, key, value) {
  const bounded = scalar(value);
  if (bounded) target[key] = bounded;
}

/** Apply explicit and lossless derived identity/location fields to a normalized payload. */
function addDerivedFields(target, sections) {
  const names = nameParts(target.fullName || '');
  setField(target, 'firstName', pick(sections, ['first_name', 'firstName', 'given_name', 'givenName']) || names.firstName);
  setField(target, 'middleName', pick(sections, ['middle_name', 'middleName']) || names.middleName);
  setField(target, 'lastName', pick(sections, ['last_name', 'lastName', 'family_name', 'familyName', 'surname']) || names.lastName);
  const location = pick(sections, ['location']);
  const derived = locationParts(location);
  setField(target, 'city', pick(sections, ['city', 'town']) || derived.city);
  setField(target, 'state', pick(sections, ['state', 'province', 'region']) || derived.state);
}

/** Add non-sensitive contact and employment fields explicitly present in the profile. */
function addContactFields(target, sections) {
  const aliases = {
    email: ['email', 'email_address', 'emailAddress'], phone: ['phone', 'phone_number', 'phoneNumber', 'mobile'],
    addressLine1: ['address_line_1', 'addressLine1', 'address1', 'street_address', 'streetAddress'],
    addressLine2: ['address_line_2', 'addressLine2', 'address2', 'apartment', 'suite'],
    postalCode: ['postal_code', 'postalCode', 'zip_code', 'zipCode', 'zip'], country: ['country', 'country_name', 'countryName'],
    linkedin: ['linkedin', 'linkedin_url', 'linkedinUrl'], website: ['website', 'portfolio', 'portfolio_url', 'portfolioUrl'],
    github: ['github', 'github_url', 'githubUrl'], currentCompany: ['current_company', 'currentCompany', 'current_employer'],
    currentTitle: ['current_title', 'currentTitle', 'job_title', 'jobTitle'],
  };
  for (const [key, names] of Object.entries(aliases)) setField(target, key, pick(sections, names));
}

/** Add legal answers only when the Apply Profile contains an explicit approved value. */
function addEligibilityFields(target, sections) {
  setField(target, 'workAuthorization', pick(sections, [
    'work_authorization', 'workAuthorization', 'authorized_to_work', 'authorizedToWork', 'authorized',
  ], true));
  setField(target, 'sponsorship', pick(sections, [
    'requires_sponsorship', 'requiresSponsorship', 'need_sponsorship', 'needSponsorship', 'sponsorship',
  ], true));
}

/**
 * @description Normalize only allowlisted application fields from the canonical career database
 * and optional Apply overlay. Overlay values win; absent facts remain absent.
 * @param {unknown} careerDb - Parsed career_db.json value.
 * @param {unknown} applyProfile - Parsed apply_profile.json value.
 * @returns {Record<string,string>} Bounded fields safe to embed in the offline helper.
 */
function normalizeAutofillProfile(careerDb, applyProfile) {
  const sections = profileSections(careerDb, applyProfile);
  const normalized = {};
  setField(normalized, 'fullName', pick(sections, ['full_name', 'fullName', 'legal_name', 'legalName', 'name']));
  addDerivedFields(normalized, sections);
  addContactFields(normalized, sections);
  addEligibilityFields(normalized, sections);
  const firstRole = Array.isArray(record(careerDb).roles) ? record(careerDb).roles[0] : null;
  if (firstRole) {
    setField(normalized, 'currentCompany', normalized.currentCompany || pick([record(firstRole)], ['org', 'company', 'employer']));
    setField(normalized, 'currentTitle', normalized.currentTitle || pick([record(firstRole)], ['title', 'position']));
  }
  return normalized;
}

/* Runtime helpers below are serialized into the javascript: URL. Keep them dependency-free. */
function runtimeToken(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function runtimeCompact(value) {
  return runtimeToken(value).replace(/\s+/g, '');
}

function runtimeFieldText(element) {
  const attrs = ['name', 'id', 'placeholder', 'aria-label', 'data-automation-id', 'data-testid'];
  const values = attrs.map((name) => element.getAttribute?.(name) || '');
  const labels = Array.from(element.labels || []).map((label) => label.textContent || '');
  const fieldset = element.closest?.('fieldset');
  const legend = fieldset?.querySelector?.('legend')?.textContent || '';
  return { attrs: values.map(runtimeToken), labels: [...labels, legend].map(runtimeToken) };
}

function runtimeHiddenNode(node) {
  if (!node) return false;
  if (node.hidden || node.inert || node.getAttribute?.('aria-hidden') === 'true'
      || node.hasAttribute?.('inert')) return true;
  const style = globalThis.getComputedStyle?.(node);
  if (!style) return false;
  const opacity = Number.parseFloat(style.opacity || '1');
  return style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
    || (Number.isFinite(opacity) && opacity <= 0.01);
}

function runtimeOnScreen(element) {
  const rects = element.getClientRects?.();
  if (rects && rects.length === 0) return false;
  const rect = element.getBoundingClientRect?.();
  if (!rect) return true;
  if (!(rect.width > 1 && rect.height > 1)) return false;
  const width = globalThis.innerWidth || document.documentElement?.clientWidth || 0;
  const height = globalThis.innerHeight || document.documentElement?.clientHeight || 0;
  if (!width || !height) return true;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

function runtimeVisible(element) {
  if (!element || element.disabled || element.readOnly || element.hidden) return false;
  if (['hidden', 'file', 'password', 'submit', 'button', 'checkbox', 'radio'].includes(String(element.type || '').toLowerCase())) return false;
  for (let node = element; node; node = node.parentElement) {
    if (runtimeHiddenNode(node)) return false;
  }
  return runtimeOnScreen(element);
}

function runtimeDispatch(element) {
  for (const type of ['input', 'change', 'blur']) {
    element.dispatchEvent?.(new Event(type, { bubbles: true }));
  }
}

function runtimeSelect(element, value) {
  const wanted = runtimeToken(value);
  const option = Array.from(element.options || []).find((item) => {
    const options = [item.value, item.textContent].map(runtimeToken);
    return options.includes(wanted) || options.some((candidate) => candidate.startsWith(`${wanted} `));
  });
  if (!option) return false;
  element.value = option.value;
  return true;
}

function runtimeWrite(element, value) {
  if (!runtimeVisible(element)) return 'unusable';
  if (String(element.value || '').trim()) return 'existing';
  if (String(element.tagName || '').toLowerCase() === 'select') {
    if (!runtimeSelect(element, value)) return 'unusable';
  } else {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    if (descriptor?.set) descriptor.set.call(element, value); else element.value = value;
  }
  element.style && (element.style.outline = '2px solid #00a884');
  runtimeDispatch(element);
  return 'filled';
}

function runtimeFieldScore(definition, element) {
  const text = runtimeFieldText(element);
  const autocomplete = runtimeToken(element.getAttribute?.('autocomplete') || '');
  if (definition.autocomplete.includes(autocomplete)) return 140;
  const compactAttrs = text.attrs.map(runtimeCompact);
  if (definition.attrs.some((alias) => compactAttrs.includes(alias))) return 120;
  const exactLabel = text.labels.some((label) => definition.aliases.includes(label));
  if (exactLabel) return 100;
  const included = text.labels.some((label) => definition.aliases.some((alias) => alias.length >= 6 && label.includes(alias)));
  return included ? 70 : 0;
}

function runtimeHostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function runtimeFamily(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  if (['greenhouse.io', 'greenhouse.com'].some((domain) => runtimeHostMatches(host, domain))) return 'greenhouse';
  if (runtimeHostMatches(host, 'ashbyhq.com')) return 'ashby';
  if (runtimeHostMatches(host, 'lever.co')) return 'lever';
  if (['myworkdayjobs.com', 'workday.com'].some((domain) => runtimeHostMatches(host, domain))) return 'workday';
  if (['distyl.ai', 'distyl.com'].some((domain) => runtimeHostMatches(host, domain))) return 'distyl';
  return null;
}

function runtimeDirectCandidates(selectors) {
  const candidates = [];
  for (const selector of selectors || []) {
    try { candidates.push(...document.querySelectorAll(selector)); } catch { /* static selectors */ }
  }
  return candidates;
}

function runtimeBestCandidate(definition, elements, used) {
  let best = null;
  let score = 0;
  for (const element of elements) {
    if (used.has(element) || !runtimeVisible(element)) continue;
    const candidateScore = runtimeFieldScore(definition, element);
    if (candidateScore > score) { best = element; score = candidateScore; }
  }
  return score >= 70 ? best : null;
}

function runtimeFillOne(definition, value, selectors, elements, used) {
  const direct = runtimeDirectCandidates(selectors).find((element) => !used.has(element) && runtimeVisible(element));
  const target = direct || runtimeBestCandidate(definition, elements, used);
  if (!target) return 'missing';
  const outcome = runtimeWrite(target, value);
  if (outcome !== 'unusable') used.add(target);
  return outcome;
}

function runtimeAutofill(profile, definitions, selectors, family) {
  const elements = Array.from(document.querySelectorAll('input,textarea,select'));
  const used = new WeakSet();
  const outcomes = { filled: [], existing: [], missing: [] };
  for (const definition of definitions) {
    const value = profile[definition.key];
    if (!value) { if (CORE_FIELDS.includes(definition.key)) outcomes.missing.push(definition.label); continue; }
    const outcome = runtimeFillOne(definition, value, selectors[family]?.[definition.key], elements, used);
    if (outcome === 'filled') outcomes.filled.push(definition.label);
    else if (outcome === 'existing') outcomes.existing.push(definition.label);
  }
  const site = family[0].toUpperCase() + family.slice(1);
  alert(`OSHAL offline autofill (${site}): filled ${outcomes.filled.length} field(s). `
    + 'Review every answer. OSHAL did not directly upload, click, navigate, call the network, or submit. '
    + 'The page can react to field-change events, so watch it and verify the final state.');
  return outcomes;
}

const RUNTIME_FUNCTIONS = [runtimeToken, runtimeCompact, runtimeFieldText, runtimeHiddenNode,
  runtimeOnScreen, runtimeVisible,
  runtimeDispatch, runtimeSelect, runtimeWrite, runtimeFieldScore, runtimeFamily,
  runtimeHostMatches, runtimeDirectCandidates, runtimeBestCandidate, runtimeFillOne, runtimeAutofill];

/** Encode JSON as inert base64 so profile punctuation can never become bookmarklet source. */
function encodedPayload(profile) {
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64');
}

/**
 * @description Generate a self-contained javascript: URL that needs no OSHAL service at execution
 * time. Its own code has no upload, navigation, click, network, or submit operation; supported
 * pages receive normal field-change events and may run their own handlers in response.
 * @param {Record<string,string>} profile - Allowlisted normalized applicant fields.
 * @returns {string} Bookmark URL ready to copy into the user's browser.
 */
function createAutofillBookmarklet(profile) {
  const fields = normalizeAutofillProfile({}, profile);
  if (!Object.keys(fields).length) throw new Error('Apply Profile has no supported autofill fields');
  const functions = RUNTIME_FUNCTIONS.map((fn) => fn.toString()).join(';');
  const definitions = JSON.stringify(FIELD_DEFINITIONS);
  const selectors = JSON.stringify(DIRECT_SELECTORS);
  const coreFields = JSON.stringify(CORE_FIELDS);
  const payload = encodedPayload(fields);
  return `javascript:(()=>{const CORE_FIELDS=${coreFields};${functions};const family=runtimeFamily(globalThis.location?.hostname);if(!family){alert('OSHAL offline autofill refused this unrecognized site. No profile data was decoded and no fields were changed.');return;}const bytes=Uint8Array.from(atob('${payload}'),c=>c.charCodeAt(0));const profile=JSON.parse(new TextDecoder().decode(bytes));void runtimeAutofill(profile,${definitions},${selectors},family);})()`;
}

module.exports = { CORE_FIELDS, FIELD_DEFINITIONS, createAutofillBookmarklet, normalizeAutofillProfile };
