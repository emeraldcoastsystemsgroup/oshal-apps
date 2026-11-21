/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.20: read-only helper for serving matched executive DOCX/RTF/PDF packet artifacts and zero-PII blank templates via engine/jobhunter/docx_resume.py without mutating owner packets.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: renderPacketArtifact takes kind 'parse', the job's parse résumé (Resume_Parse.docx, Word only, from docx_resume.py export-packet --kind parse), named <name>_<company>_Resume_For_Upload.docx; PARSE_FILE names the file generation writes beside the packet.
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');
const PYTHON = process.env.JOBHUNTER_PYTHON || 'python3';

const FAMILIES = new Map([
  ['standard', 'Standard'],
  ['professional', 'Professional'],
  ['leadership', 'Leadership'],
  ['technical', 'Technical'],
]);

/** The parse résumé generation writes beside a packet (engine/jobhunter/docx_parse.py FILE_NAME). */
const PARSE_FILE = 'Resume_Parse.docx';

const MIME_BY_FORMAT = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  rtf: 'text/rtf',
});

function normalizeFamily(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return FAMILIES.get(raw.trim().toLowerCase()) || null;
}

function normalizeFormat(raw, allowDotx = false) {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!val) return 'pdf';
  if (val === 'pdf' || val === 'docx' || val === 'rtf') return val;
  if (allowDotx && val === 'dotx') return 'dotx';
  return null;
}

function safeFilename(base, ext) {
  const clean = String(base || 'Document').replace(/[^A-Za-z0-9._ -]+/g, '_').trim().slice(0, 96) || 'Document';
  return `${clean}.${ext}`;
}

function siblingArtifactPath(pdfPath, format) {
  if (!/\.pdf$/i.test(pdfPath)) return null;
  return pdfPath.replace(/\.pdf$/i, `.${format}`);
}

function packetMeta(packetDir) {
  try {
    const raw = fs.readFileSync(path.join(packetDir, 'application.json'), 'utf8');
    const data = JSON.parse(raw);
    const name = data?.profile_snapshot?.profile?.name || '';
    const company = data?.company || '';
    return {
      family: normalizeFamily(data?.template_family),
      name: typeof name === 'string' ? name : '',
      company: typeof company === 'string' ? company : '',
    };
  } catch {
    return { family: null, name: '', company: '' };
  }
}

function runDocxCli(args) {
  const env = {
    ...process.env,
    PYTHONPATH: [ENGINE_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
  };
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-m', 'jobhunter.docx_resume', ...args], { env, timeout: 65000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const start = String(stdout || '').indexOf('{');
      let parsed = null;
      if (start >= 0) {
        try { parsed = JSON.parse(String(stdout).slice(start)); } catch { parsed = null; }
      }
      if (err || !parsed || parsed.ok !== true) {
        reject(new Error(parsed?.error || String(stderr || err?.message || 'document export failed').slice(-300)));
        return;
      }
      resolve(parsed);
    });
  });
}

async function renderPacketArtifact({ packetJsonPath, kind, format, family }) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'career-docx-export-'));
  try {
    const args = ['export-packet', '--packet-json', packetJsonPath, '--out-dir', tmpDir, '--kind', kind, '--format', format];
    if (family) args.push('--family', family);
    const result = await runDocxCli(args);
    const bytes = await fsp.readFile(result.path);
    const meta = packetMeta(path.dirname(packetJsonPath));
    const suffix = kind === 'cover' ? 'Cover_Letter' : kind === 'parse' ? 'Resume_For_Upload' : `Resume_${result.family || 'Executive'}`;
    const base = [meta.name, meta.company, suffix].filter(Boolean).join('_');
    return { bytes, mime: MIME_BY_FORMAT[format], filename: safeFilename(base, format), family: result.family || family || 'Professional' };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderBlankTemplate({ family, format }) {
  const fam = normalizeFamily(family) || 'Professional';
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'career-docx-tpl-'));
  try {
    const result = await runDocxCli(['export-template', '--out-dir', tmpDir, '--family', fam, '--format', format]);
    const bytes = await fsp.readFile(result.path);
    return { bytes, mime: MIME_BY_FORMAT[format], filename: safeFilename(`${fam}_Resume_Template`, format), family: fam };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  PARSE_FILE,
  MIME_BY_FORMAT,
  normalizeFamily,
  normalizeFormat,
  safeFilename,
  siblingArtifactPath,
  packetMeta,
  renderPacketArtifact,
  renderBlankTemplate,
};
