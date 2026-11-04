# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise employer pay tokenization, source adapters, JSON-LD units and real temporary SQLite correction without network or applicant data.
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_MULTIUSER'] = '1'
from jobhunter import ats, config, db, detail, public_education_ats, source_memory
from jobhunter.salary_text import parse_salary

HINGE = '$157.4K – $217.8K • Offers Equity'
CANADIAN = 'CA$197.6K – CA$264K • Offers Equity'


def ashby_rows():
    jobs = [dict(id='hinge-us', title='Sr. Software Engineer', location='San Francisco-HQ',
                 compensation={'compensationTierSummary': HINGE}),
            dict(id='hinge-ca', title='Staff Software Engineer', location='Montreal-HQ',
                 compensation={'compensationTierSummary': CANADIAN})]
    with patch.object(ats.http, 'get_json', return_value={'jobs': jobs}):
        return ats.Ashby.fetch('synthetic-fixture')


class SalaryParsing(unittest.TestCase):
    def test_atomic_decimal_k_and_grouped_tokens(self):
        for text, expected in [
            (HINGE,(157400,217800)), ('$157,400 – $217,800 annually',(157400,217800)),
            ('$157,400.25 – $217,800.75 per year',(157400.25,217800.75)),
            ('$192K – $264K • Offers Equity',(192000,264000)),
            ('$4,000 – $8,000 annually',(4000,8000)),
            ('$150K – $200K per year • 401(k) match',(150000,200000)),
        ]:
            with self.subTest(text=text):
                value = parse_salary(text)
                self.assertEqual((value['min'],value['max']),expected)
                self.assertEqual(value['raw'],text)

    def test_explicit_currency_prefixes_and_unknown_currency(self):
        for prefix, currency in [('CA$','CAD'),('C$','CAD'),('CAD ','CAD'),('US$','USD'),('USD ','USD'),
                                 ('AU$','AUD'),('NZ$','NZD'),('HK$','HKD'),('SG$','SGD'),('£','GBP'),('€','EUR'),('₹','INR')]:
            with self.subTest(prefix=prefix):
                value = parse_salary(f'{prefix}40 – {prefix}60 per hour')
                self.assertEqual((value['min'],value['max'],value['currency'],value['period']),(40,60,currency,'hour'))
        self.assertIsNone(parse_salary('40 – 60 hourly')['currency'])

    def test_supported_units_preserve_low_amounts_and_unsupported_units_stay_unknown(self):
        for text, expected in [('$40 – $60 hourly',(40,60,'hour')), ('$0.50 – $1.25 per hour',(.5,1.25,'hour')),
                               ('Full-time - $21.50 - $30.00 Hourly',(21.5,30,'hour')),
                               ('$40/hr – $60/hr',(40,60,'hour')),
                               ('$4,000 – $8,000 per course',(4000,8000,'course')),
                               ('$500 – $900 annually',(500,900,'year')), ('$4,000 – $8,000 per month',(4000,8000,'month')),
                               ('$40 – $60 weekly',(40,60,None)), ('$40 – $60 per semester',(40,60,None)),
                               ('$40 – $60 per credit hour',(40,60,None)),
                               ('$40 – $60; five years experience',(40,60,None)),
                               ('$40 – $60',(40,60,None))]:
            with self.subTest(text=text):
                value = parse_salary(text)
                self.assertEqual((value['min'],value['max'],value['period']),expected)

    def test_provider_defaults_are_explicit_and_cannot_override_unsupported_units(self):
        value = parse_salary('40 – 60',default_currency='CAD',default_period='year')
        self.assertEqual((value['currency'],value['period'],value['period_basis']),('CAD','year','provider-default'))
        value = parse_salary('$40 – $60 weekly',default_period='year')
        self.assertEqual((value['period'],value['period_basis']),(None,'unknown'))
        self.assertIsNone(parse_salary(HINGE)['period'])

    def test_ambiguous_ranges_retain_raw_evidence_without_combining_bonus_or_currencies(self):
        for text in ('Base salary $150K – $200K + $5K – $10K bonus', 'USD 40 – CAD 60 hourly', '$40 – $20 hourly', '$157.4 – $217.8K', '$40/hr – $6,000/year'):
            with self.subTest(text=text):
                value = parse_salary(text)
                self.assertEqual((value['min'],value['max']),(None,None))
                self.assertEqual(value['raw'],text)
        for text in ('$1,23 annually', '$157.4.2K annually', 'Benefits include a $2,000 annual wellness allowance', 'Annual bonus $2,000', 'Equity $5,000'):
            with self.subTest(text=text):
                self.assertIsNone(parse_salary(text))

    def test_exact_hinge_quotes_through_real_ashby_adapter(self):
        us, ca = ashby_rows()
        self.assertEqual((us['salary_min'],us['salary_max'],us['salary_currency'],us['salary_period'],us['salary_raw']),
                         (157400,217800,'USD',None,HINGE))
        self.assertEqual((ca['salary_min'],ca['salary_max'],ca['salary_currency'],ca['salary_period'],ca['salary_raw']),
                         (197600,264000,'CAD',None,CANADIAN))
        self.assertNotIn('period_basis',us,'the public posting shape remains compatible')

    def test_lever_workday_and_public_education_units(self):
        with patch.object(ats.http,'get_json',return_value=[{'id':'fixture','text':'Technician','salaryDescription':'£40 – £60 hourly'}]):
            row = ats.Lever.fetch('fixture')[0]
        self.assertEqual((row['salary_min'],row['salary_max'],row['salary_currency'],row['salary_period']),(40,60,'GBP','hour'))
        with patch.object(ats.http,'get_json',return_value={'jobPostingInfo':{'basePayRangeDisplay':'USD 4,000 – USD 8,000 per course'}}):
            row = ats.Workday.detail('fixture:wd5:careers','/job/fixture')
        self.assertEqual((row['salary_min'],row['salary_max'],row['salary_period']),(4000,8000,'course'))
        value = public_education_ats._salary('$500 – $900 per course')
        self.assertEqual((value['salary_min'],value['salary_max'],value['salary_period']),(500,900,'course'))

    def test_jsonld_retains_explicit_units_and_leaves_missing_or_unsupported_fields_unknown(self):
        for currency, unit, expected_currency, expected_unit in [
            ('CAD','YEAR','CAD','year'), ('USD','HOUR','USD','hour'), ('GBP','COURSE','GBP','course'),
            ('EUR','WEEK','EUR',None), (None,None,None,None), ('unsupported','unsupported',None,None),
        ]:
            with self.subTest(currency=currency,unit=unit):
                salary = {'value':{'minValue':'40','maxValue':'60'}}
                if currency is not None: salary['currency'] = currency
                if unit is not None: salary['value']['unitText'] = unit
                obj = {'@type':'JobPosting','description':'Fixture description','baseSalary':salary}
                row = detail._from_jsonld('<script type="application/ld+json">'+json.dumps(obj)+'</script>')
                self.assertEqual((row['salary_min'],row['salary_max'],row['salary_currency'],row['salary_period']),
                                 (40,60,expected_currency,expected_unit))
                self.assertEqual(json.loads(row['salary_raw']),salary)


