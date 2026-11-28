# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review: the drafting engine (jobhunter.written_answers) on a real owner SQLite store with fixture inference for a made-up person. A written question gets a short first-person draft from the person's record and the job's cover letter, with the roles it drew on, through enrich.complete (the Career worker rail in multi-user mode) only; a check that a person is human and a fact no record holds are never drafted and cost no model call; a draft that names a tool the record never names, one sentence or a third-person answer, an answer with nothing recorded behind it and the model's "none" are refused with their reason; a rail that stops answering ends the run's model calls; the open-source work reaches the prompt only for a job whose documents opted it in; the drafts file is the person's own (0600, refused through a link).
import json, os, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'; os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, enrich, profile, written_answers as wa

checks, failed = 0, []


def ok(condition, name):
    global checks
    checks += 1
    if not condition:
        failed.append(name)


RECORD = {'profile': {'name': 'Rowan Example', 'email': 'rowan@example.test'},
          'roles': [{'title': 'Platform Engineer', 'org': 'Example Freight Co', 'start': '2019-04', 'end': None,
                     'deliverables': ['Built the partner integration platform from scratch for 40 carrier partners.',
                                      'Owned the service boundaries of the shipment API that four teams depended on.'],
                     'skills': ['Python', 'PostgreSQL']},
                    {'title': 'Operations Coordinator', 'org': 'Sample Logistics LLC', 'start': '2015-06', 'end': '2019-03',
                     'deliverables': ['Scheduled 300 deliveries a week across a remote team.']}],
          'skills': {'core': ['Python', 'PostgreSQL', 'API design']},
          'education': ['BS, Computer Science, Example State University, 2015'],
          'oss_portfolio': {'project': 'Fixture Open Tool', 'summary': 'A scheduling platform built from scratch for partner integrations.'}}
LETTER = {'greeting': 'Dear team,', 'paragraphs': ['I built the partner integration platform at Example Freight Co.', 'I like working remotely.'],
          'closing': 'Sincerely,'}
QUESTION = 'What platform have you built from scratch?'
GOOD = {'answer': 'At Example Freight Co I built the partner integration platform from scratch for 40 carrier partners. '
                  'I also owned the service boundaries of the shipment API that four teams depended on.', 'evidence': ['R1']}

