# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove native browser dispatch, complete payload parsing, explicit source failures and immutable existing jobs through real disposable SQLite.
from __future__ import annotations
import json,os,sys,tempfile,unittest,subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
os.environ['JOBHUNTER_MULTIUSER']='1';os.environ['JOBHUNTER_STORE']='sqlite'
from jobhunter import config,db,native_browser,webscrape,source_memory,ats

URL='https://employer.example/careers'
def evidence(**patches):
    return {'version':1,'dom':[{'url':'https://employer.example/jobs/one','title':'Platform Engineer','location':'Remote'}],
        'payloads':[{'url':'https://employer.example/api/jobs','baseUrl':URL,'body':json.dumps({'jobs':[
            {'jobId':'two','title':'Adjunct Lecturer','jobUrl':'/jobs/two','description':'Complete employer requirement. '*100}]})}],
        'pages':3,'reason':'completion_unverified',**patches}

class NativeSource(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='career-native-source-');self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.settings=patch.multiple(config,DATA_DIR=root,CORPUS_DB=root/'corpus.db',USER_DB=root/'user.db',MULTIUSER=True,POSTGRES=False)
        self.settings.start();self.addCleanup(self.settings.stop)
        self.env=patch.dict(os.environ,{'JOBHUNTER_BROWSER_NATIVE':'1','JOBHUNTER_BROWSER_NODE':'/usr/bin/node','JOBHUNTER_BROWSER_EXECUTABLE':'/fixture/browser/chrome',
          'OSHAL_ADMIN_TOKEN':'must-not-reach-browser','CAREER_RAIL_GRANT':'must-not-reach-browser','ANTHROPIC_API_KEY':'must-not-reach-browser'})
        self.env.start();self.addCleanup(self.env.stop)

    def run_browser(self,value=None,**result):
        response=SimpleNamespace(returncode=0,stdout=json.dumps(evidence() if value is None else value),stderr='',**result)
        return patch.object(native_browser,'_run',return_value=response)

    def test_native_dispatch_keeps_complete_employer_text_and_no_applicant_environment(self):
        with self.run_browser() as run:
            rows=webscrape.scrape_careers(URL)
        self.assertEqual([row['title']for row in rows],['Platform Engineer','Adjunct Lecturer'])
        self.assertEqual(rows[1]['description'],'Complete employer requirement. '*99+'Complete employer requirement.')
        self.assertFalse(rows.complete);self.assertEqual(rows.reason,'completion_unverified')
        call=run.call_args;self.assertEqual(call.args[0][0],'/usr/bin/node')
        self.assertTrue(call.args[0][1].endswith('/browser_fetch.cjs'))
        self.assertEqual(json.loads(call.args[1])['url'],URL)
        self.assertFalse({'OSHAL_ADMIN_TOKEN','CAREER_RAIL_GRANT','ANTHROPIC_API_KEY'}&call.args[2].keys())

    def test_absent_optional_bundle_is_a_closed_observation_not_a_python_import_failure(self):
        with patch.dict(os.environ,{'JOBHUNTER_BROWSER_NATIVE':'unavailable'}),patch.object(native_browser,'_run') as run:
            with self.assertRaisesRegex(native_browser.BrowserReadUnavailable,'^browser_runtime_unavailable$'):
                webscrape.scrape_careers(URL)
            run.assert_not_called()

    def test_bad_metadata_private_schemes_and_unbounded_payloads_are_refused(self):
        for value in [evidence(version=True),evidence(version=2),evidence(reason='raw secret'),evidence(pages=81),evidence(dom=[{'url':'javascript:alert(1)','title':'Danger'}]),
            evidence(payloads=[{'body':'{}','baseUrl':'file:///secret'}])]:
            with self.subTest(value=value),self.run_browser(value):
                with self.assertRaises(native_browser.BrowserReadUnavailable):native_browser.scrape(URL,80)

    def test_failed_helper_never_stores_its_raw_error_body(self):
        response=SimpleNamespace(returncode=2,stdout='',stderr='private path /home/person and token')
        with patch.object(native_browser,'_run',return_value=response):
            with self.assertRaisesRegex(native_browser.BrowserReadUnavailable,'^browser_read_failed$'):native_browser.scrape(URL,80)

    def test_source_browser_failure_preserves_existing_active_jobs(self):
        with db.connect()as conn:
            conn.execute("INSERT INTO corpus.companies(id,name,ats_type,ats_token)VALUES(1,'Fixture','web',?)",(URL,))
            db.upsert_posting(conn,1,{'ats_job_id':'old','title':'Existing role','description':'Existing body','url':URL+'/jobs/old'})
        with patch.object(ats,'fetch',side_effect=native_browser.BrowserReadUnavailable('browser_runtime_unavailable')):
            with self.assertRaises(native_browser.BrowserReadUnavailable):source_memory.fetch(1,'web',URL)
        with db.connect()as conn:
            row=conn.execute('SELECT status,last_error_code FROM corpus.source_pull_state WHERE company_id=1').fetchone()
            self.assertEqual(tuple(row),('failed','browser_runtime_unavailable'))
            self.assertEqual(conn.execute('SELECT active FROM corpus.postings_corpus').fetchone()[0],1)

    def test_partial_pagination_adds_observed_jobs_and_never_closes_older_ones(self):
        with db.connect()as conn:
            conn.execute("INSERT INTO corpus.companies(id,name,ats_type,ats_token)VALUES(1,'Fixture','web',?)",(URL,))
            db.upsert_posting(conn,1,{'ats_job_id':'old','title':'Existing role','url':URL+'/jobs/old'})
        with self.run_browser(evidence(reason='page_limit_reached')):
            rows=source_memory.fetch(1,'web',URL)
        with db.connect()as conn:
            result=source_memory.ingest(conn,1,rows);self.assertFalse(result['complete']);self.assertEqual(result['closed'],0)
            self.assertEqual(conn.execute('SELECT count(*) FROM corpus.postings_corpus WHERE active=1').fetchone()[0],3)
            self.assertEqual(conn.execute('SELECT last_error_code FROM corpus.source_pull_state WHERE company_id=1').fetchone()[0],'page_limit_reached')

    def test_hard_helper_deadline_aborts_ingest_init_instead_of_leaving_a_browser_behind(self):
        child=SimpleNamespace(pid=919191,communicate=lambda *args,**kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired('fixture',135)))
        with patch.object(native_browser.subprocess,'Popen',return_value=child),patch.object(native_browser.os,'killpg') as kill:
            with self.assertRaisesRegex(SystemExit,'browser_process_deadline'):native_browser.scrape(URL,80)
        kill.assert_called_once_with(919191,native_browser.signal.SIGKILL)

    def test_real_language_teaching_titles_and_single_schema_posting_keep_employer_evidence(self):
        description='<p>Teach English literature.</p><p>Master degree required. '+('Employer-specific evidence. '*200)+'</p>'
        payload={'@type':['Thing','JobPosting'],'title':'English Professor','url':'/faculty/42','description':description}
        value=evidence(dom=[{'url':'https://employer.example/jobs/type','title':'Developer <T>','location':None}],
            payloads=[{'url':URL,'baseUrl':URL,'body':json.dumps(payload)},
                {'url':URL,'baseUrl':URL,'body':json.dumps({'jobs':[{'jobId':'42','title':'English Professor','applicationUrl':'/faculty/42'}]})}])
        with self.run_browser(value):rows=native_browser.scrape(URL,80)
        self.assertEqual(rows[0]['title'],'Developer <T>')
        self.assertEqual(rows[1]['title'],'English Professor')
        self.assertEqual(rows[1]['description'],webscrape._clean(description))
        self.assertTrue(webscrape._looks_like_job({'title':'Franchise Developer','jobId':'42'}))
        self.assertFalse(webscrape._looks_like_job({'title':'English','id':'en'}))

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(NativeSource)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'checks':result.testsRun,'failed':len(result.failures)+len(result.errors)}))
    sys.exit(not result.wasSuccessful())
