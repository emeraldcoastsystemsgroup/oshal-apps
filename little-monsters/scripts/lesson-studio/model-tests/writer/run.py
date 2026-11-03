#!/usr/bin/env python3
"""Writer-only test: a model fills in the lesson outline format (format.md) from the catalog entry.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | The writer's half of a lesson as a test: the model gets the outline format, the teachers, one finished outline for another lesson (linear) and the catalog entry, writes the outline, sample problem and script as JSON, and gets the grader's problems back for up to two repairs; fast and thinking modes. Used on 2026-11-02 after Roger's point that a writer drafts and a fixed-template animator renders

Usage:
  python3 run.py --out /tmp/writer-runs [--model bot-fast] [--endpoint http://127.0.0.1:8000/v1]
                 [--targets percent,transitions,mainidea,science-design] [--modes fast,think] [--parallel 2]
Writes <out>/<lesson>-<mode>.json (the last outline) and <out>/<lesson>-<mode>/ (every attempt and its grade).
"""
import argparse
import concurrent.futures as cf
import json
import re
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import grade as G

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent.parent
PKG = STUDIO.parent.parent
LOCK = threading.Lock()


def log(msg):
    """Print one progress line; several jobs run at once."""
    with LOCK:
        print(time.strftime('%H:%M:%S'), msg, flush=True)


def cast():
    """The teachers from lessons/teachers.js: key, name, subject and acting notes."""
    code = f"const {{loadAll}} = require({json.dumps(str(STUDIO / 'lessons-json.cjs'))}); const t = loadAll().teachers; " \
           "console.log(JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, {name: v.name, subject: v.subject, notes: v.notes}]))));"
    return json.loads(subprocess.check_output(['node', '-e', code], text=True))


def prompt(lesson, teachers):
    """System and user messages: the format, the cast, the example outline and the catalog entry."""
    teacher = G.TEACHER_OF[lesson['domain']]
    entry = {k: lesson[k] for k in ['title', 'learn', 'example', 'shortcut', 'caution', 'mistake']}
    lines = '\n'.join(f"- `{k}`: {v['name']}, teaches {v['subject']}. {v['notes']}" for k, v in teachers.items())
    user = f"""{(HERE / 'format.md').read_text()}

# The teachers

{lines}

# A finished outline, for a DIFFERENT lesson (an example of the format and the quality expected)

```json
{(HERE / 'example-linear.json').read_text()}
```

# Your task

Write the outline for the lesson below. Lesson id `{lesson['id']}`, subject {lesson['domain']}, teacher `{teacher}` ({teachers[teacher]['name']}).
The video must teach all of this catalog entry, correctly, to a high-school student preparing for the SAT or ACT:

```json
{json.dumps(entry, indent=1, ensure_ascii=False)}
```

Write it the way the example does: a real worked example, a NEW 'Your turn' question with its answer in the next
beat, a demo that shows why, board items that land on the spoken words, and the teacher's personality.
Return ONE JSON object in a single ```json block and nothing else."""
    system = ('You are an experienced SAT and ACT teacher who writes short animated lessons. You write the outline and '
              'the script; an animator turns it into video with a fixed template. You follow the format exactly.')
    return [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]


