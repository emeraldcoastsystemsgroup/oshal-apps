/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the native Ambient Recall workspace (/api/person-model/app) and bounded UI assets inside the caller's authenticated package mount.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add Continuous Profile Learning and Eavesdrop Business Cards endpoints (GET/POST /api/person-model/profile-cards, GET/POST /api/person-model/recall) backed by OSHAL_PACKAGE_DATA_DIR.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { Router } = express;

const ALLOWED_QUERIES = new Set(['v', 'audience', 'tab', 'profile']);
const VALID_TABS = new Set(['recall', 'cards', 'asks', 'people', 'trends']);
const ASSETS = new Map([
  ['person-model.css', { file: 'person-model.css', type: 'text/css; charset=utf-8' }],
  ['person-model.js', { file: 'person-model.js', type: 'text/javascript; charset=utf-8' }],
]);

function resolvePackageRoot(ctx) {
  if (ctx && typeof ctx.appPackageDir === 'string' && ctx.appPackageDir.trim()) {
    return fs.realpathSync(ctx.appPackageDir);
  }
  return fs.realpathSync(path.resolve(import.meta.dirname, '..'));
}

function resolveDataFile(ctx) {
  const baseDir = (ctx && typeof ctx.dataDir === 'string' && ctx.dataDir.trim())
    || (process.env.OSHAL_PACKAGE_DATA_DIR && process.env.OSHAL_PACKAGE_DATA_DIR.trim())
    || path.join(os.tmpdir(), 'oshal-person-model-data');
  fs.mkdirSync(baseDir, { recursive: true });
  return path.join(baseDir, 'person-model-cards.json');
}

function readToolAsset(packageRoot, fileName) {
  const toolsDir = path.join(packageRoot, 'tools');
  const resolved = fs.realpathSync(path.join(toolsDir, fileName));
  const rel = path.relative(toolsDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('asset escapes tools root');
  }
  return fs.readFileSync(resolved, 'utf8');
}

function validQuery(query) {
  const keys = Object.keys(query || {});
  if (keys.some((k) => !ALLOWED_QUERIES.has(k))) return false;
  if (query?.tab !== undefined && !VALID_TABS.has(String(query.tab))) {
    return false;
  }
  if (query?.profile !== undefined && (typeof query.profile !== 'string' || query.profile.length > 128)) {
    return false;
  }
  return true;
}

function defaultSelfProfile() {
  const stamp = '2026-11-08T06:00:00Z';
  const fullName = process.env.OSHAL_OWNER_FULL_NAME || 'Workspace Owner';
  const address = process.env.OSHAL_OWNER_ADDRESS || '4399 Old Bayou Trail, Destin, FL 32541';
  const email = process.env.OSHAL_OWNER_EMAIL || 'maintainer@emeraldcoastsystemsgroup.com';
  const phone = process.env.OSHAL_OWNER_PHONE || '(850) 555-0142';
  return {
    profileId: 'self-owner',
    fullName,
    address,
    email,
    phone,
    role: 'Founder / Program Manager & SRE Lead',
    organization: 'Emerald Coast Systems Group',
    clearance: 'Verified Workspace Operator',
    education: 'BS Computer Science & Computer Engineering · MBA',
    continuousLearningEnabled: true,
    updatedAt: stamp,
    facts: [
      { id: 'fact-address', category: 'identity', text: `Primary residence and mailing address: ${address}`, source: 'continuous-learning', learnedAt: stamp },
      { id: 'fact-contact', category: 'contact', text: `Primary contact: ${email} · ${phone}`, source: 'continuous-learning', learnedAt: stamp },
      { id: 'fact-org', category: 'work', text: 'Founder of Emerald Coast Systems Group (Verified Workspace Operator)', source: 'continuous-learning', learnedAt: stamp },
      { id: 'fact-dev', category: 'preference', text: 'Prefers high-effort reasoning in Blue Developer mode with 30-minute thinking ceiling and instant <100ms Blue/Green promotion', source: 'continuous-learning', learnedAt: stamp },
      { id: 'fact-invariant', category: 'architecture', text: 'Core platform invariant: Every workflow is a ticket, and every ticket is a workflow', source: 'continuous-learning', learnedAt: stamp },
      { id: 'fact-home', category: 'household', text: 'Smart Home devices include Samsung Family Hub refrigerator (View Inside optical shelf assessment) and Living Room Fire TV (192.168.1.138:5555)', source: 'continuous-learning', learnedAt: stamp },
    ],
  };
}

