# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise private interview evidence, stale-plan refusal, exact answer quotes, retry identity and preservation of earlier practice with real owner SQLite stores and fixture inference.
import copy, hashlib, json, os, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config, db, profile, interview_prep as prep

with tempfile.TemporaryDirectory(prefix='career-interview-') as temporary:
    root=Path(temporary);config.DATA_DIR=root;config.CAREER_DB=root/'career_db.json'
    config.CORPUS_DB=root/'corpus.db';config.USER_DB=root/'user.db'
    candidate={'profile':{'name':'Fixture Candidate'},'roles':[{'title':'Instructor','org':'Fixture College',
      'start':'2020','end':'2024','deliverables':['Coached students through introductory Python projects.']}], 'skills':{}}
    config.CAREER_DB.write_text(json.dumps(candidate));profile.load.cache_clear()
    with db.connect() as conn:
        conn.execute("INSERT INTO corpus.companies(id,name)VALUES(1,'Fixture Employer')")
        conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,url) VALUES(1,1,'one','Adjunct Python Instructor',?,1,1,'https://example.test/job')",('Teach an introductory Python class. '*50,))
    before=hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest();profile_before=config.CAREER_DB.read_bytes()
    plan={'focus':'Prepare a short teaching demonstration for introductory Python.', 'questions':[
      {'question':f'How would you support a student learning Python? Example {i+1}', 'category':'role',
       'why':'The role teaches introductory Python.', 'approach':['Describe the actual teaching situation and your contribution.'],
       'evidenceIds':['r0-deliverables-0']} for i in range(6)],
       'askEmployer':['What support is available for first-time students?'],'checklist':['Practice a short explanation of a Python loop.']}
    with patch.object(prep.enrich,'complete',return_value=json.dumps(plan)) as complete:
        assert prep.run(1,request_id='prepare-one')['ok'];record=prep.read(1);first_plan=record['planId']
        assert record['plan']['evidence'][0]['text']==candidate['roles'][0]['deliverables'][0]
        assert 'Adjunct Python Instructor' in complete.call_args.args[1]
        assert prep.run(1,request_id='prepare-one')['duplicate'];assert complete.call_count==1
        try:prep.run(1,request_id='prepare-one',answer='changed input');raise AssertionError('request collision accepted')
        except ValueError as error:assert str(error)=='request_id_conflict'
    feedback={'summary':'Your answer identifies the student problem but needs a concrete result.',
      'strengths':['Names the audience.'],'improvements':['Add the observed result without inventing a number.'],
      'answerQuote':'I coached a student','evidenceIds':['an-untrusted-model-reference'],'followUp':'How did you check understanding?'}
    with patch.object(prep.enrich,'complete',return_value=json.dumps(feedback)) as complete:
        result=prep.run(1,'practice','practice-one','q1','I coached a student using a short Python exercise.',first_plan)
        assert result['ok'];assert prep.read(1)['practice'][0]['feedback']['answerQuote']=='I coached a student'
        assert prep.read(1)['practice'][0]['feedback']['evidenceIds']==['r0-deliverables-0']
        bad_quote={**feedback,'answerQuote':'Invented words never spoken'}
        complete.return_value=json.dumps(bad_quote)
        assert not prep.run(1,'practice','practice-bad','q1','I coached a student.',first_plan)['ok']
        assert prep.read(1)['operation']['failureCode']=='invalid_answer_evidence'
        assert len(prep.read(1)['practice'])==1
    bad_plan=copy.deepcopy(plan);bad_plan['questions'][0]['evidenceIds']=['invented-role']
    with patch.object(prep.enrich,'complete',return_value=json.dumps(bad_plan)):
        assert not prep.run(1,request_id='prepare-bad')['ok'];assert prep.read(1)['planId']==first_plan
    config.CAREER_DB.write_text(json.dumps({**candidate,'newFact':'changed'}));profile.load.cache_clear()
    with patch.object(prep.enrich,'complete') as complete:
        assert prep.run(1,'practice','practice-stale','q1','I coached a student.',first_plan)['error']=='preparation_stale'
        complete.assert_not_called()
    with patch.object(prep.enrich,'complete',return_value=json.dumps(plan)):
        assert prep.run(1,request_id='prepare-new')['ok'];record=prep.read(1)
        assert record['planId']!=first_plan;assert len(record['practice'])==1
        assert record['practice'][0]['planId']==first_plan
    with patch.object(prep.enrich,'complete') as complete:
        assert prep.run(1,'practice','old-question-plan','q1','I coached a student.',first_plan)['error']=='preparation_stale'
        complete.assert_not_called()
    config.CAREER_DB.write_bytes(profile_before)
    assert hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()==before
    assert (root/'interviews/1.json').stat().st_mode&0o777==0o600
    private=root/'other-owner';private.mkdir();config.DATA_DIR=private;assert prep.read(1).get('plan') is None
    (private/'interviews/1.json').symlink_to(root/'interviews/1.json')
    try:prep.read(1);raise AssertionError('symlink accepted')
    except ValueError:pass
print(json.dumps({'checks':9,'failed':[]}))