def call(args, messages, think):
    """One chat completion; thinking is requested explicitly because vllm-fast starts with it off."""
    body = {'model': args.model, 'messages': messages, 'max_tokens': 32000 if think else 12000}
    body.update({'temperature': 0.6, 'top_p': 0.95, 'top_k': 20} if think else {'temperature': 0.7, 'top_p': 0.8, 'top_k': 20})
    if think:
        body['chat_template_kwargs'] = {'enable_thinking': True}
    t0 = time.time()
    req = urllib.request.Request(args.endpoint.rstrip('/') + '/chat/completions', json.dumps(body).encode(), {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=3600) as r:
        d = json.load(r)
    m = d['choices'][0]['message']
    return {'content': m.get('content') or '', 'reasoningChars': len(m.get('reasoning_content') or m.get('reasoning') or ''),
            'finish': d['choices'][0].get('finish_reason'), 'tokens': d['usage']['completion_tokens'],
            'promptTokens': d['usage']['prompt_tokens'], 'seconds': round(time.time() - t0, 1)}


def parse(text):
    """The outline from a reply: the longest ```json block, or the whole reply."""
    blocks = re.findall(r'```(?:json)?\s*\n(.*?)```', text, re.S)
    raw = max(blocks, key=len) if blocks else text.strip()
    try:
        return json.loads(raw), None
    except json.JSONDecodeError as e:
        return None, f'the reply is not valid JSON: {e}'


def job(args, catalog, teachers, lesson_id, think):
    """Write one outline in up to 1 + --repairs attempts and save each attempt with its grade."""
    lesson = next(l for l in catalog['lessons'] if l['id'] == lesson_id)
    mode = 'think' if think else 'fast'
    out = Path(args.out)
    d = out / f'{lesson_id}-{mode}'
    d.mkdir(parents=True, exist_ok=True)
    base = prompt(lesson, teachers)
    messages, attempts, outline = list(base), [], None
    for k in range(1 + args.repairs):
        log(f'{lesson_id} {mode}: attempt {k}')
        r = call(args, messages, think)
        (d / f'attempt-{k}.reply.json').write_text(json.dumps(r, indent=1))
        outline, err = parse(r['content'])
        problems = [err] if err else G.grade(outline, lesson_id, lesson['domain'], lesson['title'])[0]
        if outline is not None:
            (d / f'attempt-{k}.json').write_text(json.dumps(outline, indent=1, ensure_ascii=False))
        attempts.append({'attempt': k, 'seconds': r['seconds'], 'tokens': r['tokens'], 'reasoningChars': r['reasoningChars'],
                         'finish': r['finish'], 'problems': problems})
        log(f'{lesson_id} {mode}: attempt {k} -> {len(problems)} problems ({r["seconds"]} s, {r["tokens"]} tokens)')
        if not problems:
            break
        fix = ('Your outline was checked. Fix every problem below and return the COMPLETE corrected outline as one JSON '
               'object in a ```json block. Keep everything that already works.\n\n' + '\n'.join(f'{i + 1}. {p}' for i, p in enumerate(problems[:40])))
        previous = json.dumps(outline, ensure_ascii=False) if outline else r['content'][-6000:]
        messages = base + [{'role': 'assistant', 'content': '```json\n' + previous + '\n```'}, {'role': 'user', 'content': fix}]
    result = {'lesson': lesson_id, 'mode': mode, 'model': args.model, 'passed': not attempts[-1]['problems'], 'attempts': attempts}
    (d / 'result.json').write_text(json.dumps(result, indent=1))
    if outline is not None:
        (out / f'{lesson_id}-{mode}.json').write_text(json.dumps(outline, indent=1, ensure_ascii=False))
    log(f'{lesson_id} {mode}: done passed={result["passed"]} after {len(attempts)} attempt(s)')
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='bot-fast')
    ap.add_argument('--endpoint', default='http://127.0.0.1:8000/v1')
    ap.add_argument('--targets', default='percent,transitions,mainidea,science-design')
    ap.add_argument('--modes', default='fast,think')
    ap.add_argument('--repairs', type=int, default=2)
    ap.add_argument('--parallel', type=int, default=2, help='concurrent model requests; the shared local model takes about 3')
    args = ap.parse_args()
    catalog = json.loads((PKG / 'data/test-prep/catalog.json').read_text())
    teachers = cast()
    Path(args.out).mkdir(parents=True, exist_ok=True)
    jobs = [(t, m == 'think') for m in args.modes.split(',') for t in args.targets.split(',')]
    with cf.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        results = list(pool.map(lambda j: job(args, catalog, teachers, *j), jobs))
    (Path(args.out) / 'summary.json').write_text(json.dumps(results, indent=1))
    for r in results:
        print(json.dumps({'lesson': r['lesson'], 'mode': r['mode'], 'passed': r['passed'], 'attempts': len(r['attempts']),
                          'seconds': sum(a['seconds'] for a in r['attempts']), 'tokens': sum(a['tokens'] for a in r['attempts'])}))


if __name__ == '__main__':
    main()
