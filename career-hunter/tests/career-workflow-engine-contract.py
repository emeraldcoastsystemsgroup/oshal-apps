# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real saved-job batch and packet writers against made-up profiles and jobs with network tripwires.
import os,sys,json,tempfile,hashlib,socket
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config,db,profile,score,generate,prepare
from jobhunter.workflow import prepare_saved
with tempfile.TemporaryDirectory(prefix='workflow-engine-') as tmp:
 root=Path(tmp);config.DATA_DIR=root;config.CORPUS_DB=root/'corpus.db';config.USER_DB=root/'user.db';generate.APP_DIR=root/'applications'
 config.CAREER_DB=root/'career_db.json'
 prof={'profile':{'name':'Fictional Applicant','email':'fiction@example.test','experience_summary':'Office support'},'roles':[{'title':'Assistant','org':'Fiction Office','start':'2020','end':'2025','bullets':['Organized records.']}],'skills':{}}
 with db.connect() as con:
  con.execute("INSERT INTO corpus.companies(id,name)VALUES(1,'Invented employer')")
  for i in [1,2,3]:
   con.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,url,active)VALUES(?,1,?,'Office assistant','Organize records','https://employer.example.test/job',1)",(i,str(i)))
   con.execute("INSERT INTO user_signals(posting_id,status)VALUES(?,'promoted')",(i,))
 state={'version':1,'jobs':{str(i):{'favorite':True,'workflow':{'batchId':'fiction-batch','mode':'automatic'},'generationDraft':{'requestId':'fiction-request-'+str(i),'inputs':{'guidance':'Use recorded office work.','experienceIds':[],'experienceRevision':''},'state':'requested'}} for i in [1,2,3]}}
 state['jobs']['3']['favorite']=False
 (root/'job-board-state.json').write_text(json.dumps(state))
 before=hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest();calls=[]
 def scoring(row,summary):
  calls.append(row['id'])
  if row['id']==2:raise ValueError('score_unavailable')
  return {'id':row['id'],'data':{'fit_score':80,'rationale':'Recorded work','matched':['Records'],'gaps':[]}}
 response={'resume':{'headline':'Office assistant','summary':'Organized records.','experience':[],'education':[],'skills':[]},'cover':{'paragraphs':['I am applying for Office assistant.']}}
 def pdf(html,out):out.write_bytes(b'%PDF-1.4 fictional packet\n%%EOF')
 with patch.object(socket,'create_connection',side_effect=AssertionError('No employer/network call')),patch.object(prepare.job_context,'ensure',side_effect=lambda row:row),patch.object(prepare.render,'_chromium_binary',return_value='/fiction/chrome'),patch.object(profile,'load',return_value=prof),patch.object(profile,'summary',return_value='Fictional office work'),patch.object(score,'_score_one',side_effect=scoring),patch.object(generate.enrich,'provider',return_value='fixture'),patch.object(generate.enrich,'complete',return_value=json.dumps(response)),patch.object(generate,'_polish_cover',side_effect=lambda cover,*args:cover),patch.object(generate,'_render_pdf',side_effect=pdf):
  assert prepare_saved('fiction-batch')['processed']==0 and calls==[]
  (root/'application-workflow.json').write_text(json.dumps({'version':1,'enabled':True,'mode':'automatic'}))
  result=prepare_saved('fiction-batch');assert result['processed']==2 and calls==[1,2],result
  receipt=json.loads((root/'job-board-state.json').read_text());assert receipt['jobs']['1']['phase']=='ready' and receipt['jobs']['2']['error']=='score_unavailable'
  with db.connect() as con:
   rows=[dict(row) for row in con.execute('SELECT posting_id,status,resume_path,cover_path,applied_at FROM user_signals ORDER BY posting_id')]
   assert rows[0]['status']=='generated' and Path(rows[0]['resume_path']).read_bytes().startswith(b'%PDF')
   assert all(row['applied_at'] is None for row in rows) and rows[2]['status']=='promoted'
  assert prepare_saved('fiction-batch')['processed']==0 and calls==[1,2]
  assert hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()==before
print(json.dumps({'checks':6,'failed':[]}))
