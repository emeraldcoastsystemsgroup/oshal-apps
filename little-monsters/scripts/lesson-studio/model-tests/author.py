#!/usr/bin/env python3
"""Has a language model write lesson scripts and repairs them against the studio's own checks.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Lesson-writing test for any OpenAI-compatible model: the model gets the studio guide, the stage code, the teachers, two finished lessons and the catalog entry; every draft is checked (house rules, a Kokoro rehearsal take, a build on the real stage, the layout audit) and the problems go back to the model for up to N rounds. Used on 2026-11-02 to answer whether the local model can write lessons (docs/lesson-studio-local-models.md)

Usage:
  python3 author.py --model bot-fast --endpoint http://127.0.0.1:8000/v1 [--think] \\
      --targets percent,transitions --rounds 5 --parallel 2 --out /tmp/lesson-model-runs

Each target gets a private studio under --out (links to the stage, art and fonts; its own lessons and cache), so
nothing in this checkout changes. Every round is saved: the reply, the script, the checks and the feedback.
Needs LESSON_PYTHON (a Python with numpy and faster-whisper, for narrate.py) and Playwright with Chromium
(PLAYWRIGHT_DIR, default: the store toolchain).
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent
CATALOG = STUDIO.parent.parent / 'data/test-prep/catalog.json'
PY = os.environ.get('LESSON_PYTHON', 'python3')
os.environ.setdefault('PLAYWRIGHT_DIR', str(STUDIO.parent.parent.parent / 'scripts/toolchain/node_modules/playwright'))
TEACHER_OF = {'math': 'pinky', 'english': 'bluebold', 'reading': 'tealy', 'science': 'sprout'}
EXAMPLES = ['linear', 'agreement']
LOCK = threading.Lock()


def log(msg):
    """Print one progress line; several targets run at once."""
    with LOCK:
        print(time.strftime('%H:%M:%S'), msg, flush=True)


def make_studio(root, target):
    """A private copy of the studio for one target: links to the art, its own lessons and cache."""
    studio = root / f'studio-{target}'
    if studio.exists():
        shutil.rmtree(studio)
    (studio / 'lessons').mkdir(parents=True)
    for name in ['stage', 'art', 'fonts']:
        (studio / name).symlink_to(STUDIO / name)
    for name in ['narrate.py', 'mix.py', 'render.mjs', 'look.mjs', 'lessons-json.cjs']:
        shutil.copy2(STUDIO / name, studio / name)
    shutil.copy2(STUDIO / 'lessons/teachers.js', studio / 'lessons/teachers.js')
    return studio


def task_text(target, lesson, teacher):
    """The assignment and its rules, each of which the checks enforce."""
    content = {k: lesson[k] for k in ['title', 'learn', 'example', 'shortcut', 'caution', 'mistake']}
    math_rule = ("- This is a math lesson: list every number the lesson says or writes in `facts: [['50 * 0.8', 40], ...]` as JavaScript expressions with their values. They are checked.\n"
                 if lesson['domain'] == 'math' else '- This lesson needs no `facts` list.\n')
    return f"""# Your task

Write the lesson script `lessons/{target}.js` for the Study Lab lesson below. A Little Monster teaches it on video:
the monster speaks every `say` line, and the board does what `run` tells it on the spoken words.

