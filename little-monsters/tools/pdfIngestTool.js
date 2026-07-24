/**
 * PDF Ingestion Tool — Textbook and Course Material Processing
 *
 * Parses PDF documents, chunks text by section, and stores in ChromaDB
 * for per-class RAG retrieval. Part of the Little Monsters education platform.
 *
 * Students and teachers upload textbooks/syllabi; this tool makes them
 * searchable by all education bots in the swarm.
 *
 * PHASE: Little Monsters Education Platform
 * Pattern: exports { 'tool-name': handlerFn } — auto-discovered by app.js
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation — PDF parsing + ChromaDB ingest
 * ---------------------------------------------------------------------------
 *
 * @module pdfIngestTool
 * @agent textbook-librarian, education-foundation
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

// ─── Configuration ──────────────────────────────────────────────────────────
const CHROMA_MCP_URL = process.env.CHROMA_MCP_URL || 'http://chroma-mcp:8091';
const CHROMADB_HOST = process.env.CHROMADB_HOST || 'chromadb';
const CHROMADB_PORT = process.env.CHROMADB_PORT || '8000';
const CHROMADB_DIRECT_URL = `http://${CHROMADB_HOST}:${CHROMADB_PORT}`;
const CHUNK_SIZE = 512;          // tokens (approx 4 chars per token)
const CHUNK_OVERLAP = 64;        // tokens overlap between chunks
const CHARS_PER_TOKEN = 4;       // rough approximation
const MAX_PDF_SIZE_MB = 100;

/**
 * Extract text from a PDF file using pdf-parse.
 * Falls back gracefully if the package isn't installed.
 *
 * @param {string} filePath — absolute path to PDF
 * @returns {Promise<{ text: string, pages: number, info: Object }>}
 */
async function extractPdfText(filePath) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw new Error(
      'pdf-parse not installed. Run: npm install pdf-parse'
    );
  }

  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);

  logger.info(`[PdfIngest] Extracted ${data.numpages} pages, ${data.text.length} chars from ${path.basename(filePath)}`);

  return {
    text: data.text,
    pages: data.numpages,
    info: data.info || {},
  };
}

/**
 * Split extracted text into overlapping chunks suitable for embedding.
 * Preserves section boundaries when possible (splits on headings/double newlines).
 *
 * @param {string} text — full extracted text
 * @param {Object} options
 * @param {number} options.chunkSize — target chunk size in tokens
 * @param {number} options.overlap — overlap between chunks in tokens
 * @returns {Array<{ text: string, index: number, startChar: number }>}
 */
function chunkText(text, options = {}) {
  const chunkChars = (options.chunkSize || CHUNK_SIZE) * CHARS_PER_TOKEN;
  const overlapChars = (options.overlap || CHUNK_OVERLAP) * CHARS_PER_TOKEN;
  const chunks = [];

  if (!text || text.trim().length === 0) {
    return chunks;
  }

  // Split on paragraph boundaries (double newline) to preserve structure
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let currentChunk = '';
  let currentStartChar = 0;
  let charOffset = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();

    // If adding this paragraph would exceed chunk size, flush current chunk
    if (currentChunk.length + trimmed.length > chunkChars && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startChar: currentStartChar,
      });

      // Overlap: keep the tail of the current chunk
      const overlapText = currentChunk.slice(-overlapChars);
      currentChunk = overlapText + '\n\n' + trimmed;
      currentStartChar = charOffset - overlapChars;
    } else {
      if (currentChunk.length === 0) {
        currentStartChar = charOffset;
      }
      currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmed;
    }

    charOffset += trimmed.length + 2; // +2 for the paragraph separator
  }

  // Flush remaining text
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunks.length,
      startChar: currentStartChar,
    });
  }

  logger.info(`[PdfIngest] Chunked ${text.length} chars into ${chunks.length} chunks (target: ${chunkChars} chars/chunk)`);

  return chunks;
}

/**
 * Estimate the page number for a given character offset.
 * Assumes roughly equal text distribution across pages.
 *
 * @param {number} charOffset — character position in full text
 * @param {number} totalChars — total characters in document
 * @param {number} totalPages — total pages in document
 * @returns {number} — estimated page number (1-based)
 */
function estimatePage(charOffset, totalChars, totalPages) {
  if (totalChars === 0 || totalPages === 0) return 1;
  const ratio = charOffset / totalChars;
  return Math.min(totalPages, Math.max(1, Math.ceil(ratio * totalPages)));
}