function defaultBusinessCards() {
  return [
    {
      cardId: 'card-ella',
      profileId: 'voice-ella',
      name: 'Ella',
      role: 'Family · Student Athlete',
      organization: 'Destin Household',
      email: '',
      phone: '',
      relationship: 'Family',
      source: 'eavesdrop',
      utterances: 14,
      lastHeardAt: '2026-11-07T21:15:00Z',
      topics: ['volleyball', 'school trip', 'weekend practice', 'grocery snacks'],
      openCommitments: ['Confirm Saturday volleyball tournament carpool time', 'Sign school trip permission slip'],
      recentQuotes: [{ quote: 'Do we have practice before the volleyball match on Saturday?', capturedAt: '2026-11-07T21:15:00Z' }],
      notes: 'Built automatically from household ambient voice diarization and transcript topics.',
      updatedAt: '2026-11-07T21:15:00Z',
    },
    {
      cardId: 'card-sam',
      profileId: 'voice-sam',
      name: 'Sam',
      role: 'Family · Household Member',
      organization: 'Destin Household',
      email: '',
      phone: '',
      relationship: 'Family',
      source: 'eavesdrop',
      utterances: 9,
      lastHeardAt: '2026-11-07T19:40:00Z',
      topics: ['school trip', 'movie night', 'living room fire tv'],
      openCommitments: ['Check itinerary for the upcoming school trip'],
      recentQuotes: [{ quote: 'Can we put the game show on the Living Room Fire TV tonight?', capturedAt: '2026-11-07T19:40:00Z' }],
      notes: 'Built automatically from household ambient voice diarization and transcript topics.',
      updatedAt: '2026-11-07T19:40:00Z',
    },
    {
      cardId: 'card-ops-partner',
      profileId: 'voice-ops-partner',
      name: 'Defense Capture & Program Partner',
      role: 'Capture Lead · Federal Programs',
      organization: 'Agentic Federal / Partner Network',
      email: 'maintainer@emeraldcoastsystemsgroup.com',
      phone: '(678) 343-4240',
      relationship: 'Colleague',
      source: 'eavesdrop',
      utterances: 22,
      lastHeardAt: '2026-11-07T18:05:00Z',
      topics: ['federal proposals', 'swarm deployment', 'trial consent perimeter', 'smart home automation'],
      openCommitments: ['Review 30-day SaaS trial onboarding flow on trial.oswarm.ai'],
      recentQuotes: [{ quote: 'Every workflow is a ticket, and every ticket is a workflow across the swarm.', capturedAt: '2026-11-07T18:05:00Z' }],
      notes: 'Synthesized from engineering and program review transcripts.',
      updatedAt: '2026-11-07T18:05:00Z',
    },
  ];
}

function loadStore(dataFile) {
  try {
    if (fs.existsSync(dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.selfProfile && Array.isArray(parsed.cards)) {
        return parsed;
      }
    }
  } catch {
    // Fall back to fresh default store if corrupted
  }
  const initial = { selfProfile: defaultSelfProfile(), cards: defaultBusinessCards() };
  saveStore(dataFile, initial);
  return initial;
}

function saveStore(dataFile, store) {
  const tmpFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpFile, dataFile);
}

function parseListInput(val) {
  if (Array.isArray(val)) {
    return val.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof val === 'string' && val.trim()) {
    return val.split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function normalizeQuotes(val, nowIso) {
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'string'
        ? { quote: item.trim(), capturedAt: nowIso }
        : { quote: String(item?.quote || '').trim(), capturedAt: item?.capturedAt || nowIso }))
      .filter((q) => q.quote);
  }
  if (typeof val === 'string' && val.trim()) {
    return [{ quote: val.trim(), capturedAt: nowIso }];
  }
  return [];
}

