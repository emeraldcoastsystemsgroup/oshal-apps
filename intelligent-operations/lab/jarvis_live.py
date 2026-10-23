#!/usr/bin/env python3
"""Ask Jarvis on the owned lab what needs the operator's attention in Operations and keep the exchange.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Live check that Jarvis routes an operations-attention question to the package's read-only ops-attention tool and answers from the person's own saved records.
"""
import json
import sys
import time
from pathlib import Path
from portal import Portal

QUESTION = sys.argv[1] if len(sys.argv) > 1 else 'What needs my attention in operations?'


def run():
    receipt = {'kind': 'jarvis-operations-attention', 'question': QUESTION, 'startedAt': time.time()}
    with Portal() as p:
        receipt['attention'] = p.call('/api/intelligent-operations/attention')['summary']
        answer = p.call('/api/jarvis/ask', {'message': QUESTION, 'sessionId': 'ops-attention-acceptance'})
        if answer and answer.get('jobId'):
            for _ in range(60):
                time.sleep(5)
                answer = p.call('/api/jarvis/ask/result?jobId=' + answer['jobId'])
                if answer and answer.get('status') not in ('pending', 'running'):
                    break
        receipt['answer'] = answer
    receipt['finishedAt'] = time.time()
    out = Path(__file__).resolve().parent.parent / 'deploy/evidence/jarvis-operations.json'
    out.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt)[:3000])


if __name__ == '__main__':
    run()
