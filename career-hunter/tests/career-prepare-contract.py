# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Prove failed source verification/size/storage reaches a terminal receipt before any scoring call.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise exact selected-job scoring and real packet templates, idempotence, terminal receipts and read-only corpus preservation with fixture inference and PDF rendering.
import os,sys,json,tempfile,hashlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config,db,profile,score,generate,prepare
with tempfile.TemporaryDirectory(prefix='career-prepare-') as tmp:
 root=Path(tmp);config.DATA_DIR=root;config.CORPUS_DB=root/'corpus.db';config.USER_DB=root/'user.db';generate.APP_DIR=root/'applications'
 prof={'profile':{'name':'Fixture Applicant','email':'fixture@example.test','experience_summary':'Platform delivery'},'roles':[{'title':'Engineer','org':'Fixture','start':'2020','end':'2026','bullets':['Built a platform.']}],'skills':{}}
 with db.connect() as con:
  con.execute("INSERT INTO corpus.companies(id,name)VALUES(1,'Fixture Employer')")
  for i in [1,2,3,4]:con.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role) VALUES(?,1,?,'Platform Engineer','Python platform',1,1)",(i,str(i)))
 config.CORPUS_DB.chmod(0o440);before=hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()
 response={'resume':{'headline':'Platform Engineer','summary':'Built a platform.','experience':[],'education':[],'skills':[]},'cover':{'paragraphs':['I am applying for Platform Engineer.']}}
 calls=[]
 def scoring(row,summary):calls.append(row['id']);return {'id':row['id'],'data':{'fit_score':84,'rationale':'Fixture match','matched':['Python'],'gaps':[]}}
 def pdf(html,out):out.write_bytes(b'%PDF-1.4\nfixture\n%%EOF')
 with patch.object(prepare.render,'_chromium_binary',return_value='/fixture/chrome'),patch.object(profile,'load',return_value=prof),patch.object(profile,'summary',return_value='Fixture profile'),patch.object(score,'_score_one',side_effect=scoring),patch.object(generate.enrich,'provider',return_value='fixture'),patch.object(generate.enrich,'complete',return_value=json.dumps(response)),patch.object(generate,'_polish_cover',side_effect=lambda cover,*args:cover),patch.object(generate,'_render_pdf',side_effect=pdf):
  one=prepare.prepare_job(1,documents=False,request_id='score-one');assert one['phase']=='scored'
  with db.connect() as c:assert c.execute('SELECT ai_fit_score FROM user_signals WHERE posting_id=1').fetchone()[0]==84
  two=prepare.prepare_job(2,documents=True,request_id='documents-two',guidance='Emphasize platform experience');assert two['phase']=='ready',two
  with db.connect() as c:
   r=c.execute('SELECT status,resume_path,cover_path,applied_at FROM user_signals WHERE posting_id=2').fetchone();assert r['status']=='generated' and r['applied_at'] is None;assert Path(r['resume_path']).read_bytes().startswith(b'%PDF');assert Path(r['cover_path']).is_file()
  assert prepare.prepare_job(2,documents=True,request_id='documents-two')['duplicate'];assert calls==[1,2]
  with patch.object(score,'_score_one',return_value={'data':{}}):assert prepare.prepare_job(3,request_id='failed-three')['error']=='score_unavailable'
  with patch.object(prepare.render,'_chromium_binary',return_value='/fixture/chrome'),patch.object(profile,'load',return_value={}):assert prepare.prepare_job(4,request_id='empty-resume')['error']=='resume_required'
  for reason in ('job_context_too_large','job_context_unavailable','job_context_limit_reached'):
   count=len(calls)
   with patch.object(prepare.job_context,'ensure',side_effect=ValueError(reason)):
    result=prepare.prepare_job(4,documents=False,request_id=reason)
   assert result['phase']=='failed' and result['error']==reason,result
   assert len(calls)==count
   assert json.loads((root/'job-board-state.json').read_text())['jobs']['4']['error']==reason
  for reason in ('model-identity-unavailable','model-identity-mismatch'):
   with patch.object(score,'_score_one',side_effect=prepare.enrich.CareerWorkerUnavailable(reason)):
    result=prepare.prepare_job(4,documents=False,request_id=reason)
   assert result['phase']=='failed' and result['error']==reason.replace('-','_'),result
   assert json.loads((root/'job-board-state.json').read_text())['jobs']['4']['error']==reason.replace('-','_')
  state=json.loads((root/'job-board-state.json').read_text());assert state['jobs']['2']['favorite'];assert state['jobs']['3']['phase']=='failed'
 compact=json.dumps(generate._prep_profile(prof,False),ensure_ascii=False,separators=(',',':'))
 assert compact in generate.build_prompt(prof,'Fixture Employer','Platform Engineer','Remote','Python')
 assert json.loads(compact)==generate._prep_profile(prof,False), 'Prompt compaction keeps every fact'
 assert hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()==before
print(json.dumps({'checks':13,'failed':[]}))
