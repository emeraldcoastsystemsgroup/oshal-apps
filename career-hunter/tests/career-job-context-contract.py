# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove fetched employer details survive a read-only corpus and reach both fit scoring and document generation, with profile/source snapshots and no shared writes.
import hashlib,json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config,db,profile,score,generate,prepare,detail,job_context,enrich,http

def cache_regressions(original):
 """Synthetic cache-only checks; emitted cases are consumed by the real Node reader."""
 with tempfile.TemporaryDirectory(prefix='career-cache-regressions-') as temporary, patch.object(config,'DATA_DIR',Path(temporary)):
  root=Path(temporary);row={**original,'description':'L'*1200};cases=[]
  def case(name,row,value,applied=True):
   cases.append({'name':name,'row':row,'context':value,'applied':applied})
  # A shorter employer body is authoritative, with complete source-size provenance.
  saved=job_context.remember(row,{'description':'Verified employer statement.'})
  assert job_context.apply(row)['description']==saved['description']
  assert saved['sourceChars']==len(saved['description']) and saved['sourceBytes']==len(saved['description'].encode())
  assert saved['truncated']is False and saved['descriptionSha256']==hashlib.sha256(saved['description'].encode()).hexdigest()
  case('short authoritative employer body',row,saved)
  assert job_context.apply(job_context.apply(row))==job_context.apply(row)
  case('idempotent already hydrated row',job_context.apply(row),saved)
  # Astral code points no longer produce Python/Node length-selection disagreements.
  unicode_saved=job_context.remember(row,{'description':'😀'*600})
  assert job_context.apply(row)['description']=='😀'*600
  assert unicode_saved['sourceChars']==600 and unicode_saved['sourceBytes']==2400
  case('astral code point authority and size',row,unicode_saved)
  for body in ('\ufeff','  Exact original employer statement.\n'):
   exact=job_context.remember(row,{'description':body})
   assert exact['description']==body and exact['sourceChars']==len(body) and exact['sourceBytes']==len(body.encode())
   case('complete source including whitespace '+repr(body),row,exact)
  boundary=job_context.remember(row,{'description':'😀'*64000})
  assert job_context.read(row)['sourceChars']==64000 and boundary['sourceBytes']==256000
  case('full Unicode size boundary',row,boundary)
  # Both character and serialized-byte bounds refuse before replacing prior evidence.
  path=root/'job-context/1.json';before=path.read_bytes()
  for source,body in ((row,'x'*64001),({**row,'title':'T'*12000},'\x00'*64000)):
   try:job_context.remember(source,{'description':body});raise AssertionError('oversize must refuse')
   except ValueError as error:assert str(error)=='job_context_too_large'
   assert path.read_bytes()==before
  with patch.object(Path,'replace',side_effect=OSError('fixture atomic failure')):
   try:job_context.remember(row,{'description':'Replacement'});raise AssertionError('write must fail')
   except OSError:pass
  assert path.read_bytes()==before and not list(path.parent.glob('*.tmp'))
  for fields in ({'sourceChars':1},{'sourceBytes':1},{'truncated':True},{'basis':'unverified'},{'snapshot':[]}):
   path.write_text(json.dumps({**saved,**fields}))
   try:job_context.read(row);raise AssertionError('invalid source metadata must refuse')
   except ValueError as error:assert str(error)=='job_context_unavailable'
  # Age alone never takes a job's details away: an old copy of an unchanged listing still applies.
  value={**saved,'retrievedAt':'2000-01-01T00:00:00Z'};path.write_text(json.dumps(value))
  assert job_context.read(row)==value and not job_context.needs_refresh(row)
  case('old copy of an unchanged listing',row,value)
  # Legacy/future entries are never reused as current employer evidence.
  for name,patches in [('future',{'retrievedAt':'2999-01-01T00:00:00Z'}),('legacy',{'version':1})]:
   value={**saved,**patches};path.write_text(json.dumps(value))
   assert job_context.read(row)is None and job_context.needs_refresh(row)
   case(name,row,value,False)
  # Every relevant listing fact binds detail; observations/private workflow do not.
  job_context.remember(row,{'description':saved['description']})
  for key,value in {'ats_job_id':'changed','title':'changed','url':'https://changed.example.test','description':'changed','location':'Canada','remote':1,'department':'changed','job_type':'contract','posted_at':'2020-01-01','posted_date':'2020-01-01','state':'changed','city':'changed','lat':10,'lon':10,'salary_min':123,'salary_max':456,'salary_currency':'CAD','salary_period':'hour','salary_raw':'CAD 123/hour'}.items():
   changed={**row,key:value};assert job_context.read(changed)is None,key
   case('binding '+key,changed,job_context.read(row),False)
  ignored={**row,'last_seen_at':'2999-01-01','first_seen_at':'1999-01-01','status':'applied','ai_fit_score':99,'salary_source':'ai_estimated','salary_min':123,'salary_max':456}
  assert job_context.read(ignored)is not None
  case('observation private workflow estimated pay ignored',ignored,job_context.read(row))
  # Quota recovers only expired regular derived records inside this owner's directory.
  expired={**saved,'retrievedAt':'2000-01-01T00:00:00Z'}
  for posting_id in range(1,1001):
   (path.parent/f'{posting_id}.json').write_text(json.dumps(expired))
  sentinel=path.parent/'historical-packet.txt';sentinel.write_text('retain')
  job_context.remember({**row,'id':1001},{'description':'Current employer evidence.'})
  assert len(list(path.parent.glob('*.json')))==1 and sentinel.read_text()=='retain'
  assert (path.parent/'1001.json').stat().st_mode&0o777==0o600
  # A fully fresh quota refuses explicitly and keeps the existing current cache intact.
  with patch.object(job_context,'MAX_ENTRIES',1):
   try:job_context.remember({**row,'id':1002},{'description':'Next body'});raise AssertionError('fresh quota must refuse')
   except ValueError as error:assert str(error)=='job_context_limit_reached'
  assert not(path.parent/'1002.json').exists()
  return {'checks':10,'cases':cases}

