# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove opt-in additional experience reaches actual packet templates without leaking unselected work or editing the core profile.
import os,sys,json,tempfile,hashlib
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config,db,profile,score,generate,prepare,experience_bank
with tempfile.TemporaryDirectory(prefix='career-additional-') as tmp:
 root=Path(tmp);config.DATA_DIR=root;config.CAREER_DB=root/'career_db.json';config.CORPUS_DB=root/'corpus.db';config.USER_DB=root/'user.db';generate.APP_DIR=root/'applications'
 prof={'profile':{'name':'Fixture Applicant','experience_summary':'Recorded platform work'},'roles':[{'title':'Engineer','org':'Core Employer','start':'2020','end':'2024','deliverables':['Built Python automation.']}],'skills':{},'oss_portfolio':{'label':'Owned product','scoring_blurb':'LEGACY_PRIVATE_MARKER: Built an independent product.'}}
 config.CAREER_DB.write_text(json.dumps(prof));master=config.CAREER_DB.read_bytes();profile.load.cache_clear()
 entry={'id':'fixture-teaching','title':'Weekend teaching','kind':'volunteer','organization':'Owned school','period':'2024 to 2025','facts':'PRIVATE_OPTIONAL_MARKER: Taught Python workshops.','skills':['Python','Teaching'],'archived':False}
 (root/'experience-bank.json').write_text(json.dumps({'version':1,'entries':[entry]}));bank=experience_bank.read()
 with db.connect() as c:
  c.execute("INSERT INTO corpus.companies(id,name)VALUES(1,'Owned Employer')")
  for i in range(1,6):c.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role)VALUES(?,1,?,'Engineer','Python delivery',1,1)",(i,str(i)))
 calls=[];contexts=[];mode={'marker':'PRIVATE_OPTIONAL_MARKER','title':'Weekend teaching'}
 def inference(system,prompt,**kwargs):
  calls.append((system,prompt));return json.dumps({'resume':{'headline':'Engineer','summary':'Built Python automation.','experience':[],'skills':['Python'],'education':[],'additional_experience':[{'title':mode['title'],'org':'Independent work','span':'','bullets':[mode['marker']]}]},'cover':{'greeting':'Dear Hiring Manager,','paragraphs':['I built Python automation.'],'closing':'Sincerely,'}})
 def scoring(row,context):contexts.append(context);return {'id':row['id'],'data':{'fit_score':85,'rationale':'Fixture','matched':['Python'],'gaps':[]}}
 def pdf(html,out):out.write_bytes(b'%PDF-1.4\nowned\n%%EOF')
 with patch.object(prepare.render,'_chromium_binary',return_value='/owned/chrome'),patch.object(score,'_score_one',side_effect=scoring),patch.object(generate.enrich,'provider',return_value='fixture'),patch.object(generate.enrich,'complete',side_effect=inference),patch.object(generate,'_polish_cover',side_effect=lambda cover,*args:cover),patch.object(generate,'_render_pdf',side_effect=pdf):
  assert prepare.prepare_job(1,request_id='core-only')['ok']
  assert 'PRIVATE_OPTIONAL_MARKER'not in calls[-1][1] and 'LEGACY_PRIVATE_MARKER'not in calls[-1][1]
  folder=next(generate.APP_DIR.glob('*__1'));assert 'Additional Experience'not in(folder/'Resume_ATS.html').read_text();assert 'additional_experience'not in json.loads((folder/'application.json').read_text())['generated']['resume']
  assert 'PRIVATE_OPTIONAL_MARKER'in contexts[0],'private fit can consider the active experience library'
  assert prepare.prepare_job(2,request_id='with-teaching',experience_ids=[entry['id']],experience_revision=bank['revision'])['ok']
  assert 'PRIVATE_OPTIONAL_MARKER'in calls[-1][1] and 'LEGACY_PRIVATE_MARKER'not in calls[-1][1];assert 'not employer work'in calls[-1][0]
  folder=next(generate.APP_DIR.glob('*__2'));doc=json.loads((folder/'application.json').read_text());assert doc['additional_experience']==[{'id':entry['id'],'title':entry['title']}]
  for name in ['Resume_ATS','Resume_Premium','Resume_1page']:
   html=(folder/(name+'.html')).read_text();assert 'Additional Experience'in html and 'PRIVATE_OPTIONAL_MARKER'in html;assert (folder/(name+'.pdf')).is_file()
  assert doc['profile_snapshot']['additional_experience'][0]['id']==entry['id'];assert 'oss_portfolio'not in doc['profile_snapshot']
  mode.update(marker='LEGACY_PRIVATE_MARKER',title='Owned product')
  assert prepare.prepare_job(3,request_id='with-product',experience_ids=[experience_bank.LEGACY],experience_revision=bank['revision'])['ok']
  assert 'LEGACY_PRIVATE_MARKER'in calls[-1][1] and 'PRIVATE_OPTIONAL_MARKER: Taught'not in calls[-1][1]
  count=len(calls);assert prepare.prepare_job(4,request_id='stale-selection',experience_ids=[entry['id']],experience_revision='stale')['error']=='experience_selection_changed';assert len(calls)==count
  entry['archived']=True;(root/'experience-bank.json').write_text(json.dumps({'version':1,'entries':[entry]}));new=experience_bank.read()
  assert prepare.prepare_job(5,request_id='archived-selection',experience_ids=[entry['id']],experience_revision=new['revision'])['error']=='experience_selection_changed';assert len(calls)==count
 assert config.CAREER_DB.read_bytes()==master
print(json.dumps({'checks':8,'failed':[]}))
