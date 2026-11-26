/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.2 curated story library, bounded shape/sceneCount validation, storyboard scene splitting, and made-status reconciliation.
 */
import { randomUUID } from 'node:crypto';
import { fail } from './vendor/source-project-store.mjs';

export const STORY_SHAPES = Object.freeze(['16:9', '9:16', '1:1']);
export const MIN_SCENES = 1;
export const MAX_SCENES = 12;
export const DEFAULT_SCENES = 4;
const MADE_STATUSES = new Set(['done', 'queued', 'running', 'draft_recorded']);

const SHAPE_ALIASES = Object.freeze({
  '16:9': '16:9',
  landscape: '16:9',
  '9:16': '9:16',
  portrait: '9:16',
  vertical: '9:16',
  '1:1': '1:1',
  square: '1:1',
});

export const STORY_LIBRARY = Object.freeze([
  Object.freeze({
    id: 'tortoise-and-hare',
    slug: 'tortoise-and-hare',
    title: 'The Tortoise and the Hare',
    category: 'fable',
    summary: 'A boastful hare sprints ahead and naps while a steady tortoise keeps walking all the way to the finish line.',
    script: 'A speedy hare teased a quiet tortoise for taking small steps. They lined up at the meadow gate to race across the valley. Halfway through, the hare felt sure of winning and curled up under a shady oak for a nap. Step by steady step, the tortoise passed the sleeping runner and crossed the ribbon first.',
    sceneCount: 4,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'raining-cats-and-dogs',
    slug: 'raining-cats-and-dogs',
    title: 'Raining Cats and Dogs',
    category: 'saying',
    summary: 'A playful animated tale explaining the classic idiom for a sudden, roaring downpour.',
    script: 'Dark clouds rolled over cobblestone streets as umbrellas popped open like bright mushrooms. A curious child asked why Grandma called the storm raining cats and dogs. In old tales, heavy showers poured so loudly off rooftops that everyone pictured playful kittens and puppies tumbling from the sky. When the sun returned, shiny puddles reflected rainbow clouds.',
    sceneCount: 4,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'fox-and-grapes',
    slug: 'fox-and-grapes',
    title: 'The Fox and the Grapes',
    category: 'fable',
    summary: 'A hungry fox leaps for ripe purple grapes just out of reach, then insists they must be sour.',
    script: 'On a warm autumn afternoon, a clever fox spotted clusters of glossy purple grapes hanging high on a garden trellis. He stretched, leaped, and took a running jump, yet every vine stayed an inch above his paws. Catching his breath, the fox trotted down the lane muttering that those grapes were probably sour anyway.',
    sceneCount: 4,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'lion-and-mouse',
    slug: 'lion-and-mouse',
    title: 'The Lion and the Mouse',
    category: 'fable',
    summary: 'A tiny mouse repays a mighty lion’s kindness by chewing through a hunter’s rope net.',
    script: 'A little field mouse accidentally scampered across the nose of a sleeping lion. The great lion laughed at the mouse’s promise to help him someday, yet kindly let the tiny creature go. Weeks later, the lion was tangled in thick ropes. Hearing his roar, the mouse raced back and nibbled every knot free.',
    sceneCount: 4,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'boy-who-cried-wolf',
    slug: 'boy-who-cried-wolf',
    title: 'The Boy Who Cried Wolf',
    category: 'fable',
    summary: 'A bored shepherd boy plays false alarms on the hillside until neighbors stop believing his warning.',
    script: 'Watching sheep on a quiet hillside, a young shepherd shouted wolf just to see the villagers come running. Twice he laughed as neighbors hurried up the path to find calm sheep grazing. When a real wolf finally crept out of the pines, nobody believed his call, teaching him how precious trust truly is.',
    sceneCount: 5,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'three-little-pigs',
    slug: 'three-little-pigs',
    title: 'The Three Little Pigs',
    category: 'fairytale',
    summary: 'Three siblings build houses of straw, sticks, and sturdy brick before a blustery wolf arrives.',
    script: 'Three cheerful pigs set out to build cozy homes along a sunny lane. The first stacked golden straw and the second tied birch sticks, while the third carefully laid red bricks and mortar. When a huffing wolf blew down the fragile cottages, all three siblings stayed safe and warm inside the strong brick house.',
    sceneCount: 5,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'goldilocks-and-three-bears',
    slug: 'goldilocks-and-three-bears',
    title: 'Goldilocks and the Three Bears',
    category: 'fairytale',
    summary: 'A curious traveler discovers three bowls of porridge, three chairs, and three beds in a forest cottage.',
    script: 'Wandering through sunlit woods, Goldilocks found a tidy cottage belonging to three bears out for a morning walk. She tasted porridge that was too hot, too cold, and just right, then tested three chairs and drifted asleep in the smallest bed. When the bears returned, she apologized and hurried safely home.',
    sceneCount: 6,
    defaultShape: '16:9',
  }),
  Object.freeze({
    id: 'early-bird-gets-the-worm',
    slug: 'early-bird-gets-the-worm',
    title: 'The Early Bird Gets the Worm',
    category: 'saying',
    summary: 'A bright morning robin wakes at sunrise and discovers the garden’s best breakfast before the lawn warms up.',
    script: 'Before the porch lights even clicked off, a small robin hopped onto the dewy grass as pale gold sunlight touched the trees. While sleepy sparrows still tucked under the eaves, the early robin spotted fresh earthworms peeking out after the night mist. Starting early turned a quiet morning into a cheerful feast.',
    sceneCount: 4,
    defaultShape: '9:16',
  }),
]);