with tempfile.TemporaryDirectory(prefix='career-context-') as temporary:
 root=Path(temporary);config.DATA_DIR=root;config.CORPUS_DB=root/'corpus.db';config.USER_DB=root/'user.db';config.CAREER_DB=root/'career_db.json';generate.APP_DIR=root/'applications'
 candidate={'profile':{'name':'Fixture Candidate','email':'candidate@example.test','experience_summary':'Recorded engineering background. '*180},'roles':[{'title':'Engineer','org':'Fixture Services','start':'2020','end':'2024','deliverables':['Maintained Linux automation for a test environment.','Recorded release support.','Recorded observability support.','Built verified Ansible playbooks for the fixture.']}],'skills':{'systems':{'items':[f'Fixture skill {i}'for i in range(65)]+['Verified Nessus operations']}},'education':['Recorded fixture education'],'certifications':['Recorded fixture certification'],'oss_portfolio':{'scoring_blurb':'Recorded independent fixture project'}}
 config.CAREER_DB.write_text(json.dumps(candidate));profile.load.cache_clear()
 url='https://fixture.wd5.myworkdayjobs.com/en-US/Careers/job/Local/Engineer_REQ-123/apply'
 with db.connect() as conn:
  conn.execute("INSERT INTO corpus.companies(id,name,ats_type,ats_token)VALUES(1,'Fixture Employer','phenom','summary-feed')")
  conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,url,active,target_role)VALUES(1,1,'REQ-123','Linux Engineer','Short source summary',?,1,1)",(url,))
  conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role)VALUES(2,1,'empty','Unknown job',NULL,1,1)")
  original=dict(conn.execute('SELECT * FROM postings WHERE id=1').fetchone())
 before=hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest();config.CORPUS_DB.chmod(0o440)
 full=('Operate Linux systems and automate reliable delivery. '*145)+' Distinct final requirement: maintain secure test-network recovery exercises.'
 prompts=[];requests=[]
 generated={'resume':{'headline':'Linux Engineer','summary':'Maintained Linux automation.','experience':[{'title':'Engineer','org':'Fixture Services','span':'2020 - 2024','bullets':['Maintained Linux automation for a test environment.']}],'skills':[],'education':[]},'cover':{'greeting':'Dear Hiring Manager,','paragraphs':['I am interested in this Linux Engineer role.','My recorded work includes maintaining Linux automation.','I would welcome a discussion.']}}
 def model(system,prompt,max_tokens=0,**kwargs):
  prompts.append((max_tokens,prompt));return json.dumps({'fit_score':82,'rationale':'Linux automation matches.','matched':['Linux'],'gaps':[]}) if max_tokens==score.SCORING_MAX_TOKENS else json.dumps(generated['cover']if max_tokens==2000 else generated)
 def request(endpoint,*args,**kwargs):
  requests.append(endpoint);return {'jobPostingInfo':{'jobDescription':'<p>'+full+'</p>'}}
 def render(_html,out):out.write_bytes(b'%PDF-1.4\nfixture\n%%EOF')
 with patch.object(detail.http,'get_json',side_effect=request),patch.object(generate.enrich,'provider',return_value='fixture'),patch.object(generate.enrich,'complete',side_effect=model),patch.object(generate,'_render_pdf',side_effect=render),patch.object(prepare.render,'_chromium_binary',return_value='/fixture/chrome'):
  result=prepare.prepare_job(1,request_id='context-documents');assert result['ok'],result
 assert requests==['https://fixture.wd5.myworkdayjobs.com/wday/cxs/fixture/Careers/job/Local/Engineer_REQ-123']
 assert all('Distinct final requirement' in prompt for tokens,prompt in prompts), 'Scoring and generation must both receive requirements beyond the old 6000-character cap'
 assert len(prompts)==3
 scoring_prompt=next(prompt for tokens,prompt in prompts if tokens==score.SCORING_MAX_TOKENS)
 assert all(fact in scoring_prompt for fact in ['Built verified Ansible playbooks','Verified Nessus operations','Recorded fixture education','Recorded fixture certification','Recorded independent fixture project'])
 assert json.loads(profile.scoring_context())==candidate
 assert 'oss_portfolio' not in json.loads(profile.scoring_context(include_oshal=False))
 with patch.object(profile,'load',return_value={'profile':{'experience_summary':'x'*(129*1024)}}):
  try:profile.scoring_context();raise AssertionError('Oversized scoring context must not be silently truncated')
  except ValueError as error:assert str(error)=='profile_too_large_for_scoring'
 saved=job_context.read(original);assert saved['description']==full
 packet=json.loads(next((root/'applications').glob('*/application.json')).read_text())
 assert packet['job_context']['description']==full;assert packet['profile_snapshot']==generate._prep_profile(candidate,False)
 with db.connect() as conn:
  assert conn.execute('SELECT ai_model FROM user_signals WHERE posting_id=1').fetchone()[0]=='oshal-career-bot'
 assert hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()==before
 assert json.loads(config.CAREER_DB.read_text())==candidate
 assert (root/'job-context/1.json').stat().st_mode&0o777==0o600
 with patch.object(detail,'fetch',return_value={}),patch.object(score,'_score_one') as scoring:
  missing=prepare.prepare_job(2,request_id='missing-details');assert missing['error']=='job_details_unavailable';scoring.assert_not_called()
 with patch.dict(os.environ,{'OSHAL_EGRESS':'kernel'}),patch.object(enrich,'_rail_post',return_value=(200,{'ok':True,'status':200,'body':'{"jobPostingInfo":{"jobDescription":"Kernel employer detail"}}','contentType':'application/json'})) as broker,patch.object(http._session,'request') as direct:
  assert http.get_json(url)['jobPostingInfo']['jobDescription']=='Kernel employer detail'
  assert json.loads(broker.call_args.args[0])=={'operation':'employer-detail-get','url':url}
  direct.assert_not_called()
 with patch.object(enrich,'complete',side_effect=['{"fit_score":', '{"fit_score":82}']) as retry:
  assert score._score_one(original,'Recorded Linux automation')['data']['fit_score']==82
  assert [call.kwargs['max_tokens']for call in retry.call_args_list]==[1400,2048]
 with patch.object(enrich,'complete',return_value='{"fit_score":true}') as retry:
  assert score._score_one(original,'Recorded Linux automation')['data'] is None
  assert retry.call_count==2, 'Invalid JSON/fit results have only one bounded retry'
 with patch.object(enrich,'complete',side_effect=['{"fit_score":82,"gaps":{}}','{"fit_score":82}']) as retry:
  assert score._score_one(original,'Recorded Linux automation')['data']=={'fit_score':82}
  assert retry.call_count==2
 with patch.object(detail,'fetch',return_value={}),patch.object(enrich,'complete',return_value='{"fit_score":50}') as model:
  score._score_one({**original,'id':2,'description':'Short listing summary'},'Recorded experience')
  assert 'SOURCE LIMITATION' in model.call_args.args[1]
 cache_proof=cache_regressions(original)
 print(json.dumps({'checks':12,'cacheChecks':cache_proof['checks'],'cacheCases':cache_proof['cases'],'original':original,'context':saved}))
