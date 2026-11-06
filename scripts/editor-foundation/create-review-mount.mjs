/** Current Create model over a separate atomic review copy; no shared writers or production data. */
import { createRequire } from 'node:module';
const { Router, json } = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN, 'package.json'))('express');
import { resolve } from 'node:path';
export function createReviewMount(store, root) {
    const router = Router(), parse = json({ limit: '600kb', strict: true });
    const run = fn => async (req, res) => { try {
        await fn(req, res);
    }
    catch (error) {
        res.status(error.status ?? 400).json({ error: error.message });
    } };
    router.get('/editor', (_req, res) => res.sendFile(resolve(root, 'create/tools/create-editor.html')));
    router.get('/theme/create.css', (_req, res) => res.sendFile(resolve(root, 'create/ui/create.css')));
    router.get('/permissions', (_req, res) => res.json({ permissions: { view: true, read: true, create: true, change: true, delete: true, export: true, generate: false } }));
    router.get('/brand-kit', (_req, res) => res.json({ kit: null }));
    router.get('/projects', (_req, res) => res.json({ projects: store.list() }));
    router.post('/projects', parse, run((req, res) => res.status(201).json({ project: store.create(req.body.document, req.body.title) })));
    router.get('/projects/:id', run((req, res) => res.json({ project: store.read(req.params.id) })));
    router.get('/projects/:id/revisions', run((req, res) => { store.read(req.params.id); res.json({ revisions: store.state.projects[req.params.id].history.map(row => store.metadata(row)).reverse() }); }));
    router.get('/projects/:id/revisions/:revision', run((req, res) => res.json({ project: store.read(req.params.id, req.params.revision) })));
    router.post('/projects/:id/revisions', parse, run((req, res) => res.status(201).json({ project: store.save(req.params.id, req.body) })));
    router.delete('/projects/:id', parse, run((req, res) => { store.remove(req.params.id, req.body.baseRevision); res.status(204).end(); }));
    router.get('/projects/:id/export', run((req, res) => res.json({ document: store.read(req.params.id).document })));
    router.use((req, res) => res.status(503).json({ error: 'This isolated Image review supports editable shape, text and vector source. Raster/PSD uploads and generation are unavailable.' }));
    return router;
}
