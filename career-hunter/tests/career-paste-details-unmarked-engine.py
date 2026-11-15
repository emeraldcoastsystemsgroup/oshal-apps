# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.1 (Lane VER15 on the test server, 2026-11-15: a job the nightly pass had not marked stopped with job_details_unavailable and the Concierge never said where to paste): the real prepare_job over one invented person's stores (the ones the route test's harness made), started the way POST /jobs/:id/generate starts it. The résumé, the PDF writer's binary and every employer read are stand-ins that record what they were asked; any model call fails the run. Prints the engine's answer, how many employer reads it tried and how many model calls it made.
"""Run the real engine preparation for one job of a disposable invented person and report what it did."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, enrich, generate, prepare, profile, score

PROFILE = {'profile': {'name': 'Olive Testperson', 'email': 'olive@example.test', 'experience_summary': 'Invented engineer'},
           'roles': [{'title': 'Lead', 'org': 'Invented Co', 'start': '2020', 'end': '2026', 'bullets': ['Ran invented things.']}],
           'skills': {}}


def main():
    given = json.loads(sys.stdin.read())
    data = Path(given['dataDir'])
    config.CORPUS_DB, config.POSTGRES, config.MULTIUSER, config.STORE = Path(given['corpusDb']), False, True, 'sqlite'
    config.DATA_DIR, config.USER_DB, config.CAREER_DB, config.USER_SUB = data, Path(given['userDb']), data / 'career_db.json', given['sub']
    generate.APP_DIR = data / 'applications'
    reads, models = [], []

    def employer(*args):
        reads.append(args[0])
        return {}

    def model(*args, **kwargs):
        models.append(1)
        raise AssertionError('no model call without a description')

    with patch.object(prepare.render, '_chromium_binary', return_value='/fixture/chrome'), \
            patch.object(profile, 'load', return_value=PROFILE), patch.object(profile, 'summary', return_value='Invented profile'), \
            patch.object(enrich, 'complete_scoring', side_effect=model), patch.object(generate.enrich, 'complete', side_effect=model), \
            patch.object(score.detail, 'fetch', side_effect=employer):
        result = prepare.prepare_job(int(given['postingId']), documents=True, request_id=given['requestId'])
    print(json.dumps({'result': result, 'employerReads': len(reads), 'modelCalls': len(models)}))


if __name__ == '__main__':
    main()
