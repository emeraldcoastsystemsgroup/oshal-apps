# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real feed mapping, legacy SQL guards and structured workplace retention with synthetic fixtures and no network or model calls.
from pathlib import Path
import json
import sqlite3
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
from jobhunter import ats, geo, search_scope, webscrape
from jobhunter.work_arrangement import looks_remote, remote_location, fully_remote_predicate

CASES = json.loads(Path(__file__).with_name('career-work-arrangement-fixtures.json').read_text())


class WorkArrangementTests(unittest.TestCase):
    def test_metadata_and_legacy_sql_share_evidence_rules(self):
        conn = sqlite3.connect(':memory:')
        self.addCleanup(conn.close)
        conn.execute('CREATE TABLE p(title TEXT, location TEXT, remote INTEGER)')
        for case in CASES:
            with self.subTest(case=case):
                self.assertEqual(looks_remote(case['title'], case['location'], verified=case.get('structured')), case['expected'])
                conn.execute('DELETE FROM p')
                conn.execute('INSERT INTO p VALUES(?,?,?)', (case['title'], case['location'], case['remote']))
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM p WHERE '+fully_remote_predicate('p')).fetchone()[0], case['expected'])
        with self.assertRaises(ValueError):
            fully_remote_predicate('p); DROP TABLE p;--')

    def test_structured_true_is_retained_but_heuristics_are_not_promoted(self):
        cases = [
            ('Remote Sensing Engineer', 'Seattle, WA', True, 1, 'Seattle, WA / Remote'),
            ('Developer', 'Seattle, WA', 'false', 0, 'Seattle, WA'),
            ('Developer', 'Seattle, WA', False, 0, 'Seattle, WA'),
            ('Remote Developer', 'Remote, US', False, 0, 'Remote, US'),
            ('Developer', 'Hybrid Seattle, WA', True, 0, 'Hybrid Seattle, WA'),
            ('Developer', 'Not Remote', True, 0, 'Not Remote'),
            ('Remote Developer', 'Seattle, WA', None, 1, 'Seattle, WA'),
            ('Developer', None, True, 1, 'Remote'),
        ]
        jobs = [dict(id=i, title=t, location=l, isRemote=v) for i,(t,l,v,_,_) in enumerate(cases)]
        with patch.object(ats.http, 'get_json', return_value={'jobs': jobs}):
            rows = ats.Ashby.fetch('fixture')
        for row, (_, _, _, expected, location) in zip(rows, cases):
            self.assertEqual((row['remote'], row['location']), (expected, location))
        location = rows[0]['location']
        self.assertEqual(geo.state_of(location), 'WA')
        self.assertEqual(geo.place_of(location, 'WA'), geo.place_of('Seattle, WA', 'WA'))
        self.assertEqual(remote_location(location, verified=True), location, 'normal refreshes must be idempotent')
        self.assertEqual(remote_location('Seattle, WA', verified='yes'), 'Seattle, WA')
        for location in ('Seattle, WA', 'WA Seattle', 'USA WA Seattle', 'US-WA-Seattle'):
            with self.subTest(location=location):
                normalized = remote_location(location, verified=True)
                self.assertEqual(geo.state_of(normalized), geo.state_of(location))
                self.assertIsNotNone(geo.place_of(location,'WA'))
                self.assertEqual(geo.place_of(normalized,'WA'),geo.place_of(location,'WA'))

    def test_other_structured_feeds_do_not_treat_false_strings_as_true(self):
        with patch.object(ats.http, 'get_json', return_value={'jobs': [
            {'id':'1', 'title':'Remote Sensing Engineer', 'location':{'city':'Seattle','region':'WA'},'remote':True},
            {'id':'2', 'title':'Developer', 'location':{'city':'Seattle','region':'WA'},'remote':'false'},
        ]}):
            rows = ats.Workable.fetch('fixture')
        self.assertEqual([(r['remote'],r['location']) for r in rows], [(1,'Seattle, WA / Remote'),(0,'Seattle, WA')])
        with patch.object(ats.http, 'get_json', return_value={'totalFound':2, 'content':[
            {'id':'1','name':'Remote Sensing Engineer','location':{'city':'Seattle','region':'WA','remote':True}},
            {'id':'2','name':'Developer','location':{'city':'Seattle','region':'WA','remote':'false'}},
        ]}):
            rows = ats.SmartRecruiters.fetch('fixture')
        self.assertEqual([(r['remote'],r['location']) for r in rows], [(1,'Seattle, WA / Remote'),(0,'Seattle, WA')])

    def test_non_structured_feeds_cannot_promote_occupational_or_negated_text(self):
        with patch.object(ats.http, 'get_json', return_value={'jobs':[
            {'id':'1','title':'Remote Sensing Engineer','location':{'name':'Seattle, WA'}},
            {'id':'2','title':'Developer','location':{'name':'Not remote'}},
            {'id':'3','title':'Adjunct Business Instructor','location':{'name':'Remote'}},
        ]}):
            rows = ats.Greenhouse.fetch('fixture')
        self.assertEqual([r['remote'] for r in rows], [0,0,1])

    def test_public_education_location_metadata_obeys_the_same_rules(self):
        for location, expected in [('Not remote',0), ('Hybrid Remote',0), ('Remote',1)]:
            with self.subTest(location=location):
                soup = BeautifulSoup(f'''<table><tr data-job-url="/jobs/1">
                  <td class="job-search-results-title"><a href="/jobs/1">Adjunct Business Instructor</a></td>
                  <td class="job-search-results-requisition-identifiers">1</td>
                  <td class="job-search-results-location">{location}</td></tr></table>''', 'html.parser')
                rows, recognized, bad = ats.PageUp._parse(soup,'https://example.test')
                self.assertTrue(recognized)
                self.assertFalse(bad)
                self.assertEqual(rows[0]['remote'],expected)
                soup = BeautifulSoup(f'''<li data-job-id="1"><a class="item-details-link" href="/careers/test/jobs/1/role">Local Technician</a>
                  <ul class="list-meta"><li>{location}</li></ul></li>''','html.parser')
                rows, recognized, bad = ats.GovernmentJobs._parse(soup,'https://www.governmentjobs.com')
                self.assertTrue(recognized)
                self.assertFalse(bad)
                self.assertEqual(rows[0]['remote'],expected)

    def test_structured_workplace_options_preserve_conflicts(self):
        positions = [
            {'id':'1','name':'Remote Sensing Engineer','locations':['Seattle, WA'],'workLocationOption':'remote'},
            {'id':'2','name':'Developer','locations':['Seattle, WA'],'workLocationOption':'remote','locationFlexibility':'hybrid'},
        ]
        response = SimpleNamespace(ok=True,json=lambda:{'data':{'positions':positions,'count':2}})
        with patch.object(ats.http,'get_once',return_value=response):
            rows = ats.Eightfold.fetch('fixture.example.test|fixture')
        self.assertEqual([(r['remote'],r['location']) for r in rows],[(1,'Seattle, WA / Remote'),(0,'Seattle, WA')])

    def test_web_mapping_uses_explicit_source_fields_only(self):
        base = {'title':'Remote Sensing Engineer', 'location':'Seattle, WA','id':'1'}
        self.assertEqual(webscrape._map_job(base, 'https://example.test/jobs')['remote'], 0)
        for fields in ({'isRemote':True}, {'jobLocationType':'TELECOMMUTE'}, {'workplaceType':'remote'}):
            with self.subTest(fields=fields):
                row = webscrape._map_job(dict(base, **fields), 'https://example.test/jobs')
                self.assertEqual((row['remote'],row['location']), (1,'Seattle, WA / Remote'))
        for fields in ({'remote':True}, {'isRemote':'false'}, {'jobLocationType':'HYBRID'}, {'workplaceType':'onsite'}):
            with self.subTest(fields=fields):
                self.assertEqual(webscrape._map_job(dict(base, **fields), 'https://example.test/jobs')['remote'], 0)
        row = webscrape._map_job(dict(base, isRemote=True, workplaceType='hybrid'), 'https://example.test/jobs')
        self.assertEqual((row['remote'],row['location']), (0,'Seattle, WA'))
        row = webscrape._map_job(dict(base, workplaceType='remote', jobLocationType='HYBRID'), 'https://example.test/jobs')
        self.assertEqual((row['remote'],row['location']), (0,'Seattle, WA'))
        row = webscrape._map_job(dict(base, isRemote=False, workplaceType='remote'), 'https://example.test/jobs')
        self.assertEqual((row['remote'],row['location']), (0,'Seattle, WA'))
        rows = webscrape._extract_dom('<div><a href="/jobs/1">Remote Sensing Engineer</a><span class="location">Seattle, WA</span></div>', 'https://example.test')
        self.assertEqual(rows[0]['remote'], 0)

    def test_legacy_false_positives_never_bypass_radius_but_local_work_survives(self):
        conn = sqlite3.connect(':memory:')
        self.addCleanup(conn.close)
        conn.execute('CREATE TABLE p(id INTEGER, title TEXT, location TEXT, remote INTEGER, city TEXT, lat REAL, lon REAL)')
        for i, case in enumerate(CASES):
            conn.execute('INSERT INTO p VALUES(?,?,?,?,?,?,?)', (i,case['title'],case['location'],case['remote'],'seattle',47.6062,-122.3321))
        scope = dict(version=1, near='Destin, FL',lat=30.4044,lon=-86.4714,radiusMiles=70,includeRemote=True)
        predicate = search_scope.predicate(scope)
        distant = [r[0] for r in conn.execute('SELECT id FROM p WHERE '+predicate+' ORDER BY id')]
        self.assertEqual(distant, [i for i,c in enumerate(CASES) if c['expected']])
        before = conn.execute('SELECT title, location, remote FROM p ORDER BY id').fetchall()
        conn.execute("UPDATE p SET city='destin',lat=30.4044,lon=-86.4714")
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM p WHERE '+predicate).fetchone()[0], len(CASES))
        scope['includeRemote'] = False
        local = [r[0] for r in conn.execute('SELECT id FROM p WHERE '+search_scope.predicate(scope)+' ORDER BY id')]
        self.assertEqual(local, [i for i,c in enumerate(CASES) if not c['expected']])
        self.assertEqual(before, conn.execute('SELECT title, location, remote FROM p ORDER BY id').fetchall(), 'read guard must not rewrite corpus evidence')


if __name__ == '__main__':
    unittest.main(verbosity=2)
