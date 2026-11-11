/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The routing words twelve packages declared in PR #823 (backlog P4-16), scored the way the kernel scores them before any model call, over every manifest in this store (scripts/jarvis-routing.mjs). Each request a package's words were added for reaches that package and the bot the kernel's routing suite expects, and each request its change log says stays with another package stays there. Review of PR #823: reverting all twelve packages' words turned nothing red, because the scoring lived only in the kernel and the kernel's CI pins an older store.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Eats 1.5.4: food requests reach Eats by its own words, and a request to place a stock or shopping order never reaches it, decided or handed off. Eats 1.5.3's "sushi place" and five more "... place" phrases made the bare word "place" an Eats keyword, so with "order" from "order food" Eats tied Intelligent Trades on "Place a buy order for 5 shares of Tesla" and took the hand-off of "Place a market order for NVDA", "Place an Amazon order for batteries" and "Place my grocery order" (review of PR #823).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | J-3 & J-6: SmartThings device, Family Hub refrigerator, and samsungce.viewInside interior camera requests reach Smart Home (home-bot) and never Camera Ops (camera).
 *
 * Plain `node --test` suite; js-yaml comes from the store toolchain. The private store's packages (Marquee among
 * them) are not here, so a case is only pinned where its outcome is the same with them; the kernel's own suite
 * (crates/api/src/jarvis_routing_suite_tests.rs over both stores) stays the authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, handoffOwner, leaderboard, loadCandidates } from './jarvis-routing.mjs';

const candidates = loadCandidates();

/** The kernel hands `request` to `expected` before any model call (a Named or Several claim), to `bot` when named. */
function reaches(request, expected, bot) {
  const decided = decide(candidates, request);
  const seen = `${JSON.stringify(request)} -> ${decided.owner || decided.why}; best: ${leaderboard(candidates, request)}`;
  assert.equal(decided.owner, expected, seen);
  if (bot) assert.equal(decided.bot, bot, seen);
}

/** Neither the kernel's own decision nor the model's hand-off of `request` goes to `unwanted`. */
function staysAwayFrom(request, unwanted) {
  const decided = decide(candidates, request);
  const seen = `${JSON.stringify(request)}; best: ${leaderboard(candidates, request)}`;
  assert.notEqual(decided.owner, unwanted, `decided for ${unwanted}: ${seen}`);
  assert.notEqual(handoffOwner(candidates, request), unwanted, `the hand-off goes to ${unwanted}: ${seen}`);
}

test('Social is reached by a LinkedIn or Facebook post and by publish; a book and a launch plan stay elsewhere', () => {
  reaches('Draft a LinkedIn post about our product launch', 'social', 'social-writer');
  reaches("Publish this to X and Facebook at the same time: 'Big news coming Monday.'", 'social', 'social-writer');
  reaches('Publish the book layout', 'publishing-studio');
  reaches('Plan our product launch', 'marketing-engine');
});

test('Game Show keeps Family Feud and fast money, and a deck for the board of directors is not a game', () => {
  staysAwayFrom('Send the Q3 deck to the board', 'game-show');
  reaches("Let's play Family Feud with the AI host", 'game-show', 'game-show-host');
  reaches('Start fast money', 'game-show');
});

test('Spotify is reached by play and a genre; a game and a TV episode stay with their own applications', () => {
  reaches('Play some jazz', 'spotify', 'spotify-concierge');
  reaches('Play my Discover Weekly playlist', 'spotify', 'spotify-concierge');
  reaches("Let's play Family Feud", 'game-show');
  reaches('Play the next episode on the Fire TV', 'phone-control');
});

test('Portrait Studio is reached by a headshot from a photo', () => {
  reaches('Make a professional headshot from this photo of me', 'portrait-studio', 'portrait-artist');
});

test('Ambient Recall is reached by what someone said in a meeting', () => {
  reaches("What did Dave say about the budget in yesterday's meeting?", 'person-model', 'ambient-recall-concierge');
});

test('Calendar is reached by a meeting to prepare for; a meeting to schedule stays with Intelligent Communication', () => {
  reaches('Prepare me for my 10am meeting with the Hendersons', 'calendar', 'calendar-concierge');
  reaches('Schedule a meeting with Karen tomorrow', 'email-summarizer');
});

test('Travel is reached by a fare watch; a ride fare stays with Get a Ride', () => {
  reaches('Watch the DEN–PNS route and tell me when the fare drops', 'travel', 'travel-concierge');
  reaches("What's the fare to downtown in an Uber?", 'rides');
});

test('Phone & Device Control is reached by the device a person names', () => {
  reaches('Connect my Android phone so I can control it from here', 'phone-control', 'device-concierge');
  reaches('Register my iPad as a device I can drive from Jarvis', 'phone-control', 'device-concierge');
});

test('Smart Home is reached by a door to lock, SmartThings refrigerator inspection, and View Inside camera queries (never Camera Ops)', () => {
  reaches('Lock the front door', 'home', 'home-bot');
  for (const request of [
    'Check my SmartThings devices and see if the refrigerator has an interior camera',
    'Inspect my Samsung Family Hub refrigerator camera with View Inside',
    'Show me the view inside my refrigerator from SmartThings',
    'Does my refrigerator have samsungce.viewInside in SmartThings?',
  ]) {
    reaches(request, 'home', 'home-bot');
    staysAwayFrom(request, 'camera');
  }
});

test('Kalshi is reached by prediction markets in the plural, and Sports Edge by tonight\'s game', () => {
  reaches('Which prediction markets have an edge tonight?', 'kalshi', 'kalshi-quant');
  reaches('Is there an edge on the Lakers game tonight?', 'sports-edge', 'sports-quant');
  staysAwayFrom('What should I watch tonight?', 'sports-edge');
});

test('Eats is reached by food, and never by the word "place" in a stock or shopping order', () => {
  reaches("I'm hungry, order sushi for dinner", 'eats', 'eats-concierge');
  reaches('What restaurants near me deliver tacos?', 'eats', 'eats-concierge');
  reaches('Place a buy order for 5 shares of Tesla', 'intelligent-trades');
  const market = 'Place a market order for NVDA';
  assert.equal(handoffOwner(candidates, market), 'intelligent-trades', `${market}; best: ${leaderboard(candidates, market)}`);
  for (const request of [
    'Place a limit order for 10 shares of AAPL',
    'Place an Amazon order for batteries',
    'Place an Instacart order for milk and eggs',
    'Place my grocery order',
    'Find a place to stay in Denver',
    'Where is a good place to park downtown?',
  ]) staysAwayFrom(request, 'eats');
});
