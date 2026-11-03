#!/usr/bin/env python3
"""Mechanical grade of a lesson outline written in format.md: a list of problems and some stats.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Grader for the writer-only outline format: id, teacher and title; 9 to 13 beats in chapter order; say spelled as spoken; every board, highlight and demo trigger word actually spoken in its beat; highlight targets on the page's board; demo types from the fixed list with their parameters; the your-turn pause and the answer beat; the closing line; arithmetic facts (evaluated as plain arithmetic only, never as code); 190 to 290 spoken words

Usage: grade.py <outline.json> <lesson id> <domain> <catalog title>   prints {problems, stats}
"""
import ast
import json
import operator
import re
import sys

PAGES = [None, 'The idea', 'Watch me', 'Your turn', 'A faster way', 'Watch out', 'Remember']
REQUIRED = ['The idea', 'Watch me', 'Your turn', 'A faster way', 'Watch out', 'Remember']
STYLES = {'mark', 'circle', 'underline', 'strike'}
TEACHER_OF = {'math': 'pinky', 'english': 'bluebold', 'reading': 'tealy', 'science': 'sprout'}
DEMOS = {
    'equation-steps': ['steps'], 'bar-model': ['parts'], 'number-line': ['from', 'to'], 'balance': ['left', 'right'],
    'sentence-highlight': ['sentence', 'highlights'], 'two-column-compare': ['left', 'right'], 'table': ['columns', 'rows'],
    'simple-graph': ['kind', 'x', 'y'], 'plant-experiment': ['variable', 'groups', 'constants', 'measure'],
}
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow,
       ast.USub: operator.neg, ast.UAdd: operator.pos}