Lesson (from the app's catalog; the video must teach all of it, correctly):
```json
{json.dumps(content, indent=1, ensure_ascii=False)}
```
Subject: {lesson['domain']}. Teacher: `{teacher}` ({json.dumps(teacher.capitalize())}). Lesson id: `{target}`.

Rules (each one is checked automatically; a failing script is sent back to you):
- Return ONE complete JavaScript file in a single ```js block, in the same shape as the finished lessons: the CHANGE LOG header (author maintainer@emeraldcoastsystemsgroup.com), an IIFE, small helper functions with a one-line comment, then `LessonStudio.define({{ id: '{target}', teacher: '{teacher}', title: {json.dumps(lesson['title'])}, ..., beats: [...] }})`.
- `say` is spelled exactly as spoken: no digits and no symbols such as % $ = + × ÷ < > _ . Write "twenty percent", "fifty dollars", "point eight".
- Put a cue marker `{{name}}` right before the word where something happens; `c.name` is that word's time. `c.word('word', n)` is the time of the n-th (0-based) time that word is said in the same beat. Every `c.<name>` you use must be a cue in that beat's `say`, and every `c.word(...)` must be a word spoken in that beat. Cue names are unique within a beat and must not be start, end, index, spoken, word or from.
- Structure: an opening beat where the teacher says hello and hooks the student; then pages 'The idea', 'Watch me' (a worked example), 'Your turn' (the student tries a question: `pause: 5.2` and `s.countdown(c.end + 0.3, 5, {{ x: 1080, y: 18 }})`), the answer in the next beat (`gap: 0.1`), 'A faster way' (the shortcut), 'Watch out' (the caution and the common mistake) and 'Remember'. The last line must contain "Now hit Try this skill" (for example "Now hit Try this skill, and go get 'em!").
- Length: about 190 to 290 spoken words in 9 to 13 beats, so the video runs 90 seconds to 2 minutes.
- Teach with moving pictures, not just words: every beat writes on the board on the spoken word, moves or marks something (move, flyTo, swap, grow, draw, strike, circle, mark, pop, pulse, anim, bars, plot...), and the monster points at or looks at what it talks about, with moods and gestures. Each idea gets a real demonstration that shows WHY, the way the finished lessons do.
- Board: x 0 to 1228, y 0 to 762. Keep all writing inside it. The chapter label takes the top left down to y 70; the countdown ring is at x 1080, y 18; the monster's pointing arm covers the right side below y 450 to about x 990. Board text is at least size 56 and tags at least size 38. Two pieces of writing must never overlap while both are visible: hide or move old writing before new writing takes its place.
{math_rule}- Use only calls that exist in stage.js and the README. Do not invent methods or options.
"""


def brief(target, lesson):
    """The same materials a person writing this lesson had: the guide, the stage code, the cast, two finished lessons."""
    teacher = TEACHER_OF[lesson['domain']]
    parts = [
        '# The lesson studio guide (README.md)\n\n' + (STUDIO / 'README.md').read_text(),
        '# The stage code (stage/stage.js): the exact API your script calls\n\n```js\n' + (STUDIO / 'stage/stage.js').read_text() + '\n```',
        '# The teachers (lessons/teachers.js)\n\n```js\n' + (STUDIO / 'lessons/teachers.js').read_text() + '\n```',
    ]
    for ex in EXAMPLES:
        parts.append(f'# A finished lesson, for reference only (lessons/{ex}.js)\n\n```js\n' + (STUDIO / f'lessons/{ex}.js').read_text() + '\n```')
    parts.append(task_text(target, lesson, teacher))
    system = ('You are an expert educational video writer and a careful JavaScript developer. You write lesson scripts for a '
              'deterministic animation studio. You follow the API exactly as given and check your own work against the rules '
              'before you answer.')
    return system, '\n\n'.join(parts)


def call_model(args, messages):
    """One chat completion; thinking is requested explicitly because some servers start with it off."""
    body = {'model': args.model, 'messages': messages, 'max_tokens': args.max_tokens, 'temperature': 0.6, 'top_p': 0.95, 'top_k': 20}
    if args.think:
        body['chat_template_kwargs'] = {'enable_thinking': True}
    req = urllib.request.Request(args.endpoint.rstrip('/') + '/chat/completions', json.dumps(body).encode(), {'content-type': 'application/json'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=4800) as resp:
        data = json.load(resp)
    msg = data['choices'][0]['message']
    reasoning = msg.get('reasoning_content') or msg.get('reasoning') or ''
    return {'content': msg.get('content') or '', 'reasoning': reasoning, 'finish': data['choices'][0].get('finish_reason'),
            'usage': data.get('usage', {}), 'seconds': round(time.time() - t0, 1)}


def extract_code(text):
    """The longest fenced JavaScript block, or the whole reply when it is bare code."""
    blocks = re.findall(r'```(?:js|javascript)?\s*\n(.*?)```', text, re.S)
    if blocks:
        return max(blocks, key=len)
    stripped = text.strip()
    if stripped.startswith('/*') or stripped.startswith('(function'):
        return stripped
    return None


def run(cmd, env=None, timeout=900):
    """Run a checker; its output is the result, so a failure is returned rather than raised."""
    p = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def evaluate(studio, target, subject):
    """Static rules, then a Kokoro rehearsal take, then the real stage build and the layout audit."""
    report = {'static': None, 'narrate': None, 'build': None}
    code, out, err = run(['node', str(HERE / 'check.cjs'), str(studio), target, subject])
    report['static'] = json.loads(out) if out.strip().startswith('{') else {'ok': False, 'problems': ['checker crashed: ' + err[-400:]]}
    loads = not any(p.startswith('The file does not load') or 'never calls LessonStudio.define' in p for p in report['static']['problems'])
    if not loads:
        return report
    env = dict(os.environ, LESSON_CACHE=str(studio / 'cache'))
    code, out, err = run([PY, str(studio / 'narrate.py'), target, '--engine', 'kokoro'], env=env, timeout=1200)
    report['narrate'] = {'ok': code == 0, 'out': (out + err)[-1500:]}
    timing = studio / 'cache' / target / 'timing-kokoro.json'
    if code != 0 or not timing.exists():
        return report
    code, out, err = run(['node', str(HERE / 'build-audit.cjs'), str(studio), target, str(timing)], timeout=900)
    report['build'] = json.loads(out) if out.strip().startswith('{') else {'built': False, 'error': 'harness crashed: ' + err[-400:]}
    return report


def beat_context(timing_path, error):
    """For a build error about a beat, the cues and spoken words that beat really has."""
    m = re.search(r'beat (\d+):', error or '')
    if not m or not Path(timing_path).exists():
        return ''
    beats = json.loads(Path(timing_path).read_text())['beats']
    i = int(m.group(1))
    if i >= len(beats):
        return ''
    b = beats[i]
    return f" Beat {i}'s cues are: {' '.join('{' + k + '}' for k in b['cues']) or '(none)'}. Its spoken words are: {' '.join(w['w'] for w in b['words'])}"


def audit_items(build):
    """Layout problems and missing motion, written the way a reviewer would say them."""
    items = []
    for p in build.get('problems', [])[:25]:
        if p['kind'] == 'overlap':
            items.append(f"Overlap at {p['at']} s ({p['where']}): \"{p['a']}\" and \"{p['b']}\" cover each other ({p['area']} px²). Move one, or hide the older one first.")
        elif p['kind'] == 'off-board':
            items.append(f"Off the board at {p['at']} s ({p['where']}): \"{p['text']}\" spans {p['box']} in screen pixels. Keep writing inside x 0..1228, y 0..762 of the board.")
        elif p['kind'] == 'too-small':
            items.append(f"Too small at {p['at']} s ({p['where']}): \"{p['text']}\" is {p['size']} px. Board text at least 56, tags at least 38.")
    if build.get('movingParts', 0) < 1:
        items.append('Nothing on the board moves. Add moving demonstrations.')
    if build.get('highlights', 0) < 1:
        items.append('Nothing is ever highlighted. Mark, circle or underline the key words as they are said.')
    return items


def problems_of(report, timing_path=''):
    """Everything the model must fix."""
    items = list(report['static']['problems'])
    nar = report.get('narrate')
    if nar and not nar['ok']:
        items.append('The rehearsal voice could not be matched to your say lines (a word is spelled differently from how it is spoken, or a line has symbols). Narrator output:\n' + nar['out'][-900:])
    b = report.get('build')
    if b:
        if b.get('error'):
            items.append('Building the lesson on the stage failed: ' + b['error'] + beat_context(timing_path, b['error']))
        items += ['Page error while building: ' + e for e in b.get('pageErrors', [])[:6]]
        if b.get('built'):
            items += audit_items(b)
    return items


def one_round(args, target, subject, studio, out, rnd, messages, history):
    """Ask for a draft, check it, and return the history entry and the next messages (None when done)."""
    reply = call_model(args, messages)
    (out / f'round-{rnd}.reply.json').write_text(json.dumps(reply, indent=1))
    code = extract_code(reply['content'])
    entry = {'round': rnd, 'seconds': reply['seconds'], 'finish': reply['finish'], 'usage': reply['usage'], 'reasoningChars': len(reply['reasoning'])}
    if code is None:
        entry['problems'] = ['no ```js block in the reply' + (' (the reply ran out of tokens)' if reply['finish'] == 'length' else '')]
        log(f'{target}: round {rnd} no code (finish={reply["finish"]})')
        ask = 'Your reply had no complete ```js block. Return the whole lesson file in one ```js block, and keep your reasoning short.'
        return entry, messages[:2] + [{'role': 'assistant', 'content': reply['content'][-4000:] or '(empty)'}, {'role': 'user', 'content': ask}]
    (studio / 'lessons' / f'{target}.js').write_text(code)
    (out / f'round-{rnd}.js').write_text(code)
    report = evaluate(studio, target, subject)
    (out / f'round-{rnd}.report.json').write_text(json.dumps(report, indent=1))
    items = problems_of(report, str(studio / 'cache' / target / 'timing-kokoro.json'))
    if items and history and history[-1].get('code') == code:
        items.insert(0, 'Your last reply returned the file unchanged, so these problems are still there. Change the lines that cause them.')
    b = report.get('build') or {}
    entry.update({'code': code, 'problems': items, 'stats': report['static'].get('stats'), 'built': b.get('built', False),
                  'movingParts': b.get('movingParts'), 'highlights': b.get('highlights'), 'duration': b.get('duration'),
                  'audit': [p['kind'] for p in b.get('problems', [])]})
    log(f'{target}: round {rnd} -> {len(items)} problems, built={entry["built"]} moving={entry["movingParts"]} highlights={entry["highlights"]} ({reply["seconds"]} s, {reply["usage"].get("completion_tokens")} tokens)')
    if not items:
        return entry, None
    feedback = ('Your lesson file was checked. Fix every problem below and return the COMPLETE corrected file in one ```js block. '
                'Keep everything that already works.\n\n' + '\n'.join(f'{i + 1}. {p}' for i, p in enumerate(items[:40])))
    return entry, messages[:2] + [{'role': 'assistant', 'content': '```js\n' + code + '\n```'}, {'role': 'user', 'content': feedback}]


def author(args, target, catalog):
    """Write one lesson in up to --rounds drafts and save every round."""
    lesson = next(l for l in catalog['lessons'] if l['id'] == target)
    out = Path(args.out) / target
    out.mkdir(parents=True, exist_ok=True)
    studio = make_studio(Path(args.out), target)
    system, user = brief(target, lesson)
    (out / 'prompt.md').write_text(system + '\n\n----\n\n' + user)
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]
    history = []
    for rnd in range(args.rounds):
        log(f'{target}: round {rnd} asking {args.model}')
        try:
            entry, messages = one_round(args, target, lesson['domain'], studio, out, rnd, messages, history)
        except Exception as err:  # a failed call is a result, recorded as such
            history.append({'round': rnd, 'error': f'model call failed: {err}'})
            log(f'{target}: round {rnd} model call failed: {err}')
            break
        history.append(entry)
        if messages is None:
            break
    slim = [{k: v for k, v in r.items() if k != 'code'} for r in history]
    passed = bool(history) and not history[-1].get('problems') and not history[-1].get('error')
    result = {'target': target, 'model': args.model, 'think': args.think, 'passed': passed, 'rounds': slim}
    (out / 'result.json').write_text(json.dumps(result, indent=1))
    log(f'{target}: done, passed={passed} after {len(history)} round(s)')
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='bot-fast')
    ap.add_argument('--endpoint', default='http://127.0.0.1:8000/v1')
    ap.add_argument('--targets', default='percent,transitions,mainidea,science-design')
    ap.add_argument('--rounds', type=int, default=5)
    ap.add_argument('--parallel', type=int, default=2, help='concurrent model requests; the shared local model takes about 3')
    ap.add_argument('--max-tokens', type=int, default=48000, help='reply limit; prompt (about 45k tokens) plus reply must fit the context')
    ap.add_argument('--think', action='store_true', help='ask for the model\'s thinking (vllm-fast starts with it off)')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    catalog = json.loads(CATALOG.read_text())
    Path(args.out).mkdir(parents=True, exist_ok=True)
    with cf.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        results = list(pool.map(lambda t: author(args, t, catalog), args.targets.split(',')))
    (Path(args.out) / 'summary.json').write_text(json.dumps(results, indent=1))
    for r in results:
        last = r['rounds'][-1] if r['rounds'] else {}
        print(json.dumps({'target': r['target'], 'passed': r['passed'], 'rounds': len(r['rounds']), 'lastProblems': len(last.get('problems', [])),
                          'moving': last.get('movingParts'), 'highlights': last.get('highlights')}))


if __name__ == '__main__':
    main()