class SalaryIngestion(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='career-salary-fixture-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        settings = patch.multiple(config, DATA_DIR=root, CORPUS_DB=root/'corpus.db', USER_DB=root/'owner.db',
                                  CAREER_DB=root/'career.db', MULTIUSER=True, POSTGRES=False)
        settings.start(); self.addCleanup(settings.stop)
        db._multiuser_inited.clear()
        with db.connect() as conn:
            conn.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture Employer'),(2,'Other Employer')")

    def ingest(self,rows):
        with db.connect() as conn:
            return source_memory.ingest(conn,1,source_memory.Feed(rows,complete=True))

    def test_real_sqlite_correction_changes_once_and_preserves_private_workflow(self):
        rows = ashby_rows()
        old = [dict(row,salary_min=4000,salary_max=8000,salary_currency='USD',salary_period='year') for row in rows]
        self.assertEqual(self.ingest(old)['new'],2)
        with db.connect() as conn:
            first = conn.execute('SELECT id FROM corpus.postings_corpus WHERE ats_job_id=?',('hinge-us',)).fetchone()['id']
            conn.execute("INSERT INTO user_signals(posting_id,status,ai_fit_score) VALUES(?,'applied',82)",(first,))
            db.upsert_posting(conn,2,dict(rows[0],ats_job_id='other',salary_min=50,salary_max=60,salary_period='hour'))
        changed = self.ingest(rows)
        self.assertEqual((changed['new'],changed['changed'],changed['closed']),(0,2,0))
        with db.connect() as conn:
            found = conn.execute('SELECT ats_job_id,salary_min,salary_max,salary_currency,salary_period,salary_source,salary_raw FROM corpus.postings_corpus WHERE company_id=1 ORDER BY ats_job_id').fetchall()
            self.assertEqual([tuple(row) for row in found],[('hinge-ca',197600,264000,'CAD',None,'listed',CANADIAN),('hinge-us',157400,217800,'USD',None,'listed',HINGE)])
            self.assertEqual(tuple(conn.execute('SELECT status,ai_fit_score FROM user_signals WHERE posting_id=?',(first,)).fetchone()),('applied',82))
            self.assertEqual(tuple(conn.execute('SELECT salary_min,salary_max,salary_period FROM corpus.postings_corpus WHERE company_id=2').fetchone()),(50,60,'hour'))
            conn.execute("CREATE TRIGGER corpus.no_salary_rewrite BEFORE UPDATE OF salary_min,salary_max,salary_currency,salary_period,salary_raw ON postings_corpus BEGIN SELECT RAISE(ABORT,'unchanged salary rewritten'); END")
        unchanged = self.ingest(rows)
        self.assertEqual((unchanged['changed'],unchanged['unchanged']),(0,2))

    def test_real_sqlite_preserves_low_units_and_null_currency_or_period(self):
        rows = []
        for i, text in enumerate(('$40 – $60 hourly','$500 – $900 per course','$500 – $900 annually','$40 – $60 weekly','40 – 60 hourly')):
            value = parse_salary(text)
            rows.append(dict(ats_job_id=str(i),title='Fixture role',salary_min=value['min'],salary_max=value['max'],
                             salary_currency=value['currency'],salary_period=value['period'],salary_raw=value['raw']))
        self.assertEqual(self.ingest(rows)['new'],5)
        with db.connect() as conn:
            found = [tuple(row) for row in conn.execute('SELECT salary_min,salary_max,salary_currency,salary_period FROM corpus.postings_corpus ORDER BY ats_job_id')]
        self.assertEqual(found,[(40,60,'USD','hour'),(500,900,'USD','course'),(500,900,'USD','year'),(40,60,'USD',None),(40,60,None,'hour')])

    def test_omitted_unit_and_currency_survive_a_quote_with_changed_amounts(self):
        old = dict(ats_job_id='omitted-unit',title='Fixture role',salary_min=40,salary_max=60,
                   salary_currency='USD',salary_period='hour',salary_raw='$40 – $60 hourly')
        self.ingest([old])
        # Source supplies new amounts but no unit/currency keys. Retain independent
        # detail evidence rather than treating field omission as an explicit null.
        updated = dict(ats_job_id='omitted-unit',title='Updated fixture role',salary_min=45,salary_max=65,salary_raw='$45 – $65')
        self.assertEqual(self.ingest([updated])['changed'],1)
        with db.connect() as conn:
            self.assertEqual(tuple(conn.execute('SELECT salary_min,salary_max,salary_currency,salary_period FROM corpus.postings_corpus').fetchone()),(45,65,'USD','hour'))

    def test_hashless_legacy_quote_can_clear_an_invented_unit_without_erasing_omitted_enrichment(self):
        row = dict(ats_job_id='legacy',title='Fixture role',salary_min=40,salary_max=60,salary_currency='USD',salary_period=None,salary_raw='$40 – $60')
        unknown_currency = dict(row,ats_job_id='legacy-currency',salary_currency=None,salary_period='hour',salary_raw='40 – 60 hourly')
        obj = {'@type':'JobPosting','description':'Fixture description','baseSalary':{'value':{'minValue':'40','maxValue':'60'}}}
        jsonld = detail._from_jsonld('<script type="application/ld+json">'+json.dumps(obj)+'</script>')
        jsonld.update(ats_job_id='legacy-jsonld',title='Fixture role')
        with db.connect() as conn:
            db.upsert_posting(conn,1,dict(row,salary_period='year'))
            db.upsert_posting(conn,1,dict(unknown_currency,salary_currency='USD'))
            db.upsert_posting(conn,1,dict(jsonld,salary_currency='USD',salary_period='year'))
        changed = self.ingest([row,unknown_currency,jsonld])
        self.assertEqual(changed['changed'],3)
        with db.connect() as conn:
            self.assertIsNone(conn.execute("SELECT salary_period FROM corpus.postings_corpus WHERE ats_job_id='legacy'").fetchone()[0])
            self.assertIsNone(conn.execute("SELECT salary_currency FROM corpus.postings_corpus WHERE ats_job_id='legacy-currency'").fetchone()[0])
            self.assertEqual(tuple(conn.execute("SELECT salary_currency,salary_period FROM corpus.postings_corpus WHERE ats_job_id='legacy-jsonld'").fetchone()),(None,None))
        omitted = {'ats_job_id':'legacy','title':'Fixture role'}
        self.ingest([omitted])
        benefits = dict(omitted,salary_min=None,salary_max=None,salary_currency=None,salary_period=None,
                        salary_raw='Benefits include a $2,000 annual wellness allowance')
        self.ingest([benefits])
        with db.connect() as conn:
            self.assertEqual(tuple(conn.execute("SELECT salary_min,salary_max,salary_currency,salary_raw FROM corpus.postings_corpus WHERE ats_job_id='legacy'").fetchone()),(40,60,'USD','$40 – $60'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
