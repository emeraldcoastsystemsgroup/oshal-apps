/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Study generation reads live approved material collections and uploads never create an unrevocable class copy.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

for (const extension of ['js', 'ts']) {
  test(`${extension}: study grounding resolves current approved materials on every request`, async () => {
    const name = path.join(root, extension === 'ts' ? 'src-routes' : 'routes', `education-study-model.${extension}`);
    let code = fs.readFileSync(name, 'utf8');
    if (extension === 'ts') {
      const roots = [process.env.OSHAL_ROOT, path.resolve(root, '../scripts/toolchain'), path.resolve(root, '../../oshal')].filter(Boolean);
      const compiler = roots.map(dir => path.join(dir, 'node_modules/typescript')).find(dir => fs.existsSync(path.join(dir, 'package.json')));
      const ts = compiler ? require(compiler) : require('typescript');
      code = ts.transpileModule(code, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    }
    const searches = [], prompts = [], queries = [];
    let approved = true;
    class StudyHttpError extends Error { constructor(message, status) { super(message); this.status = status; } }
    const stubs = {
      '@/features/rag': {RagService: class { async search(_query, collection) {
        searches.push(collection);
        return collection === 'lm-material-fixture' ? [{text: 'Photosynthesis uses sunlight.'}] : [];
      }}},
      '@/features/swarm-orchestration/services/prompt-containment': {wrapUntrustedPromptContent: (_label, text) => text},
      './education-study-errors': {StudyHttpError},
      './education-lecture-security': {resolvePersistedLectureFile: () => {throw new Error('no lecture file');}},
      '@/features/agent-management': {BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null},
      '@/app/routes/inline-bot-execution': {executeBotOrInline: async (_ctx, _client, _id, request) => {
        prompts.push(request.text);
        return {response: '[{"front":"Energy source?","back":"Sunlight"}]'};
      }},
      fs,
    };
    const module = {exports: {}};
    vm.runInNewContext(code, {exports: module.exports, module, require: name => {
      assert.ok(Object.hasOwn(stubs, name), `unexpected module: ${name}`);
      return stubs[name];
    }}, {filename: name});
    const ctx = {pool: {query: async (sql, values) => {
      if (/FROM lm_lectures/.test(sql)) return {rows: []};
      queries.push({sql, values: Array.from(values)});
      assert.match(sql, /WHERE class_id = \$1 AND shared = true AND share_status = 'approved'/);
      assert.match(sql, /rag_collection IS NOT NULL/);
      assert.match(sql, /LIMIT 50/);
      assert.deepEqual(Array.from(values), ['authorized-class']);
      return {rows: approved ? [{rag_collection: 'lm-material-fixture'}] : []};
    }}};
    const context = {classId: 'authorized-class', className: 'Biology', subject: 'biology'};
    await module.exports.generateStudyCards(ctx, 'caller', 'student', context, 3);
    assert.ok(searches.includes('lm-material-fixture'));
    assert.match(prompts[0], /Photosynthesis uses sunlight/);
    approved = false;
    searches.length = 0;
    await assert.rejects(module.exports.generateStudyCards(ctx, 'caller', 'student', context, 3), error => error.status === 409);
    assert.equal(queries.length, 2);
    assert.ok(!searches.includes('lm-material-fixture'), 'revoked/deleted material is no longer searched');
    assert.equal(prompts.length, 1, 'no generation from withdrawn material');
  });
  test(`${extension}: upload keeps only its revocable material collection`, () => {
    const source = fs.readFileSync(path.join(root, extension === 'ts' ? 'src-routes' : 'routes', `education-materials-routes.${extension}`), 'utf8');
    const upload = source.slice(source.indexOf('async function uploadMaterial('), source.indexOf('async function importArtifactMaterial('));
    assert.match(upload, /groundUploadedMaterial\(ctx, caller, row.material_id, text\)/);
    assert.match(upload, /resolveStagedTextbookUpload/);
    assert.doesNotMatch(upload, /lm-class-|ingestMaterialText/);
  });
}
