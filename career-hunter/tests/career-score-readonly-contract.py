"""Real SQLite regression for private scoring against a published read-only corpus."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import config, db, score  # noqa: E402


def main():
    checks = 0
    with tempfile.TemporaryDirectory(prefix="career-score-corpus-") as tmp:
        root = Path(tmp)
        config.CORPUS_DB = root / "corpus.db"
        config.USER_DB = root / "user.db"
        with db.connect() as con:
            con.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture Co')")
            for posting_id in (1, 2, 3):
                con.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,active,target_role)"
                            " VALUES(?,1,?,'Program Manager',1,1)", (posting_id, str(posting_id)))
        config.CORPUS_DB.chmod(0o440)
        assert not db.corpus_writable()
        for posting_id, fetched in [(1, {"description": "Fetched fixture description"}), (2, None)]:
            assert score._commit_one({
                "id": posting_id, "fetched": fetched,
                "data": {"fit_score": 82, "rationale": "Fixture match",
                         "salary_estimate": {"min": 120000, "max": 150000}},
            }, "fixture")
            with db.connect() as con:
                row = con.execute("SELECT ai_fit_score FROM user_signals WHERE posting_id=?", (posting_id,)).fetchone()
                assert row[0] == 82, "private fit must commit despite a read-only shared corpus"
                row = con.execute("SELECT description,salary_min FROM corpus.postings_corpus WHERE id=?", (posting_id,)).fetchone()
                assert row[0] is None and row[1] is None, "published objective data stays unchanged"
            checks += 1

        config.CORPUS_DB.chmod(0o660)
        for malformed in ['unknown',[],{'min':'unknown','max':170000},{'min':200000,'max':100000},{'min':True,'max':170000}]:
            assert score._commit_one({'id':2,'data':{'fit_score':84,'salary_estimate':malformed}},'fixture')
            with db.connect() as con:
                assert con.execute('SELECT ai_fit_score FROM user_signals WHERE posting_id=2').fetchone()[0]==84
                assert con.execute('SELECT salary_min FROM corpus.postings_corpus WHERE id=2').fetchone()[0] is None
        checks += 1
        assert db.corpus_writable()
        assert score._commit_one({
            "id": 3, "fetched": {"description": "Writable fixture description"},
            "data": {"fit_score": 91, "salary_estimate": {"min": 140000, "max": 170000}},
        }, "fixture")
        with db.connect() as con:
            row = con.execute("SELECT description,salary_min,salary_max FROM corpus.postings_corpus WHERE id=3").fetchone()
            assert tuple(row) == ("Writable fixture description", 140000, 170000)
            assert con.execute("SELECT ai_fit_score FROM user_signals WHERE posting_id=3").fetchone()[0] == 91
        checks += 1
    print(json.dumps({"checks": checks, "failed": []}))


if __name__ == "__main__":
    main()
