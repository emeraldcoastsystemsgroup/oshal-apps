/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose real editor fixtures behind one isolated loopback review host, retaining the old Publishing service and a separate CreateV4 copy.
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { readFile, mkdir, copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { request as upstreamRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Module, { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../../', import.meta.url)), execute = promisify(execFile);
function local(req) { const host = String(req.headers.host || ''); return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && (!req.headers.origin || req.headers.origin === 'http://' + host) && req.headers['sec-fetch-site'] !== 'cross-site'; }
export async function jsonCall(origin, path, { method = 'GET', body } = {}) { const response = await fetch(origin + path, { method, headers: body instanceof FormData ? {} : body === undefined ? {} : { 'content-type': 'application/json' }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let value; try {
    value = JSON.parse(text);
}
catch {
    value = { error: text.slice(0, 200) };
} if (!response.ok)
    throw Error(method + ' ' + path + ' refused: ' + (value.error || response.status)); return value; }
function proxy(origin) { const target = new URL(origin); if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
    throw Error('Review upstream must be loopback HTTP.'); return (req, res) => { const headers = {}; for (const name of ['content-type', 'content-length', 'range', 'if-none-match', 'if-modified-since'])
    if (req.headers[name])
        headers[name] = req.headers[name]; const upstream = upstreamRequest({ hostname: target.hostname, port: target.port, path: req.originalUrl, method: req.method, headers }, answer => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); }); upstream.on('error', () => { if (!res.headersSent)
    res.status(502).json({ error: 'review_upstream_unavailable' });
else
    res.destroy(); }); req.on('aborted', () => upstream.destroy()); req.pipe(upstream); }; }
export function landing(entries, key) { return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create editor suite review</title><link rel="stylesheet" href="/shared/ui/css/surface-themes.css"><script src="/shared/ui/js/surface-theme.js"></script><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;color:var(--text-primary);background:var(--bg-primary);font:14px system-ui}header{padding:10px 14px;display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;border-bottom:1px solid var(--border-color)}h1{font-size:16px;margin:0}label{display:flex;gap:8px;align-items:center}select,button{min-height:44px;font:inherit;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);padding:8px}p{margin:0;flex-basis:100%;color:var(--text-secondary);font-size:12px}iframe{width:100%;flex:1;min-height:0;border:0}#unavailable{padding:24px;flex:1}#unavailable[hidden]{display:none}@media(max-width:600px){header{padding:6px 10px}label{flex:1}select{width:100%;min-width:0}h1{font-size:14px}}</style></head><body><header><h1>Create suite · separate review</h1><label>Editor <select id="editor" aria-label="Review editor"></select></label><button id="theme" type="button">Switch theme</button><p id="notice"></p></header><iframe id="review-editor" title="Editor review"></iframe><section id="unavailable" hidden></section><script type="module">const entries=${JSON.stringify(entries)},select=document.querySelector('#editor'),frame=document.querySelector('iframe'),notice=document.querySelector('#notice'),unavailable=document.querySelector('#unavailable');for(const entry of entries)select.add(new Option(entry.title,entry.key));function show(key){const entry=entries.find(v=>v.key===key)||entries[0];select.value=entry.key;notice.textContent=entry.notice+' AI provider unavailable.';frame.title=entry.title;frame.hidden=!entry.url;unavailable.hidden=!!entry.url;if(entry.url){frame.src=entry.url;}else{frame.removeAttribute('src');unavailable.textContent=entry.notice;}history.replaceState(null,'','?editor='+entry.key);}select.onchange=()=>show(select.value);document.querySelector('#theme').onclick=()=>{localStorage.setItem('cockpit-theme',localStorage.getItem('cockpit-theme')==='midnight'?'light-blue':'midnight');location.reload();};frame.onload=async()=>{const entry=entries.find(v=>v.key===select.value);if(!entry?.selectionLabel&&!entry?.selectionSelector)return;let label=entry.selectionLabel;if(entry.recordId&&entry.selectionLabel){try{const data=await fetch('/api/'+entry.key+'/source-projects/'+entry.recordId).then(r=>r.json());label=data.project.title+' · revision '+data.project.revision;}catch{}}if(select.value!==entry.key)return;const open=()=>{const button=entry.selectionSelector?frame.contentDocument.querySelector(entry.selectionSelector):[...frame.contentDocument.querySelectorAll('button')].find(node=>node.textContent===label);if(button){button.click();return true;}return false;};if(!open()){const observer=new MutationObserver(()=>{if(open())observer.disconnect();});observer.observe(frame.contentDocument.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),15000);}};show(${JSON.stringify(key)});</script></body></html>`; }
export async function startFullReview(options = {}) {
    const toolchain = process.env.STORE_CI_TOOLCHAIN, core = process.env.OSHAL_CORE_ROOT, platform = process.env.OSHAL_PLATFORM_ROOT;
    if (!toolchain || !core || !platform)
        throw Error('Explicit Store toolchain, core dependency and kernel platform roots are required.');
    process.env.NODE_PATH = [resolve(toolchain, 'node_modules'), resolve(process.env.OSHAL_EDITOR_SHARP_ROOT || core, 'node_modules'), resolve(core, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':');
    Module._initPaths();
    const require = createRequire(resolve(toolchain, 'package.json')), express = require('express'), cleanups = [], entries = [], upstreams = [];
    let server, closed = false;
    const close = async () => { if (closed)
        return; closed = true; server?.closeAllConnections(); if (server)
        await new Promise(done => server.close(done)); const errors = []; for (const cleanup of cleanups.reverse())
        try {
            await cleanup();
        }
        catch (error) {
            errors.push(error);
        } if (errors.length)
        throw new AggregateError(errors, 'Full review cleanup failed.'); };
    const add = (entry, origin) => { entries.push(entry); if (origin)
        upstreams.push({ prefix: entry.prefix, origin }); };
    const progress = name => options.onProgress?.(name);
    try {
        const oldOrigin = options.publishingOrigin ?? 'http://127.0.0.1:38820', oldStatus = await jsonCall(oldOrigin, '/review/status');
        if (!oldStatus.review || !oldStatus.publishingId)
            throw Error('The preserved Publishing review service is required.');
        const stateDir = options.stateDir ?? join(homedir(), '.local/state/oshal-editor-foundation/full-review');
        await mkdir(stateDir, { recursive: true, mode: 0o700 });
        const stateFile = join(stateDir, 'create-projects.json'), oldState = options.sourceCreateFile ?? join(homedir(), '.local/state/oshal-editor-foundation/review/create-projects.json');
        try {
            await copyFile(oldState, stateFile, constants.COPYFILE_EXCL);
            await chmod(stateFile, 0o600);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const { ReviewStore } = await import('./review-store.mjs'), store = new ReviewStore(stateFile);
        add({ key: 'create', title: 'Image / Vector', recordId: store.list()[0].id, url: '/api/create/editor?project=' + store.list()[0].id, notice: 'Separate atomic review copy; source saves survive restart.' });
        progress('Preserving and cloning the earlier Publishing review');
        const { fixture: publishingFixture } = await import('../../publishing-studio/tests/fixtures/fixture.mjs'), publishing = await publishingFixture({ http: true });
        cleanups.push(() => publishing.close());
        const { clonePublishingReview } = await import('./publishing-review-copy.mjs'), publicationCopy = await clonePublishingReview({ oldOrigin, fresh: publishing, stateDir });
        if (!publicationCopy.receipt.documents.length)
            throw Error('The earlier Publishing review contains no saved document to clone.');
        const publication = publicationCopy.receipt.documents.find(doc => doc.originalId === oldStatus.publishingId) || publicationCopy.receipt.documents[0], publicationStore = publishing.context('alice').store, { job: publicationJob } = await publicationStore.begin(publication.clonedId, { revision: publication.clonedRevision, requestKey: randomUUID() });
        await publicationStore.produce(publicationJob.id);
        add({ key: 'publishing', title: 'Publishing', recordId: publication.clonedId, expectedTitle: publication.title, prefix: '/api/publishing-studio', url: '/api/publishing-studio/app?document=' + publication.clonedId, notice: 'Current native Typst editor with a saved-model/image clone. Earlier originals and service remain untouched.' }, publishing.url);
        progress('Starting actual source-project SQL');
        const { startSourceReviewHub } = await import('./source-review-hub.mjs'), sources = await startSourceReviewHub();
        cleanups.push(() => sources.close());
        for (const entry of sources.entries)
            add({ ...entry, prefix: '/api/' + entry.key, notice: 'Owned source and immutable revisions in disposable SQL; removed when this review closes.' }, sources.origin);
        progress('Starting actual Office SQL and OOXML');
        const { fixture: officeFixture } = await import('../../presentations/tests/office/fixture.mjs'), office = await officeFixture({ http: true });
        cleanups.push(() => office.close());
        for (const [kind, title] of [['pptx', 'PowerPoint'], ['docx', 'Word'], ['xlsx', 'Excel']]) {
            const { document } = await office.context('alice').store.create({ kind, title: 'Review ' + title, requestKey: randomUUID() });
            add({ key: kind, title, recordId: document.id, expectedTitle: document.title, prefix: '/api/presentations', url: '/api/presentations/editor/app?document=' + document.id, notice: 'Editable source and actual OOXML exports; disposable owned SQL.' }, office.origin);
        }
        progress('Starting actual PDF worker');
        const { fixture: pdfFixture } = await import('../../pdf-workbench/tests/fixtures/fixture.mjs'), pdf = await pdfFixture();
        cleanups.push(() => pdf.close());
        const form = new FormData();
        form.append('file', new Blob([await readFile(join(pdf.directory, 'first.pdf'))], { type: 'application/pdf' }), 'Original review.pdf');
        form.append('title', 'Original review PDF');
        form.append('requestKey', randomUUID());
        const uploaded = await jsonCall(pdf.url, '/api/pdf-workbench/sources/upload', { method: 'POST', body: form }), createdPdf = await jsonCall(pdf.url, '/api/pdf-workbench/documents', { method: 'POST', body: { title: 'Editable review PDF', source: uploaded.source.id, requestKey: randomUUID() } });
        add({ key: 'pdf', title: 'PDF', recordId: createdPdf.document.id, expectedTitle: 'Editable review PDF', prefix: '/api/pdf-workbench', url: '/api/pdf-workbench/app?document=' + createdPdf.document.id, notice: 'Real PDF source, object edits and native worker exports; disposable owned SQL.' }, pdf.url);
        progress('Starting actual native Motion compositor');
        const { startApplicationFixture } = await import('../../motion-studio/tests/application-fixture.mjs'), motion = await startApplicationFixture();
        cleanups.push(() => motion.close());
        const mp = await jsonCall(motion.origin, '/api/motion-studio/projects', { method: 'POST', body: { title: 'Review composition', width: 640, height: 360, frameRate: 30, duration: 5, requestKey: randomUUID() } });
        await jsonCall(motion.origin, '/api/motion-studio/projects/' + mp.project.id + '/operations', { method: 'POST', body: { baseRevision: 1, requestKey: randomUUID(), commands: [{ command: 'layer.newText', params: { text: 'Select and edit this native title', name: 'Editable title', size: 36, fill: '#172554', position: [320, 180] } }] } });
        add({ key: 'motion', title: 'Motion', recordId: mp.project.id, expectedTitle: 'Review composition', prefix: '/api/motion-studio', url: '/api/motion-studio/app?project=' + mp.project.id, notice: 'Actual native compositor, layers and rendered pixels; disposable owned SQL.' }, motion.origin);
        for (const appId of ['cad-studio', 'scene-studio']) {
            progress('Starting actual ' + appId + ' engine');
            const { startNativeEditorFixture } = await import('../../' + appId + '/tests/native-editor-fixture.mjs'), native = await startNativeEditorFixture({ appId });
            cleanups.push(() => native.close());
            if (appId === 'cad-studio') {
                const result = await jsonCall(native.origin, '/api/cad-studio/models', { method: 'POST', body: { title: 'Review editable bracket', base: { kind: 'box', sizeX: 60, sizeY: 40, sizeZ: 30 } } });
                await jsonCall(native.origin, '/api/cad-studio/models/' + result.model.model_id + '/features', { method: 'POST', body: { type: 'hole', label: 'Mounting hole', params: { axis: 'z', x: 15, y: 10, diameter: 6, depth: 30 } } });
                add({ key: 'cad', title: 'CAD', recordId: result.model.model_id, expectedTitle: 'Review editable bracket', prefix: '/api/cad-studio', url: '/api/cad-studio/app?model=' + result.model.model_id, notice: 'Actual OCCT rebuild, features and STEP/STL exports; disposable owned SQL.' }, native.origin);
            }
            else {
                const result = await jsonCall(native.origin, '/api/scene-studio/projects', { method: 'POST', body: { title: 'Review Blender scene', kind: 'blender', template: 'default' } });
                await jsonCall(native.origin, '/api/scene-studio/projects/' + result.project.projectId + '/preview', { method: 'POST', body: { width: 320, height: 240, samples: 2 } });
                add({ key: 'scene', title: 'Scene / 3D', recordId: result.project.projectId, expectedTitle: 'Review Blender scene', prefix: '/api/scene-studio', url: '/api/scene-studio/app?project=' + result.project.projectId, notice: 'Actual Blender/Godot native scene operations; disposable owned SQL.' }, native.origin);
            }
        }
        progress('Starting actual Video SQL, ffprobe and FFmpeg');
        const { startPostgres } = await import('../../video/tests/video-editor-postgres.fixture.mjs'), { startApi, loadCompiled, timeline } = await import('../../video/tests/video-editor.fixture.mjs'), database = await startPostgres(fn => cleanups.push(fn)), { probeWithFfprobe } = loadCompiled('video-editor-media.js'), video = await startApi({ after: fn => cleanups.push(fn) }, database.pool, { prober: probeWithFfprobe, exports: { fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' } });
        const videoDir = await mkdtemp(join(tmpdir(), 'full-review-video-'));
        cleanups.push(() => rm(videoDir, { recursive: true, force: true }));
        const clipFile = join(videoDir, 'source.mp4');
        await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-y', clipFile], { timeout: 30000, maxBuffer: 4000 });
        const mediaForm = new FormData();
        mediaForm.append('media', new Blob([await readFile(clipFile)], { type: 'video/mp4' }), 'Actual source.mp4');
        const media = await jsonCall(video.origin, '/api/video/editor/media?kind=video', { method: 'POST', body: mediaForm }), clip = media.media;
        const vp = await jsonCall(video.origin, '/api/video/editor/projects', { method: 'POST', body: { title: 'Review editable clip', document: timeline('Review editable clip', { clip: { kind: 'video', asset: clip.id, name: 'Actual source', frames: clip.frames, width: clip.width, height: clip.height, audio: clip.hasAudio } }, [{ id: 'segment1', source: 'clip', in: 0, out: clip.frames, volume: 100 }]) } });
        add({ key: 'video', title: 'Video', recordId: vp.project.id, expectedTitle: 'Review editable clip', prefix: '/api/video', url: '/api/video/editor?project=' + vp.project.id, notice: 'Real uploaded H.264 source, trim/sequence editor, ffprobe and FFmpeg exports; disposable owned SQL.' }, video.origin);
        progress('Starting actual LoRA source SQL without worker execution');
        const { startCaptionFixture } = await import('../../lora/tests/editor-captions.fixture.mjs'), lora = await startCaptionFixture({ workerAvailable: false });
        cleanups.push(() => lora.close());
        lora.app.get('/api/lora/ui', (_q, res) => res.sendFile(resolve(root, 'lora/tools/lora.html')));
        lora.app.get('/api/lora/characters', async (_q, res) => res.json({ characters: (await lora.ctx.pool.query('SELECT * FROM oshal_lora_characters WHERE owner_sub=$1', ['alice'])).rows }));
        lora.app.get('/api/lora/models', async (_q, res) => res.json({ models: (await lora.ctx.pool.query('SELECT * FROM oshal_lora_models WHERE character_id=$1', [lora.characterId])).rows }));
        lora.app.use('/api/lora', (_req, res) => res.status(503).json({ error: 'Training and generation are unavailable in this isolated source review.' }));
        add({ key: 'lora', title: 'LoRA source', recordId: lora.characterId, prefix: '/api/lora', url: '/api/lora/ui', selectionSelector: '[data-char-index]', notice: 'Actual identity/caption SQL; synthetic dataset entry, no registered worker; desired captions save and synchronization fails visibly without advancing applied source.' }, lora.origin);
        progress('Starting actual Vids brief SQL without a generation worker');
        const { startVidsSourceFixture } = await import('../../vids/tests/source-projects.fixture.mjs'), vids = await startVidsSourceFixture();
        cleanups.push(() => vids.close());
        const vb = await jsonCall(vids.origin, '/api/vids/source-projects', { method: 'POST', body: { requestKey: randomUUID(), model: { version: 1, kind: 'vids-brief', title: 'Review generation brief', prompt: 'A calm coastal sunrise with one slow camera move.', orientation: 'Landscape', insertMode: 'Insert' } } });
        add({ key: 'vids', title: 'Vids generation brief', recordId: vb.project.id, selectionLabel: 'Review generation brief · revision 1', prefix: '/api/vids', url: '/api/vids/app', notice: 'Actual durable generation brief and owned SQL; no generation worker is registered.' }, vids.origin);
        progress('Starting actual Scan calibration SQL and reconstruction');
        const { startCalibrationFixture, seedCalibrationFixture } = await import('../../scan-to-print/tests/calibration.fixture.mjs'), scan = await startCalibrationFixture();
        cleanups.push(() => scan.close());
        const calibration = await seedCalibrationFixture(scan, { title: 'Review calibrated scan', reconstruct: true });
        add({ key: 'scan', title: 'Scan to Print', recordId: calibration.jobId, prefix: '/api/scan-to-print', url: '/api/scan-to-print/app', selectionSelector: '#job-list button', notice: 'Actual owned calibration, ingested views and bundled reconstruction. Printer and external-process ports are unavailable.' }, scan.origin);
        process.env.NODE_PATH = [resolve(process.env.OSHAL_EDITOR_SHARP_ROOT || core, 'node_modules'), resolve(core, 'node_modules'), resolve(toolchain, 'node_modules')].join(':');
        Module._initPaths();
        const app = express();
        app.use((req, res, next) => local(req) ? next() : res.status(403).json({ error: 'review_local_origin_required' }));
        app.use((req, res, next) => /^\/api\/(swarm|jarvis)(\/|$)/.test(req.path) ? res.status(503).json({ error: 'No AI provider is connected to this separate review workspace. Your saved source is retained.' }) : next());
        app.get('/review/status', (_req, res) => res.json({ review: true, fullSuite: true, entries, ai: { available: false }, publishingPreserved: true, publishingBackupReceipt: publicationCopy.receiptPath, publishingClones: publicationCopy.receipt.documents.map(({ originalId, originalRevision, clonedId, clonedRevision }) => ({ originalId, originalRevision, clonedId, clonedRevision })), createStateFile: stateFile }));
        app.get('/', (req, res) => res.type('html').send(landing(entries, String(req.query.editor || 'create'))));
        app.get('/ui/kernel/table.js', (_req, res) => res.type('js').sendFile(resolve(platform, '../crates/api/src/kernel_table.js')));
        app.get('/ui/kernel/screen.css', (_req, res) => res.type('css').sendFile(resolve(platform, '../crates/api/src/kernel_screen.css')));
        app.get('/api/artifacts/picker.js', (_req, res) => res.type('js').sendFile(resolve(platform, 'src/pages/cockpit/js/components/artifact-picker.js')));
        app.get('/api/artifacts/picker.css', (_req, res) => res.type('css').sendFile(resolve(platform, 'src/pages/cockpit/js/components/artifact-picker.css')));
        app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
        app.use('/cockpit', express.static(resolve(platform, 'src/pages/cockpit')));
        app.get('/api/ui/profile', (_req, res) => res.json({ profile: { name: 'full-editor-review', ribbon: { items: [] } } }));
        const { createReviewMount } = await import('./create-review-mount.mjs');
        app.use('/api/create/editor', express.static(resolve(root, 'create/tools/editor')));
        app.use('/api/create', createReviewMount(store, root));
        const mounted = new Set();
        for (const upstream of upstreams)
            if (!mounted.has(upstream.prefix)) {
                mounted.add(upstream.prefix);
                app.use(upstream.prefix, proxy(upstream.origin));
            }
        app.use((_req, res) => res.status(503).json({ error: 'This external operation is unavailable in the isolated review workspace.' }));
        server = app.listen(options.port ?? 38821, '127.0.0.1');
        await new Promise((done, reject) => { server.once('listening', done); server.once('error', reject); });
        const origin = 'http://127.0.0.1:' + server.address().port;
        return { origin, entries, store, stateFile, close };
    }
    catch (error) {
        await close();
        throw error;
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const review = await startFullReview({ port: Number(process.env.EDITOR_FULL_REVIEW_PORT || 38821), onProgress: name => process.stderr.write(name + '\n') });
    process.stdout.write(JSON.stringify({ reviewUrl: review.origin, editors: review.entries.map(({ key, title, url }) => ({ key, title, available: !!url })), publishing: 'Earlier service38820 and originals are preserved; current cloned source uses a separate genuine fixture.', ai: 'Unavailable; no provider forwarded.' }) + '\n');
    for (const signal of ['SIGTERM', 'SIGINT'])
        process.once(signal, () => { void review.close().then(() => process.exit(0), error => { process.stderr.write(error.message + '\n'); process.exit(1); }); });
}
