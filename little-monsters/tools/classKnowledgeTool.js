/**
 * Class Knowledge Tool — Scoped RAG Queries for Education Bots
 *
 * Provides class-specific knowledge retrieval from ChromaDB. Every education
 * bot in the swarm shares these collections — when the textbook-librarian
 * ingests a PDF or the lecture-scribe indexes a transcript, all bots can
 * query the resulting knowledge.
 *
 * This is the "shared memory" layer for the Little Monsters education platform.
 *
 * PHASE: Little Monsters Education Platform
 * Pattern: exports { 'tool-name': handlerFn } — auto-discovered by app.js
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation — class-scoped ChromaDB queries
 * ---------------------------------------------------------------------------
 *
 * @module classKnowledgeTool
 * @agent education-foundation (all education bots)
 */

const logger = require('../../../utils/logger');

// ─── Configuration ──────────────────────────────────────────────────────────
const CHROMA_MCP_URL = process.env.CHROMA_MCP_URL || 'http://chroma-mcp:8091';
const CHROMADB_HOST = process.env.CHROMADB_HOST || 'chromadb';
const CHROMADB_PORT = process.env.CHROMADB_PORT || '8000';
const CHROMADB_DIRECT_URL = `http://${CHROMADB_HOST}:${CHROMADB_PORT}`;
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;

/**
 * Collection naming convention for education content.
 * All education bots use the same naming scheme, ensuring shared access.
 */
const COLLECTION_TYPES = {
  textbooks: 'textbooks',
  lectures: 'lectures',
  notes: 'notes',
  flashcards: 'flashcards',
};

/** Global (cross-class) collections */
const GLOBAL_COLLECTIONS = {
  formulas: 'lm-global-formulas',
  vocabulary: 'lm-global-vocabulary',
};

/**
 * Build the ChromaDB collection name for a class + content type.
 * @param {string} classId
 * @param {string} type — one of: textbooks, lectures, notes, flashcards
 * @returns {string}
 */
function collectionName(classId, type) {
  return `lm-class-${classId}-${type}`;
}

/**
 * Query a ChromaDB collection by semantic similarity.
 *
 * @param {string} collection — collection name
 * @param {string} queryText — natural language query
 * @param {number} nResults — number of results to return
 * @param {Object} [whereFilter] — optional metadata filter
 * @returns {Promise<Array<{ text: string, metadata: Object, distance: number }>>}
 */
async function queryCollection(collection, queryText, nResults = DEFAULT_RESULT_COUNT, whereFilter = null) {
  // Primary: ChromaDB MCP JSON-RPC (same pattern as SwarmMemoryService)
  try {
    const mcpPayload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'chroma_query_documents',
        arguments: {
          collection_name: collection,
          query_texts: [queryText.substring(0, 1000)],
          n_results: Math.min(nResults, MAX_RESULT_COUNT),
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
      if (mcpResult && !mcpResult.error && mcpResult.result) {
        const content = mcpResult.result?.content;
        if (Array.isArray(content)) {
          const textContent = content.find(c => c.type === 'text');
          if (textContent?.text) {
            const parsed = JSON.parse(textContent.text);
            if (parsed.documents && parsed.documents[0]) {
              const results = parsed.documents[0].map((doc, i) => ({
                text: doc,
                metadata: parsed.metadatas?.[0]?.[i] || {},
                distance: parsed.distances?.[0]?.[i] || 0,
              }));
              logger.debug(`[ClassKnowledge] MCP query "${queryText.substring(0, 50)}..." -> ${results.length} results from ${collection}`);
              return results;
            }
          }
        }
      }
    }
  } catch (mcpErr) {
    logger.debug(`[ClassKnowledge] MCP query failed for ${collection}: ${mcpErr.message}, trying direct API`);
  }

  // Fallback: ChromaDB REST API (same pattern as SwarmMemoryService._storeDirectChromaDB)
  try {
    // Look up collection by listing all and filtering by name
    const listResp = await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!listResp.ok) {
      logger.debug(`[ClassKnowledge] Direct API: collection list failed: ${listResp.status}`);
      return [];
    }

    const collections = await listResp.json();
    const coll = (Array.isArray(collections) ? collections : []).find(c => c.name === collection);
    if (!coll) {
      logger.debug(`[ClassKnowledge] Collection not found: ${collection}`);
      return [];
    }

    const queryBody = {
      query_texts: [queryText],
      n_results: Math.min(nResults, MAX_RESULT_COUNT),
    };
    if (whereFilter) queryBody.where = whereFilter;

    const queryResp = await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections/${coll.id}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });

    if (!queryResp.ok) return [];

    const result = await queryResp.json();
    const documents = result.documents?.[0] || [];
    const metadatas = result.metadatas?.[0] || [];
    const distances = result.distances?.[0] || [];

    const results = documents.map((doc, i) => ({
      text: doc,
      metadata: metadatas[i] || {},
      distance: distances[i] || 0,
    }));

    logger.debug(`[ClassKnowledge] Direct query "${queryText.substring(0, 50)}..." -> ${results.length} results from ${collection}`);
    return results;

  } catch (error) {
    logger.error(`[ClassKnowledge] Query failed for ${collection}: ${error.message}`);
    return [];
  }
}

