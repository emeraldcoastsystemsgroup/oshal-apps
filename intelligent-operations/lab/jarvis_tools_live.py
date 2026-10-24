#!/usr/bin/env python3
"""Ask Jarvis on the owned lab one question per Operations tool and keep each exchange.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Live check that Jarvis answers attention, systems health,
  response plans, anomalies, hand-offs and investigations from the package's read-only tools: each exchange records the
  question, the summary the tool's route returns now, Jarvis's answer and whether the answer carries that summary's
  numbers and hands off to Operations. Nothing is run; the tools only read the operator's own records.
CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | The hand-off check looks for each inbound sender's name, which a correct answer gives without a count.
CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A count written as a word ("Four investigations") counts as carried.
"""
import json
import re
import time
from pathlib import Path
from portal import Portal

API = '/api/intelligent-operations'
WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
CHECKS = [
    ('What needs my attention in operations?', '/attention',
     lambda s: [i['count'] for i in s['items'] if i['count']]),
    ('Which of my systems are degraded right now, and is the inventory current?', '/summary/systems',
     lambda s: [s['counts']['degraded']]),
    ('What is the status of my response plans and was recovery verified?', '/summary/responses',
     lambda s: [len(s['plans'])]),
    ('Are any anomalies firing in operations?', '/summary/anomalies',
     lambda s: [sum(1 for b in s['baselines'] if b['firing'])]),
    ('What was handed to us by another swarm?', '/delegations',
     lambda s: [i['sender']['name'] for i in s.get('items', []) if i.get('direction') == 'inbound'][:3]),
    ('Which operations investigations do I have, and what state are they in?', '/investigations',
     lambda s: [len(s.get('items', s.get('investigations', [])))]),
]


def ask(p, question, session):
    answer = p.call('/api/jarvis/ask', {'message': question, 'sessionId': session})
    if answer and answer.get('jobId'):
        for _ in range(60):
            time.sleep(5)
            answer = p.call('/api/jarvis/ask/result?jobId=' + answer['jobId'])
            if answer and answer.get('status') not in ('pending', 'running'):
                break
    return answer or {}


def run():
    receipt = {'kind': 'jarvis-operations-tools', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'exchanges': []}
    with Portal() as p:
        for n, (question, route, numbers) in enumerate(CHECKS):
            summary = p.call(API + route)
            expected = numbers(summary)
            answer = ask(p, question, 'ops-tools-acceptance-' + str(n))
            text = str(answer.get('answer') or answer.get('text') or answer.get('response') or '')
            found = [x for x in expected if (isinstance(x, str) and x.lower() in text.lower()) or not isinstance(x, str) and (re.search(r'(?<![\d.])' + str(x) + r'(?![\d.])', text) or (x < len(WORDS) and re.search(r'\b' + WORDS[x] + r'\b', text, re.I)) or (x == 0 and re.search(r'\b(no|none|nothing)\b', text, re.I)))]
            handed = any(h.get('app') == 'intelligent-operations' for h in answer.get('handoffs') or [])
            receipt['exchanges'].append({'question': question, 'route': route, 'summary': summary.get('summary'),
                                         'expectedNumbers': expected, 'numbersInAnswer': found, 'handedToOperations': handed,
                                         'status': answer.get('status'), 'answer': text[:2000],
                                         'passed': answer.get('status') == 'done' and len(found) == len(expected)})
    receipt['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    receipt['result'] = 'passed' if all(e['passed'] for e in receipt['exchanges']) else 'failed'
    out = Path(__file__).resolve().parent.parent / 'deploy/evidence/jarvis-tools.json'
    out.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'result': receipt['result'], 'exchanges': [{k: e[k] for k in ('question', 'expectedNumbers', 'numbersInAnswer', 'handedToOperations', 'passed')} for e in receipt['exchanges']]}, indent=1))


if __name__ == '__main__':
    run()