/**
 * Store chunks in ChromaDB via the MCP HTTP endpoint.
 * Creates the collection if it doesn't exist.
 *
 * @param {string} collectionName — ChromaDB collection name
 * @param {Array<Object>} chunks — array of { text, index, startChar }
 * @param {Object} metadata — shared metadata for all chunks
 * @returns {Promise<{ stored: number, collectionName: string }>}
 */
async function storeInChromaDB(collectionName, chunks, metadata = {}) {
  if (chunks.length === 0) {
    logger.warn(`[PdfIngest] No chunks to store in ${collectionName}`);
    return { stored: 0, collectionName };
  }

  const ids = chunks.map((c, i) => `${metadata.sourceFile || 'doc'}-chunk-${i}`);
  const documents = chunks.map(c => c.text);
  const metadatas = chunks.map(c => ({
    ...metadata,
    chunkIndex: c.index,
    startChar: c.startChar,
    estimatedPage: c.estimatedPage || 0,
  }));

  // Primary: ChromaDB MCP JSON-RPC (same pattern as SwarmMemoryService)
  try {
    const mcpPayload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'chroma_add_documents',
        arguments: {
          collection_name: collectionName,
          documents,
          ids,
          metadatas,
        },
      },
      id: Date.now(),
    };

    const mcpResp = await fetch(CHROMA_MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpPayload),
    });

    if (mcpResp.ok) {
      const mcpResult = await mcpResp.json();
      if (mcpResult && !mcpResult.error) {
        logger.info(`[PdfIngest] MCP stored ${chunks.length} chunks in collection: ${collectionName}`);
        return { stored: chunks.length, collectionName };
      }
    }

    logger.debug(`[PdfIngest] MCP store failed, trying direct ChromaDB API`);
  } catch (mcpErr) {
    logger.debug(`[PdfIngest] MCP unavailable: ${mcpErr.message}, trying direct API`);
  }

  // Fallback: ChromaDB REST API (same pattern as SwarmMemoryService._storeDirectChromaDB)
  try {
    // Ensure collection exists
    try {
      await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: collectionName, metadata: { type: 'education' } }),
      });
    } catch { /* collection may already exist */ }

    // Get collection ID by listing and filtering
    const listResp = await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!listResp.ok) {
      throw new Error(`ChromaDB collection list failed: ${listResp.status}`);
    }

    const collections = await listResp.json();
    const coll = (Array.isArray(collections) ? collections : []).find(c => c.name === collectionName);

    if (!coll) {
      throw new Error(`Could not find or create collection ${collectionName}`);
    }

    // Add documents
    const addResp = await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections/${coll.id}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, documents, metadatas }),
    });

    if (!addResp.ok) {
      const errText = await addResp.text();
      throw new Error(`ChromaDB add failed: ${addResp.status} — ${errText}`);
    }

    logger.info(`[PdfIngest] Direct API stored ${chunks.length} chunks in collection: ${collectionName}`);
    return { stored: chunks.length, collectionName };

  } catch (error) {
    logger.error(`[PdfIngest] ChromaDB storage failed: ${error.message}`);
    throw error;
  }
}

/**
 * Validate a PDF file for ingestion.
 * @param {string} filePath
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePdf(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'pdfPath is required' };
  }

  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return { valid: false, error: 'File must be a PDF' };
  }

  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB > MAX_PDF_SIZE_MB) {
    return { valid: false, error: `File too large (${sizeMB.toFixed(1)}MB). Max: ${MAX_PDF_SIZE_MB}MB` };
  }

  return { valid: true };
}

// ─── Exported Tool Handlers ─────────────────────────────────────────────────

/**
 * Ingest a textbook PDF into ChromaDB for class-scoped RAG.
 *
 * @param {Object} params
 * @param {string} params.pdfPath — path to PDF file
 * @param {string} params.classId — class identifier for collection scoping
 * @param {string} params.textbookTitle — human-readable title
 * @param {string} [params.subject] — subject area
 * @returns {Promise<Object>} — { success, chunks, pages, collectionName }
 */