/**
 * Format query results into a citation-rich response for education bots.
 * Each result includes source attribution so bots can say
 * "See textbook p.47" or "From your Oct 15 lecture."
 *
 * @param {Array<Object>} results — query results
 * @returns {string} — formatted markdown
 */
function formatResults(results) {
  if (results.length === 0) {
    return '_No matching content found in the class knowledge base._';
  }

  return results.map((r, i) => {
    const meta = r.metadata || {};
    const source = meta.sourceFile || 'Unknown source';
    const page = meta.estimatedPage ? ` (p.${meta.estimatedPage})` : '';
    const type = meta.type || 'content';
    const date = meta.lectureDate || meta.ingestedAt?.split('T')[0] || '';

    let citation = `**[${type}]** ${source}${page}`;
    if (date) citation += ` — ${date}`;

    return `### Result ${i + 1}\n${citation}\n\n${r.text}\n`;
  }).join('\n---\n\n');
}

// ─── Exported Tool Handlers ─────────────────────────────────────────────────

/**
 * Query class-specific knowledge from ChromaDB.
 * Searches across textbooks, lectures, and notes for the given class.
 *
 * @param {Object} params
 * @param {string} params.classId — class identifier (required)
 * @param {string} params.query — natural language search query (required)
 * @param {string[]} [params.sources] — filter by source type: ['textbooks', 'lectures', 'notes']
 * @param {number} [params.maxResults] — max results per collection (default: 5)
 * @returns {Promise<Object>} — { success, results, formatted, totalResults }
 */
async function queryClassKnowledge(params = {}) {
  const { classId, query, sources, maxResults } = params;

  logger.info(`[ClassKnowledge] query-class-knowledge: "${query?.substring(0, 60)}..." (class: ${classId || 'unknown'})`);

  if (!classId) {
    return { success: false, error: 'classId is required — queries must be scoped to a class' };
  }
  if (!query || query.trim().length === 0) {
    return { success: false, error: 'query is required' };
  }

  const nResults = Math.min(maxResults || DEFAULT_RESULT_COUNT, MAX_RESULT_COUNT);

  // Determine which collections to search
  const searchTypes = sources && sources.length > 0
    ? sources.filter(s => COLLECTION_TYPES[s])
    : Object.keys(COLLECTION_TYPES);

  // Query all relevant collections in parallel
  const queryPromises = searchTypes.map(type =>
    queryCollection(collectionName(classId, type), query, nResults)
      .then(results => results.map(r => ({ ...r, sourceType: type })))
  );

  // Also query global collections (formulas, vocabulary)
  queryPromises.push(
    queryCollection(GLOBAL_COLLECTIONS.formulas, query, 2)
      .then(results => results.map(r => ({ ...r, sourceType: 'formulas' })))
  );
  queryPromises.push(
    queryCollection(GLOBAL_COLLECTIONS.vocabulary, query, 2)
      .then(results => results.map(r => ({ ...r, sourceType: 'vocabulary' })))
  );

  const allResults = await Promise.all(queryPromises);
  const flatResults = allResults.flat();

  // Sort by relevance (lowest distance = most similar)
  flatResults.sort((a, b) => a.distance - b.distance);

  // Cap total results
  const topResults = flatResults.slice(0, nResults);
  const formatted = formatResults(topResults);

  logger.info(`[ClassKnowledge] Found ${flatResults.length} total results, returning top ${topResults.length}`);

  return {
    success: true,
    results: topResults,
    formatted,
    totalResults: flatResults.length,
    collectionsSearched: searchTypes.length + 2, // +2 for global collections
  };
}

/**
 * List all ingested materials for a class.
 * Useful for students to see what's available and for bots to check coverage.
 *
 * @param {Object} params
 * @param {string} params.classId — class identifier
 * @returns {Promise<Object>} — { success, materials }
 */
async function listClassMaterials(params = {}) {
  const { classId } = params;

  logger.info(`[ClassKnowledge] list-class-materials: class ${classId || 'unknown'}`);

  if (!classId) {
    return { success: false, error: 'classId is required' };
  }

  const materials = {};

  // Fetch all collections once, then filter (avoids N+1 requests)
  let allCollections = [];
  try {
    const listResp = await fetch(`${CHROMADB_DIRECT_URL}/api/v1/collections`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (listResp.ok) {
      allCollections = await listResp.json();
      if (!Array.isArray(allCollections)) allCollections = [];
    }
  } catch {
    logger.debug(`[ClassKnowledge] ChromaDB unreachable for collection list`);
  }

  for (const type of Object.keys(COLLECTION_TYPES)) {
    const name = collectionName(classId, type);
    const coll = allCollections.find(c => c.name === name);
    materials[type] = {
      collectionName: name,
      documentCount: coll ? (coll.count || 0) : 0,
    };
  }

  logger.info(`[ClassKnowledge] Materials for class ${classId}: ${JSON.stringify(materials)}`);

  return {
    success: true,
    classId,
    materials,
  };
}

// ─── Export (app.js auto-discovery pattern) ──────────────────────────────────

module.exports = {
  'query-class-knowledge': queryClassKnowledge,
  'list-class-materials': listClassMaterials,
};
