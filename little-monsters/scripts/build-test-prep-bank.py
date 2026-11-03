"""Print a versioned bank seed migration. Save a new migration when curriculum changes.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Shared question seed excludes grading fields.
"""
import json
from pathlib import Path
catalog = json.loads((Path(__file__).resolve().parents[1] / 'data/test-prep/catalog.json').read_text())
def sql(value):
    return "'" + str(value).replace("'", "''") + "'"
print('-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Seed shared original questions; grading keys remain server-only.')
for q in catalog['questions']:
    public = {key: value for key, value in q.items() if key not in ('answer', 'explanation')}
    print('INSERT INTO lm_prep_questions (catalog_version, question_id, skill, question) VALUES (' +
          ','.join(sql(x) for x in [catalog['version'], q['id'], q['skill'], json.dumps(public, ensure_ascii=False, separators=(',', ':'))]) +
          '::jsonb) ON CONFLICT (catalog_version, question_id) DO NOTHING;')
