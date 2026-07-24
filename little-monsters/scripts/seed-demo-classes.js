/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-12 03:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Demo-class seeder: publishes 3 demo classes (Algebra I / General Science / U.S. History) in the default "public" tenant, owned by a fictional demo teacher, each with a real public-domain textbook — file stored as approved class-shared material AND ingested into the tutor's lm-class-<uuid>-textbook RAG collection. Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; Chroma collections are dropped and re-ingested on every run.
 */

/*
 * Seed the Little Monsters DEMO experience (mirrors core scripts/sap-corpus-seed).
 *
 * What it creates:
 *   - lm_students: "Ms. Rivera (Demo)" (role teacher, external_id NULL, .invalid email
 *     so no real sign-in can ever claim the row)
 *   - lm_classes: 3 published classes in the default tenant → visible in every new
 *     user's Class Bank ("the teacher already set up the class")
 *   - lm_materials: the textbook per class, shared + approved ("the teacher already
 *     uploaded the book"), file placed in the workspace volume so Open/Download works
 *   - ChromaDB: book text ingested into lm-class-<uuid>-textbook — the collection the
 *     tutor grounds on FIRST and the only one the flashcard/quiz generators read.
 *     (Not double-ingested into lm-cls-<8>-shared: same text twice would duplicate
 *     tutor citations; the shared-materials LIST comes from lm_materials rows.)
 *
 * Books (all public domain / Project Gutenberg, fetched without auth):
 *   - A First Book in Algebra, Boyden (PDF — text extracted via the api container's pdf-parse)
 *   - General Science, Bertha M. Clark (plain text)
 *   - History of the United States, Charles & Mary Beard (plain text)
 *
 * Usage (host, Node >= 18, docker stack up):
 *   node scripts/seed-demo-classes.js
 * Auth: OSHAL_CLI_TOKEN env, or the swarm-cli PAT in ~/.oshal/config.json.
 * API:  OSHAL_API (default http://localhost:35457); Chroma: OSHAL_CHROMA (default http://localhost:58001).
 * Idempotent: safe to re-run; re-running refreshes the RAG collections in place.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = process.env.OSHAL_API || 'http://localhost:35457';
const CHROMA = process.env.OSHAL_CHROMA || 'http://localhost:58001';
const API_CONTAINER = process.env.OSHAL_API_CONTAINER || 'oshal-local-api';
const DB_CONTAINER = process.env.OSHAL_DB_CONTAINER || 'oshal-local-db';
const DEFAULT_TENANT = '00000000-0000-4000-8000-00000000d001';
const TEACHER_ID = 'a1000000-0000-4000-8000-000000000001';
const CACHE_DIR = path.join(__dirname, '.demo-books');
const MAX_INGEST_BYTES = 400 * 1024; // keep BM25 full-collection fetches snappy
const PART_BYTES = 70 * 1024;        // stay under the api's ~100KB JSON body limit

const CLASSES = [
  {
    classId: 'd1000000-0000-4000-8000-000000000001',
    materialId: 'dd100000-0000-4000-8000-000000000001',
    name: 'Algebra I (Demo)',
    subject: 'Mathematics',
    grade: '8th–9th Grade',
    description: 'Equations, factors, and word problems with a tutor grounded in a real algebra textbook. Demo class — join and try it!',
    book: {
      title: 'A First Book in Algebra (Boyden, 1895)',
      url: 'https://www.gutenberg.org/files/13309/13309-pdf.pdf',
      file: 'demo-algebra-boyden.pdf',
      mime: 'application/pdf',
      kind: 'pdf',
    },
  },
  {
    classId: 'd2000000-0000-4000-8000-000000000002',
    materialId: 'dd200000-0000-4000-8000-000000000002',
    name: 'General Science (Demo)',
    subject: 'Science',
    grade: '7th–9th Grade',
    description: 'Everyday physics, chemistry, and biology with a tutor grounded in a classic science primer. Demo class — join and try it!',
    book: {
      title: 'General Science (Bertha M. Clark, 1912)',
      url: 'https://www.gutenberg.org/cache/epub/16593/pg16593.txt',
      file: 'demo-science-clark.txt',
      mime: 'text/plain',
      kind: 'gutenberg-txt',
    },
  },
  {
    classId: 'd3000000-0000-4000-8000-000000000003',
    materialId: 'dd300000-0000-4000-8000-000000000003',
    name: 'U.S. History (Demo)',
    subject: 'History',
    grade: '9th–11th Grade',
    description: 'From the colonies to the modern era with a tutor grounded in Beard’s classic history text. Demo class — join and try it!',
    book: {
      title: 'History of the United States (Charles & Mary Beard, 1921)',
      url: 'https://www.gutenberg.org/cache/epub/16960/pg16960.txt',
      file: 'demo-history-beard.txt',
      mime: 'text/plain',
      kind: 'gutenberg-txt',
    },
  },
];

/** Run a docker CLI command, returning stdout; throws with stderr on failure. */
function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Run SQL inside the postgres container (ON_ERROR_STOP so failures throw). */
function psql(sql) {
  return docker(['exec', '-i', DB_CONTAINER, 'psql', '-U', 'oshal', '-d', 'oshal', '-v', 'ON_ERROR_STOP=1'], { input: sql });
}