async function ingestTextbook(params = {}) {
  const { pdfPath, classId, textbookTitle, subject } = params;

  logger.info(`[PdfIngest] ingest-textbook called: ${pdfPath} (class: ${classId || 'unknown'}, title: ${textbookTitle || 'untitled'})`);

  // Validate
  if (!classId) {
    return { success: false, error: 'classId is required — textbooks must be scoped to a class' };
  }

  const validation = validatePdf(pdfPath);
  if (!validation.valid) {
    logger.warn(`[PdfIngest] Validation failed: ${validation.error}`);
    return { success: false, error: validation.error };
  }

  try {
    // Extract text from PDF
    const { text, pages, info } = await extractPdfText(pdfPath);

    if (text.trim().length < 100) {
      logger.warn(`[PdfIngest] PDF has very little text (${text.length} chars) — may be image-based`);
      return {
        success: false,
        error: 'PDF contains very little extractable text. It may be image-based and require OCR.',
        pages,
      };
    }

    // Chunk text
    const chunks = chunkText(text);

    // Add page estimates to each chunk
    for (const chunk of chunks) {
      chunk.estimatedPage = estimatePage(chunk.startChar, text.length, pages);
    }

    // Store in class-specific ChromaDB collection
    const collectionName = `lm-class-${classId}-textbooks`;
    const metadata = {
      sourceFile: path.basename(pdfPath),
      textbookTitle: textbookTitle || path.basename(pdfPath, '.pdf'),
      subject: subject || '',
      classId,
      pages,
      ingestedAt: new Date().toISOString(),
      type: 'textbook',
    };

    const result = await storeInChromaDB(collectionName, chunks, metadata);

    // Write summary to workspace for auditability
    const summaryPath = path.join(
      path.dirname(pdfPath),
      `INGEST-SUMMARY-${path.basename(pdfPath, '.pdf')}.md`
    );
    const summary = [
      `# Textbook Ingestion Summary`,
      ``,
      `**Title:** ${textbookTitle || path.basename(pdfPath)}`,
      `**Pages:** ${pages}`,
      `**Chunks:** ${chunks.length}`,
      `**Collection:** ${collectionName}`,
      `**Ingested:** ${new Date().toISOString()}`,
      `**Author:** ${info.Author || 'Unknown'}`,
      ``,
      `## Key Terms Extracted`,
      `_(Available via query-class-knowledge tool)_`,
    ].join('\n');

    fs.writeFileSync(summaryPath, summary, 'utf-8');

    logger.info(`[PdfIngest] Textbook ingested: ${pages} pages, ${chunks.length} chunks -> ${collectionName}`);

    return {
      success: true,
      chunks: chunks.length,
      pages,
      collectionName,
      summaryPath,
      textbookTitle: textbookTitle || path.basename(pdfPath),
    };
  } catch (error) {
    logger.error(`[PdfIngest] Ingestion failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Ingest a syllabus PDF — extracts schedule, assignments, grading criteria.
 *
 * @param {Object} params
 * @param {string} params.pdfPath — path to syllabus PDF
 * @param {string} params.classId — class identifier
 * @returns {Promise<Object>} — { success, chunks, pages, collectionName }
 */
async function ingestSyllabus(params = {}) {
  const { pdfPath, classId } = params;

  logger.info(`[PdfIngest] ingest-syllabus called: ${pdfPath} (class: ${classId || 'unknown'})`);

  if (!classId) {
    return { success: false, error: 'classId is required' };
  }

  const validation = validatePdf(pdfPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const { text, pages, info } = await extractPdfText(pdfPath);
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      chunk.estimatedPage = estimatePage(chunk.startChar, text.length, pages);
    }

    // Syllabi go into the same textbooks collection but tagged differently
    const collectionName = `lm-class-${classId}-textbooks`;
    const metadata = {
      sourceFile: path.basename(pdfPath),
      classId,
      pages,
      ingestedAt: new Date().toISOString(),
      type: 'syllabus',
    };

    const result = await storeInChromaDB(collectionName, chunks, metadata);

    logger.info(`[PdfIngest] Syllabus ingested: ${pages} pages, ${chunks.length} chunks -> ${collectionName}`);

    return {
      success: true,
      chunks: chunks.length,
      pages,
      collectionName,
    };
  } catch (error) {
    logger.error(`[PdfIngest] Syllabus ingestion failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ─── Export (app.js auto-discovery pattern) ──────────────────────────────────

module.exports = {
  'ingest-textbook': ingestTextbook,
  'ingest-syllabus': ingestSyllabus,
};