export function normalizeShape(value, fallback = '16:9') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') fail(400, 'invalid_story_shape');
  const key = value.trim().toLowerCase();
  const mapped = SHAPE_ALIASES[key];
  if (!mapped) fail(400, 'invalid_story_shape');
  return mapped;
}

export function shapeToOrientation(shape) {
  if (shape === '9:16') return 'Portrait';
  if (shape === '1:1') return 'Square';
  return 'Landscape';
}

export function normalizeSceneCount(value, fallback = DEFAULT_SCENES) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < MIN_SCENES || value > MAX_SCENES) {
    fail(400, 'invalid_scene_count');
  }
  return value;
}

export function findLibraryStory(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const needle = ref.trim().toLowerCase();
  return STORY_LIBRARY.find(item => item.slug === needle || item.title.toLowerCase() === needle) || null;
}

function matchJobToStory(job, story) {
  const slug = String(job.storySlug || '').trim().toLowerCase();
  if (slug && slug === story.slug) return true;
  const title = String(job.title || '').replace(/^story:\s*/i, '').trim().toLowerCase();
  return title === story.slug || title === story.title.toLowerCase();
}

export function decorateLibrary(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const stories = STORY_LIBRARY.map(story => {
    const matched = list.filter(job => matchJobToStory(job, story));
    const latest = matched[0] || null;
    const made = matched.some(job => MADE_STATUSES.has(job.status));
    return {
      ...story,
      made,
      lastJobStatus: latest ? latest.status : null,
      lastJobId: latest ? latest.id : null,
    };
  });
  const nextStory = stories.find(item => !item.made) || stories[0] || null;
  return { stories, nextStory };
}

export function buildStoryboardScenes(title, script, sceneCount) {
  const count = normalizeSceneCount(sceneCount, DEFAULT_SCENES);
  const parts = String(script || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = String(script || '').trim().split(/\s+/).filter(Boolean);
  const scenes = [];
  for (let i = 0; i < count; i += 1) {
    let text = '';
    if (parts.length >= count) {
      const start = Math.floor((i * parts.length) / count);
      const end = Math.floor(((i + 1) * parts.length) / count);
      text = parts.slice(start, Math.max(start + 1, end)).join(' ');
    } else if (words.length) {
      const start = Math.floor((i * words.length) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * words.length) / count));
      text = words.slice(start, end).join(' ');
    }
    scenes.push({
      id: randomUUID(),
      title: `Scene ${i + 1}: ${String(title || 'Story').slice(0, 80)}`.slice(0, 120),
      text: (text || String(script || '')).slice(0, 2000),
      duration: 6,
    });
  }
  return scenes;
}
