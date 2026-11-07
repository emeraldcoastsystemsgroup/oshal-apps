/**
 * Server-side bibliographic lookup by ISBN, DOI, or public URL (RP-LM-03).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Resolve ISBNs via Open Library, DOIs via Crossref, and public page metadata via safe egress fetch without client keys
 * ---------------------------------------------------------------------------
 *
 * @module education-citation-lookup
 */

import net from 'net';

export interface CitationMetadata {
  type: 'book' | 'journal' | 'website';
  author: string;
  title: string;
  source: string;
  year: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url: string;
}

export class CitationLookupError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function isPrivateIpAddress(host: string): boolean {
  const family = net.isIP(host);
  if (family === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  if (family === 6) {
    const lower = host.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

function assertPublicHttpsUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CitationLookupError(400, 'Enter a valid ISBN, DOI, or https:// URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new CitationLookupError(400, 'URL lookup accepts public https:// addresses only.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateIpAddress(host)
  ) {
    throw new CitationLookupError(400, 'URL lookup refuses private or local network addresses.');
  }
  return parsed;
}

async function safeEgressFetch(
  fetcher: FetchLike,
  initialUrl: string,
  accept: string,
): Promise<Response> {
  let current = assertPublicHttpsUrl(initialUrl).href;
  for (let hop = 0; hop < 3; hop += 1) {
    const res = await fetcher(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept,
        'user-agent': 'oshal-little-monsters-citations/1.9',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = assertPublicHttpsUrl(new URL(loc, current).href).href;
      continue;
    }
    return res;
  }
  throw new CitationLookupError(502, 'Source redirected too many times.');
}

function cleanIsbnCandidate(query: string): string | null {
  const stripped = query.replace(/^isbn[:\s-]*/i, '').replace(/[-\s]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(stripped)) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const digit = stripped[i] === 'X' ? 10 : Number(stripped[i]);
      sum += digit * (10 - i);
    }
    return sum % 11 === 0 ? stripped : null;
  }
  if (/^\d{13}$/.test(stripped) && (stripped.startsWith('978') || stripped.startsWith('979'))) {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(stripped[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(stripped[12]) ? stripped : null;
  }
  return null;
}

function cleanDoiCandidate(query: string): string | null {
  const trimmed = query
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(trimmed) ? trimmed : null;
}

function formatPersonName(raw: string): string {
  const clean = raw.trim();
  if (!clean || clean.includes(',')) return clean;
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return clean;
  const last = parts[parts.length - 1];
  return `${last}, ${parts.slice(0, -1).join(' ')}`;
}

async function lookupIsbn(fetcher: FetchLike, isbn: string): Promise<CitationMetadata> {
  const endpoint = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await safeEgressFetch(fetcher, endpoint, 'application/json');
  if (!res.ok) {
    throw new CitationLookupError(404, `No book found for ISBN ${isbn}.`);
  }
  const body = (await res.json()) as Record<string, any>;
  const entry = body[`ISBN:${isbn}`];
  if (!entry || !entry.title) {
    throw new CitationLookupError(404, `No book found for ISBN ${isbn}.`);
  }
  const authors = Array.isArray(entry.authors)
    ? entry.authors.map((a: any) => formatPersonName(String(a?.name || ''))).filter(Boolean)
    : [];
  const publishers = Array.isArray(entry.publishers)
    ? entry.publishers.map((p: any) => String(p?.name || '').trim()).filter(Boolean)
    : [];
  const yearMatch = String(entry.publish_date || '').match(/\b(1\d{3}|20\d{2})\b/);
  return {
    type: 'book',
    author: authors[0] || '',
    title: String(entry.title).trim(),
    source: publishers[0] || 'Open Library',
    year: yearMatch ? yearMatch[1] : '',
    url: entry.url ? String(entry.url) : `https://openlibrary.org/isbn/${isbn}`,
  };
}

async function lookupDoi(fetcher: FetchLike, doi: string): Promise<CitationMetadata> {
  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const res = await safeEgressFetch(fetcher, endpoint, 'application/json');
  if (res.status === 404 || !res.ok) {
    throw new CitationLookupError(404, `No work found for DOI ${doi}.`);
  }
  const payload = (await res.json()) as { message?: Record<string, any> };
  const msg = payload?.message;
  if (!msg) throw new CitationLookupError(404, `No work found for DOI ${doi}.`);
  const title = Array.isArray(msg.title) ? String(msg.title[0] || '').trim() : String(msg.title || '').trim();
  if (!title) throw new CitationLookupError(404, `No work found for DOI ${doi}.`);
  const firstAuthor = Array.isArray(msg.author) && msg.author[0]
    ? [msg.author[0].family, msg.author[0].given].filter(Boolean).join(', ')
    : '';
  const container = Array.isArray(msg['container-title'])
    ? String(msg['container-title'][0] || '').trim()
    : '';
  const dateParts = msg.issued?.['date-parts']?.[0] || msg.published?.['date-parts']?.[0] || [];
  const isBook = String(msg.type || '').includes('book');
  return {
    type: isBook ? 'book' : 'journal',
    author: firstAuthor,
    title,
    source: container || String(msg.publisher || '').trim(),
    year: dateParts[0] ? String(dateParts[0]) : '',
    volume: msg.volume ? String(msg.volume) : '',
    issue: msg.issue ? String(msg.issue) : '',
    pages: msg.page ? String(msg.page) : '',
    url: `https://doi.org/${doi}`,
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaTag(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
  }
  return '';
}

async function lookupUrl(fetcher: FetchLike, rawUrl: string): Promise<CitationMetadata> {
  const parsed = assertPublicHttpsUrl(rawUrl);
  let res: Response;
  try {
    res = await safeEgressFetch(fetcher, parsed.href, 'text/html,application/xhtml+xml');
  } catch (err) {
    if (err instanceof CitationLookupError) throw err;
    throw new CitationLookupError(
      404,
      'Could not reach that site from school citation lookup. Enter the fields directly or try an ISBN or DOI.',
    );
  }
  if (!res.ok) {
    throw new CitationLookupError(404, `Source returned HTTP ${res.status} for ${parsed.hostname}.`);
  }
  const html = (await res.text()).slice(0, 120_000);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    extractMetaTag(html, ['citation_title', 'og:title', 'dc.title', 'twitter:title']) ||
    (titleTag ? decodeHtmlEntities(titleTag[1]) : '');
  if (!title) {
    throw new CitationLookupError(404, 'No readable title metadata found at that URL.');
  }
  const author = formatPersonName(
    extractMetaTag(html, ['citation_author', 'author', 'article:author', 'dc.creator']),
  );
  const site =
    extractMetaTag(html, ['citation_journal_title', 'og:site_name', 'application-name']) ||
    parsed.hostname.replace(/^www\./, '');
  const published = extractMetaTag(html, [
    'citation_publication_date',
    'article:published_time',
    'date',
    'dc.date',
  ]);
  const yearMatch = published.match(/\b(1\d{3}|20\d{2})\b/);
  return {
    type: 'website',
    author,
    title,
    source: site,
    year: yearMatch ? yearMatch[1] : '',
    url: parsed.href,
  };
}

/** Resolve an ISBN, DOI, or public https:// URL into normalized bibliographic fields. */
export async function lookupCitationSource(
  rawQuery: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<CitationMetadata> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query) {
    throw new CitationLookupError(400, 'Enter an ISBN, DOI, or https:// URL to look up.');
  }
  const doi = cleanDoiCandidate(query);
  if (doi) return lookupDoi(fetcher, doi);

  const isbn = cleanIsbnCandidate(query);
  if (isbn) return lookupIsbn(fetcher, isbn);

  if (/^isbn[:\s-]/i.test(query) || /^[\dXx-\s]{10,17}$/.test(query)) {
    throw new CitationLookupError(404, 'That ISBN checksum did not match a published book.');
  }
  if (/^https?:\/\//i.test(query)) {
    return lookupUrl(fetcher, query);
  }
  throw new CitationLookupError(
    404,
    'No source found. Enter an ISBN (978...), a DOI (10.xxxx/...), or a full https:// URL.',
  );
}