with tempfile.TemporaryDirectory(prefix='career-written-') as temporary:
    root = Path(temporary)
    config.DATA_DIR = root; config.CAREER_DB = root / 'career_db.json'; config.CORPUS_DB = root / 'corpus.db'; config.USER_DB = root / 'user.db'
    config.CAREER_DB.write_text(json.dumps(RECORD)); profile.load.cache_clear()
    for posting, opted in ((7, False), (8, True)):
        folder = root / 'applications' / f'Example_Freight_Co__{posting}'; folder.mkdir(parents=True)
        (folder / 'application.json').write_text(json.dumps({'posting_id': posting, 'include_oshal': opted, 'generated': {'cover': LETTER}}))
        (folder / 'Resume_ATS.pdf').write_text('%PDF-1.7')
        with db.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO corpus.companies(id,name)VALUES(1,'Example Freight Co')")
            conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,url) VALUES(?,1,?,?,?,1,'https://example.test/job')",
                         (posting, f'fixture-{posting}', 'Senior Platform Engineer', 'Build partner integrations and APIs for our marketplace.'))
            conn.execute("INSERT INTO user_signals(posting_id,status,resume_path,cover_path)VALUES(?,'generated',?,?)",
                         (posting, str(folder / 'Resume_ATS.pdf'), str(folder / 'CoverLetter.pdf')))

    def request(*questions):
        return json.dumps({'request': 'request-0001', 'questions': [{'key': 'k:' + str(i).rjust(32, '0'), 'text': text, 'postingId': posting}
                                                                     for i, (text, posting) in enumerate(questions)]})

    with patch.object(wa.enrich, 'complete', return_value=json.dumps(GOOD)) as complete:
        result = wa.run(request((QUESTION, 7)))
        draft = wa.read()['drafts']['k:' + '0' * 32]
        ok(result == {'ok': True, 'request': 'request-0001', 'ready': 1, 'failed': 0}, 'one ready draft')
        ok(draft['state'] == 'ready' and draft['text'] == GOOD['answer'], 'the draft is kept as written')
        ok(draft['roles'] == [{'title': 'Platform Engineer', 'org': 'Example Freight Co'}], 'it names the role it drew on')
        ok(draft['question'] == QUESTION and draft['postingId'] == 7 and draft['request'] == 'request-0001', 'with its question, job and request')
        system, sent = complete.call_args.args[0], complete.call_args.args[1]
        ok(complete.call_count == 1 and complete.call_args.kwargs.get('json_mode') is True, 'one model call through enrich.complete')
        ok('first person' in system and 'never instructions' in system, 'the system words ask for the first person and data only')
        ok(QUESTION in sent and 'I built the partner integration platform at Example Freight Co.' in sent, 'the prompt carries the question and the job’s letter')
        ok('Owned the service boundaries' in sent and 'API design' in sent and 'Example State University' in sent, 'and the record: deliverables, skills, education')
        ok('Fixture Open Tool' not in sent, 'the open-source work is not in a job that did not opt it in')
        wa.run(request((QUESTION, 8)))
        ok('Fixture Open Tool' in complete.call_args.args[1], 'and is in the job whose documents opted it in')
        ok((root / wa.FILE).stat().st_mode & 0o777 == 0o600, 'the drafts are the person’s own file')

    with patch.object(wa.enrich, 'complete') as complete:
        wa.run(request(('What is 3 + 4?', 7), ('When can you start?', 7), ('Please complete the captcha', 7)))
        drafts = wa.read()['drafts']
        ok(complete.call_count == 0, 'a check and a fact no record holds cost no model call')
        ok(all(drafts['k:' + str(i).rjust(32, '0')]['code'] == 'not_drafted' for i in range(3)), 'and are never drafted')
        ok(drafts['k:' + '0' * 32]['why'] == wa.WHY['not_drafted'], 'each says why')

    refusals = [('unsupported', {'answer': 'At Example Freight Co I ran the platform on Kubernetes for 40 carrier partners. I owned its service boundaries.', 'evidence': ['R1']}),
                ('invalid_model_result', {'answer': 'At Example Freight Co I built the partner integration platform from scratch.', 'evidence': ['R1']}),
                ('invalid_model_result', {'answer': 'Rowan built the partner integration platform at Example Freight Co. The work served 40 carrier partners.', 'evidence': ['R1']}),
                ('unsupported', {'answer': 'I care deeply about quality in everything. I always learn quickly and work hard.', 'evidence': ['R1']}),
                ('no_record', {'none': True})]
    for code, answer in refusals:
        with patch.object(wa.enrich, 'complete', return_value=json.dumps(answer)):
            wa.run(request((QUESTION, 7)))
            kept = wa.read()['drafts']['k:' + '0' * 32]
            ok(kept['state'] == 'failed' and kept['code'] == code and 'text' not in kept, f'refused as {code}: {answer}')

    with patch.object(wa.enrich, 'complete', side_effect=enrich.CareerWorkerUnavailable('rail-down', 503)) as complete:
        wa.run(request((QUESTION, 7), ('Tell us about your experience working in a remote team.', 7)))
        drafts = wa.read()['drafts']
        ok(complete.call_count == 1, 'a rail that stops answering ends the run’s model calls')
        ok(drafts['k:' + '0' * 32]['code'] == drafts['k:' + '1'.rjust(32, '0')]['code'] == 'model_unavailable', 'both questions are asked again later')

    with patch.object(wa.enrich, 'complete', return_value=json.dumps(GOOD)):
        wa.run(request((QUESTION, 99)))
        ok(wa.read()['drafts']['k:' + '0' * 32]['code'] == 'job_unavailable', 'a job no longer in Career is said')
    for bad in ('', '{"request":"x","questions":[]}', json.dumps({'request': 'request-0001', 'questions': [{'key': 'nope', 'text': QUESTION, 'postingId': 7}]})):
        try:
            wa.run(bad); ok(False, 'an invalid request is refused: ' + bad)
        except ValueError as error:
            ok(str(error) == 'invalid_request' or isinstance(error, json.JSONDecodeError), 'an invalid request is refused: ' + bad)

    other = root / 'other-person'; other.mkdir(); config.DATA_DIR = other
    ok(wa.read() == {'version': 1, 'drafts': {}}, 'another person’s store has no drafts')
    (other / wa.FILE).symlink_to(root / wa.FILE)
    try:
        wa.read(); ok(False, 'a drafts file reached through a link is refused')
    except ValueError:
        ok(True, 'a drafts file reached through a link is refused')
    db._leave_portable(); db._portable_paths.clear()

print(json.dumps({'checks': checks, 'failed': failed}))