/** Resolve a PAT: env first, then the swarm-cli saved context. */
function resolveToken() {
  if (process.env.OSHAL_CLI_TOKEN) return process.env.OSHAL_CLI_TOKEN.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.oshal', 'config.json'), 'utf8'));
    const ctx = cfg.contexts && cfg.contexts[cfg.currentContext || 'default'];
    if (ctx && ctx.token) return ctx.token;
  } catch { /* fall through */ }
  throw new Error('No PAT found. Set OSHAL_CLI_TOKEN or run: node scripts/swarm-cli.js login (core repo)');
}

/** Download a book to the local cache (skips when already fetched). */
async function fetchBook(book) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const dest = path.join(CACHE_DIR, book.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) return dest;
  process.stdout.write(`  fetching ${book.url} ... `);
  const res = await fetch(book.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${book.url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`${fs.statSync(dest).size.toLocaleString()} bytes`);
  return dest;
}

/** Strip Project Gutenberg boilerplate (everything outside the START/END markers). */
function stripGutenberg(text) {
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (start >= 0 && end > start) text = text.slice(text.indexOf('\n', start) + 1, end);
  return text.trim();
}

/** Extract text from a PDF using pdf-parse inside the api container (where it's installed). */
function extractPdfText(hostPdfPath, slug) {
  const inC = `/tmp/lm-demo-${slug}.pdf`;
  const outC = `/tmp/lm-demo-${slug}.txt`;
  docker(['cp', hostPdfPath, `${API_CONTAINER}:${inC}`]);
  docker(['exec', '-w', '/app', API_CONTAINER, 'node', '-e',
    `require('pdf-parse')(require('fs').readFileSync('${inC}')).then(d=>require('fs').writeFileSync('${outC}',d.text)).catch(e=>{console.error(e.message);process.exit(1)})`]);
  return docker(['exec', API_CONTAINER, 'cat', outC]);
}