def arithmetic(expr):
    """Value of a plain arithmetic expression; anything else (names, calls, attributes) is refused."""
    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            return OPS[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:
            return OPS[type(node.op)](walk(node.operand))
        raise ValueError('only numbers and + - * / ** are allowed')
    return walk(ast.parse(str(expr), mode='eval'))


def norm(w):
    """A word as compared with the spoken words: lower case, letters, digits and apostrophes."""
    return re.sub(r"[^a-z0-9']", '', str(w).lower())


def spoken(say):
    """The words of a say line as heard: delivery tags removed."""
    return [norm(w) for w in re.sub(r'\[[^\]]*\]', ' ', say).split() if norm(w)]


def check_word(where, word, nth, said, problems):
    """A trigger must be one word that is spoken in its beat (the nth time, if given)."""
    n = nth if isinstance(nth, int) else 0
    if not isinstance(word, str) or not word.strip() or len(word.split()) != 1:
        problems.append(f'{where}: onWord must be ONE spoken word, got {json.dumps(word)}')
        return
    if said.count(norm(word)) <= n:
        problems.append(f'{where}: "{word}"' + (f' (occurrence {n})' if n else '') + f' is not spoken in this beat. Its words: {" ".join(said)}')


def demo_words(demo):
    """Every (where, onWord, nth) inside a demo."""
    out = [('demo', demo.get('onWord'), demo.get('nth'))]
    for key in ['steps', 'cancel', 'jumps', 'changes', 'highlights']:
        for i, item in enumerate(demo.get(key) or []):
            if isinstance(item, dict) and 'onWord' in item:
                out.append((f'demo.{key}[{i}]', item['onWord'], item.get('nth')))
    return out


def grade_demo(i, demo, said, problems):
    """A demo must be one of the fixed kinds, with its parameters and spoken triggers."""
    t = demo.get('type')
    if t not in DEMOS:
        problems.append(f'beat {i}: demo type {json.dumps(t)} is not one of {", ".join(DEMOS)}')
        return
    for key in DEMOS[t]:
        if key not in demo:
            problems.append(f'beat {i}: demo {t} needs "{key}"')
    for where, word, nth in demo_words(demo):
        check_word(f'beat {i} {where}', word, nth, said, problems)
    if t == 'sentence-highlight':
        for h in demo.get('highlights') or []:
            if isinstance(h, dict) and h.get('text') and h['text'] not in str(demo.get('sentence', '')):
                problems.append(f'beat {i}: demo highlight "{h["text"]}" is not part of its sentence')


def grade_board(i, b, said, page_board, problems):
    """Board items: at most 5 per beat, short, each landing on a spoken word; they join the page's board."""
    board = b.get('board') or []
    if len(board) > 5:
        problems.append(f'beat {i}: {len(board)} board items; at most 5 per beat')
    for k, item in enumerate(board):
        if not isinstance(item, dict) or not str(item.get('text', '')).strip():
            problems.append(f'beat {i} board[{k}]: needs text')
            continue
        if len(item['text']) > 40:
            problems.append(f'beat {i} board[{k}]: "{item["text"]}" is longer than 40 characters')
        check_word(f'beat {i} board[{k}]', item.get('onWord'), item.get('nth'), said, problems)
        page_board.append(item['text'])


def grade_highlights(i, b, said, page_board, problems):
    """Highlights land on a spoken word and mark something already on this page's board."""
    for k, h in enumerate(b.get('highlight') or []):
        if not isinstance(h, dict):
            problems.append(f'beat {i} highlight[{k}]: must be an object')
            continue
        check_word(f'beat {i} highlight[{k}]', h.get('onWord'), h.get('nth'), said, problems)
        if h.get('style') not in STYLES:
            problems.append(f'beat {i} highlight[{k}]: style must be one of {sorted(STYLES)}')
        if not any(str(h.get('target', '')) and str(h.get('target')) in t for t in page_board):
            problems.append(f'beat {i} highlight[{k}]: target "{h.get("target")}" is not on the board of this page')


def grade_beat(i, b, page_board, problems):
    """One beat; returns its spoken word count."""
    if b.get('page') not in PAGES:
        problems.append(f'beat {i}: page {json.dumps(b.get("page"))} is not one of {PAGES}')
    say = b.get('say')
    if not isinstance(say, str) or not say.strip():
        problems.append(f'beat {i}: say must be a non-empty string')
        return 0
    plain = re.sub(r'\[[^\]]*\]', ' ', say)
    bad = sorted(set(re.findall(r'[0-9%$=+×÷<>_]', plain)))
    if bad:
        problems.append(f'beat {i}: say must be spelled as spoken; it contains {"".join(bad)}: "{plain.strip()[:140]}"')
    said = spoken(say)
    grade_board(i, b, said, page_board, problems)
    demo = b.get('demo')
    if demo:
        grade_demo(i, demo, said, problems)
        for key in ['steps', 'cancel']:
            page_board += [s.get('text', '') for s in demo.get(key) or [] if isinstance(s, dict)]
        page_board += [str(demo.get(k, '')) for k in ['left', 'right', 'sentence']]
    grade_highlights(i, b, said, page_board, problems)
    return len(said)


def grade_structure(beats, problems):
    """Chapter order, the your-turn pause and answer beat, and the closing line."""
    pages = [b.get('page') for b in beats if isinstance(b, dict) and b.get('page')]
    if beats[0].get('page') is not None:
        problems.append('the first beat is the opening: page null')
    order = [p for p in pages if p in REQUIRED]
    firsts = [p for k, p in enumerate(order) if p not in order[:k]]
    if firsts != REQUIRED:
        problems.append(f'chapters must come in this order: {REQUIRED}; got {firsts}')
    turn = next((k for k, b in enumerate(beats) if isinstance(b, dict) and b.get('page') == 'Your turn'), None)
    if turn is not None:
        if not (isinstance(beats[turn].get('pause'), (int, float)) and beats[turn]['pause'] >= 4):
            problems.append("the 'Your turn' beat needs \"pause\": 5")
        nxt = beats[turn + 1] if turn + 1 < len(beats) else {}
        if nxt.get('page') is not None or nxt.get('gap') is None:
            problems.append("the beat after 'Your turn' is the answer: page null and \"gap\": 0.1")
    if 'now hit try this skill' not in ' '.join(spoken(beats[-1].get('say', ''))).replace("'", ''):
        problems.append('the last say must contain "Now hit Try this skill"')
    return pages


def grade_facts(outline, problems):
    """A math lesson lists every number it states, and each fact must be right."""
    facts = outline.get('facts') or []
    if len(facts) < 3:
        problems.append('a math lesson lists every number it states in facts (at least 3)')
    for f in facts:
        try:
            v = arithmetic(f[0])
            if abs(v - float(f[1])) > 1e-9:
                problems.append(f'facts: {f[0]} is {v}, not {f[1]}')
        except Exception as e:  # a bad fact is a problem to report, not a crash
            problems.append(f'facts: {json.dumps(f)} is not a valid arithmetic expression and value ({e})')


def grade(outline, lesson_id, domain, title):
    """All problems of one outline, and its beat count, word count and chapters."""
    problems = []
    if outline.get('id') != lesson_id:
        problems.append(f'id must be "{lesson_id}"')
    if outline.get('teacher') != TEACHER_OF[domain]:
        problems.append(f'teacher must be "{TEACHER_OF[domain]}"')
    if outline.get('title') != title:
        problems.append(f'title must be the catalog title "{title}"')
    beats = outline.get('beats')
    if not isinstance(beats, list) or not beats:
        return problems + ['beats must be a non-empty list'], {}
    if not 9 <= len(beats) <= 13:
        problems.append(f'{len(beats)} beats; write 9 to 13')
    words, page_board = 0, []
    for i, b in enumerate(beats):
        if not isinstance(b, dict):
            problems.append(f'beat {i}: must be an object')
            continue
        if b.get('page'):
            page_board = []
        words += grade_beat(i, b, page_board, problems)
    pages = grade_structure(beats, problems)
    if domain == 'math':
        grade_facts(outline, problems)
    if not 190 <= words <= 290:
        problems.append(f'{words} spoken words; write 190 to 290')
    return problems, {'beats': len(beats), 'words': words, 'pages': pages}


if __name__ == '__main__':
    o = json.load(open(sys.argv[1]))
    p, s = grade(o, sys.argv[2], sys.argv[3], sys.argv[4])
    print(json.dumps({'problems': p, 'stats': s}, indent=1))