function applyTeachFact(store, body, nowIso) {
  const text = String(body.fact || body.text || '').trim();
  if (!text) return { error: 'fact_required' };
  const category = String(body.category || 'learned').trim() || 'learned';
  const existing = store.selfProfile.facts.find((f) => f.text.toLowerCase() === text.toLowerCase());
  if (existing) {
    existing.category = category;
    existing.learnedAt = nowIso;
  } else {
    const id = `fact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    store.selfProfile.facts.unshift({ id, category, text, source: body.source || 'continuous-learning', learnedAt: nowIso });
  }
  store.selfProfile.updatedAt = nowIso;
  return { ok: true, action: 'teach_fact' };
}

function applyDeleteFact(store, body, nowIso) {
  const factId = String(body.factId || body.id || '').trim();
  const text = String(body.fact || body.text || '').trim().toLowerCase();
  store.selfProfile.facts = store.selfProfile.facts.filter((f) => {
    if (factId && f.id === factId) return false;
    if (text && f.text.toLowerCase() === text) return false;
    return true;
  });
  store.selfProfile.updatedAt = nowIso;
  return { ok: true, action: 'delete_fact' };
}

function applyUpdateSelf(store, body, nowIso) {
  const src = body.selfProfile && typeof body.selfProfile === 'object' ? body.selfProfile : body;
  const fields = ['fullName', 'address', 'email', 'phone', 'role', 'organization', 'clearance', 'education'];
  for (const key of fields) {
    if (typeof src[key] === 'string' && src[key].trim()) {
      store.selfProfile[key] = src[key].trim();
    }
  }
  if (typeof src.continuousLearningEnabled === 'boolean') {
    store.selfProfile.continuousLearningEnabled = src.continuousLearningEnabled;
  }
  const addrFact = store.selfProfile.facts.find((f) => f.id === 'fact-address');
  if (addrFact && store.selfProfile.address) {
    addrFact.text = `Primary residence and mailing address: ${store.selfProfile.address}`;
  }
  store.selfProfile.updatedAt = nowIso;
  return { ok: true, action: 'update_self' };
}

function applyUpsertCard(store, body, nowIso) {
  const src = body.card && typeof body.card === 'object' ? body.card : body;
  const name = String(src.name || src.personLabel || '').trim();
  if (!name) return { error: 'card_name_required' };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  const cardId = String(src.cardId || '').trim() || `card-${slug}`;
  let card = store.cards.find((c) => c.cardId === cardId || c.name.toLowerCase() === name.toLowerCase());
  if (!card) {
    card = {
      cardId,
      profileId: String(src.profileId || `voice-${slug}`),
      name,
      role: '',
      organization: '',
      email: '',
      phone: '',
      relationship: 'Contact',
      source: String(src.source || 'eavesdrop'),
      utterances: 1,
      lastHeardAt: nowIso,
      topics: [],
      openCommitments: [],
      recentQuotes: [],
      notes: '',
      updatedAt: nowIso,
    };
    store.cards.unshift(card);
  }
  updateCardFields(card, src, nowIso);
  return { ok: true, action: 'upsert_card', card };
}

function updateCardFields(card, src, nowIso) {
  if (src.name) card.name = String(src.name).trim();
  for (const k of ['role', 'organization', 'email', 'phone', 'relationship', 'source', 'notes']) {
    if (typeof src[k] === 'string') card[k] = src[k].trim();
  }
  if (Number.isFinite(Number(src.utterances))) card.utterances = Number(src.utterances);
  const topics = parseListInput(src.topics);
  if (topics.length) card.topics = Array.from(new Set([...topics, ...(card.topics || [])]));
  const commitments = parseListInput(src.openCommitments ?? src.commitments);
  if (commitments.length) card.openCommitments = Array.from(new Set([...commitments, ...(card.openCommitments || [])]));
  const quotes = normalizeQuotes(src.recentQuotes ?? src.quote, nowIso);
  if (quotes.length) card.recentQuotes = [...quotes, ...(card.recentQuotes || [])].slice(0, 6);
  card.lastHeardAt = src.lastHeardAt || nowIso;
  card.updatedAt = nowIso;
}

function applyDeleteCard(store, body) {
  const cardId = String(body.cardId || '').trim();
  const name = String(body.name || '').trim().toLowerCase();
  store.cards = store.cards.filter((c) => {
    if (cardId && c.cardId === cardId) return false;
    if (name && c.name.toLowerCase() === name) return false;
    return true;
  });
  return { ok: true, action: 'delete_card' };
}

function inferProfileAction(body) {
  if (typeof body.action === 'string' && body.action.trim()) return body.action.trim();
  if (body.fact || body.text) return 'teach_fact';
  if (body.card || body.name || body.personLabel) return 'upsert_card';
  if (body.selfProfile || body.fullName || body.address || body.clearance) return 'update_self';
  return 'update_self';
}

function buildStoreStats(store) {
  return {
    learnedFactsCount: Array.isArray(store.selfProfile?.facts) ? store.selfProfile.facts.length : 0,
    businessCardsCount: Array.isArray(store.cards) ? store.cards.length : 0,
    continuousLearningEnabled: Boolean(store.selfProfile?.continuousLearningEnabled),
    updatedAt: store.selfProfile?.updatedAt || new Date().toISOString(),
  };
}

function runRecallSearch(store, rawQuery) {
  const q = String(rawQuery || '').trim();
  const tokens = q.toLowerCase().split(/[^a-z0-9@._-]+/).filter((t) => t.length >= 2);
  const stopWords = new Set(['what', 'who', 'where', 'when', 'how', 'many', 'times', 'did', 'has', 'have', 'the', 'and', 'for', 'about', 'tell', 'show', 'can', 'you']);
  const activeTokens = tokens.filter((t) => !stopWords.has(t));
  const askSelf = /\b(my|me|i|roger|address|home|live|phone|email|clearance|profile|who am i)\b/i.test(q);
  const selfBlob = JSON.stringify(store.selfProfile).toLowerCase();
  const selfMatches = askSelf || activeTokens.some((t) => selfBlob.includes(t))
    ? store.selfProfile.facts.filter((f) => askSelf || activeTokens.some((t) => f.text.toLowerCase().includes(t) || f.category.toLowerCase().includes(t)))
    : [];
  const cardMatches = store.cards.filter((card) => {
    const blob = JSON.stringify(card).toLowerCase();
    return activeTokens.length ? activeTokens.some((t) => blob.includes(t)) : true;
  });
  const summary = formatRecallSummary(store.selfProfile, selfMatches, cardMatches, q);
  return {
    ok: true,
    query: q,
    summary,
    selfProfile: store.selfProfile,
    selfMatches,
    cardMatches,
    totalMatches: selfMatches.length + cardMatches.length,
  };
}

function formatRecallSummary(selfProfile, selfMatches, cardMatches, query) {
  const parts = [];
  if (selfMatches.length || /\b(my|me|i|roger|address|who am i|profile)\b/i.test(query)) {
    parts.push(`${selfProfile.fullName} (${selfProfile.role}, ${selfProfile.organization}) · Address: ${selfProfile.address} · Contact: ${selfProfile.email}, ${selfProfile.phone}.`);
  }
  if (cardMatches.length) {
    const labels = cardMatches.map((c) => `${c.name} (${c.role || c.relationship || 'Contact'}: ${(c.topics || []).slice(0, 3).join(', ') || 'no topics yet'})`);
    parts.push(`Matching Business Cards (${cardMatches.length}): ${labels.join('; ')}.`);
  }
  if (!parts.length) {
    parts.push(`No learned profile facts or business cards matched "${query}".`);
  }
  return parts.join(' ');
}

export function createPersonModelSurfaceRoutes(ctx = {}) {
  const router = Router();
  const packageRoot = resolvePackageRoot(ctx);
  const dataFile = resolveDataFile(ctx);

  router.use(express.json({ limit: '256kb' }));

  const serveApp = (req, res) => {
    if (!validQuery(req.query)) {
      res.status(400).json({ error: 'ambient_recall_invalid_query' });
      return;
    }
    const html = readToolAsset(packageRoot, 'person-model.html');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('text/html; charset=utf-8').send(html);
  };

  router.get('/', serveApp);
  router.get('/app', serveApp);

  router.get('/ui/:asset', (req, res) => {
    const item = ASSETS.get(String(req.params?.asset || ''));
    if (!item) {
      res.status(404).json({ error: 'ambient_recall_asset_not_found' });
      return;
    }
    const content = readToolAsset(packageRoot, item.file);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(item.type).send(content);
  });

  router.get('/profile-cards', (req, res) => {
    const store = loadStore(dataFile);
    const q = String(req.query?.q || '').trim().toLowerCase();
    const cards = q
      ? store.cards.filter((c) => JSON.stringify(c).toLowerCase().includes(q))
      : store.cards;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, selfProfile: store.selfProfile, cards, stats: buildStoreStats(store) });
  });

  router.post('/profile-cards', (req, res) => {
    const store = loadStore(dataFile);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = inferProfileAction(body);
    const nowIso = new Date().toISOString();
    let outcome;
    if (action === 'teach_fact') outcome = applyTeachFact(store, body, nowIso);
    else if (action === 'delete_fact') outcome = applyDeleteFact(store, body, nowIso);
    else if (action === 'update_self') outcome = applyUpdateSelf(store, body, nowIso);
    else if (action === 'upsert_card') outcome = applyUpsertCard(store, body, nowIso);
    else if (action === 'delete_card') outcome = applyDeleteCard(store, body);
    else outcome = { error: 'unsupported_profile_action' };
    if (outcome.error) {
      res.status(400).json({ ok: false, error: outcome.error });
      return;
    }
    saveStore(dataFile, store);
    res.json({ ...outcome, selfProfile: store.selfProfile, cards: store.cards, stats: buildStoreStats(store) });
  });

  const handleRecall = (req, res) => {
    const store = loadStore(dataFile);
    const q = req.body?.q ?? req.body?.query ?? req.query?.q ?? req.query?.query ?? '';
    res.json(runRecallSearch(store, q));
  };

  router.get('/recall', handleRecall);
  router.post('/recall', handleRecall);

  return router;
}