/** Split text into <= PART_BYTES chunks on paragraph boundaries, capped at MAX_INGEST_BYTES total. */
function splitForIngest(text) {
  const capped = text.slice(0, MAX_INGEST_BYTES);
  const paras = capped.split(/\n\s*\n/);
  const parts = [];
  let cur = '';
  for (const p of paras) {
    if (cur.length + p.length + 2 > PART_BYTES && cur) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** POST one part to the core RAG ingest route (same pipeline the app's uploads use). */
async function ragIngest(token, collection, title, content, metadata) {
  const res = await fetch(`${API}/api/rag/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ collection, format: 'md', title, content, metadata }),
  });
  if (!res.ok) throw new Error(`rag/ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Drop a collection so re-runs don't duplicate chunks. Goes through the api
 *  (engine-agnostic — works whether RAG lives in Chroma or pgvector, ADR-091);
 *  falls back to raw Chroma REST on deployments predating the route. */
async function dropCollection(token, collection) {
  try {
    const res = await fetch(`${API}/api/rag/collections/${encodeURIComponent(collection)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return;
  } catch { /* fall through to legacy path */ }
  try { await fetch(`${CHROMA}/api/v1/collections/${encodeURIComponent(collection)}`, { method: 'DELETE' }); } catch { /* absent */ }
}

async function main() {
  const token = resolveToken();

  // Preflight: api + db reachable.
  const health = await fetch(`${API}/api/health`).then((r) => r.status).catch(() => 0);
  if (health !== 200) throw new Error(`API not healthy at ${API} (status ${health})`);
  psql('SELECT 1;');

  console.log('1/4 Seeding demo teacher + classes (idempotent) ...');
  const classRows = CLASSES.map((c) => {
    const prefix = `lm-class-${c.classId.replace(/-/g, '').slice(0, 8)}`;
    return `('${c.classId}', '${c.name}', '${c.subject}', '${c.grade}', 'Ms. Rivera (Demo)', '${c.description.replace(/'/g, "''")}', '${prefix}', 'active', '{}'::jsonb, '${TEACHER_ID}', true, '${DEFAULT_TENANT}')`;
  }).join(',\n  ');
  psql(`
INSERT INTO lm_students (student_id, name, email, external_id, role, tenant_id)
VALUES ('${TEACHER_ID}', 'Ms. Rivera (Demo)', 'demo.teacher@littlemonsters.invalid', NULL, 'teacher', '${DEFAULT_TENANT}')
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO lm_classes (class_id, name, subject, grade_level, teacher_name, description,
                        chroma_collection_prefix, status, metadata, teacher_student_id, published, tenant_id)
VALUES
  ${classRows}
ON CONFLICT (class_id) DO NOTHING;

INSERT INTO lm_enrollments (student_id, class_id)
VALUES ${CLASSES.map((c) => `('${TEACHER_ID}', '${c.classId}')`).join(', ')}
ON CONFLICT DO NOTHING;
`);

  for (const c of CLASSES) {
    console.log(`2/4 ${c.name}: fetching "${c.book.title}" ...`);
    const hostFile = await fetchBook(c.book);

    // "The teacher already uploaded the book": file into the workspace volume +
    // an approved, class-shared lm_materials row (what the class UI lists/streams).
    const storedDir = `/app/workspace-shared/education/${c.classId}/materials/${TEACHER_ID}`;
    const storedPath = `${storedDir}/${c.book.file}`;
    docker(['exec', API_CONTAINER, 'mkdir', '-p', storedDir]);
    docker(['cp', hostFile, `${API_CONTAINER}:${storedPath}`]);
    psql(`
INSERT INTO lm_materials (material_id, class_id, uploaded_by, original_name, stored_path, mime_type, size_bytes, kind, title, shared, share_status)
VALUES ('${c.materialId}', '${c.classId}', '${TEACHER_ID}', '${c.book.file}', '${storedPath}', '${c.book.mime}', ${fs.statSync(hostFile).size}, 'textbook', '${c.book.title.replace(/'/g, "''")}', true, 'approved')
ON CONFLICT (material_id) DO NOTHING;
`);

    console.log(`3/4 ${c.name}: extracting + ingesting into RAG ...`);
    let text;
    if (c.book.kind === 'pdf') {
      text = extractPdfText(hostFile, c.classId.slice(0, 8));
    } else {
      text = stripGutenberg(fs.readFileSync(hostFile, 'utf8'));
    }
    const collection = `lm-class-${c.classId}-textbook`;
    await dropCollection(token, collection); // clean reseed — chunk ids are timestamped
    const parts = splitForIngest(text);
    for (let i = 0; i < parts.length; i++) {
      await ragIngest(token, collection, `${c.book.title} — part ${i + 1}/${parts.length}`, parts[i], {
        classId: c.classId,
        type: 'textbook',
        source: c.book.title,
        license: 'public-domain',
        provenance: c.book.url,
      });
      process.stdout.write(`\r    ingested ${i + 1}/${parts.length} parts`);
    }
    console.log(`\n    -> ${collection} (${parts.length} parts, ${Math.min(text.length, MAX_INGEST_BYTES).toLocaleString()} chars)`);
  }

  console.log('4/4 Verifying ...');
  const counts = psql(`SELECT (SELECT count(*) FROM lm_classes WHERE published AND tenant_id='${DEFAULT_TENANT}' AND class_id::text LIKE 'd%') AS demo_classes,
                              (SELECT count(*) FROM lm_materials WHERE material_id::text LIKE 'dd%') AS demo_materials;`);
  console.log(counts.trim());
  console.log('\nDone. New users now see the demo classes in the Class Bank and on the dashboard invite strip.');
}

main().catch((err) => { console.error(`\nSEED FAILED: ${err.message}`); process.exitCode = 1; });
