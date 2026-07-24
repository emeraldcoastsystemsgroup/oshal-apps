/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-18 13:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | ADR-085 Wave 2 carve #5: the app-owned walmart-catalog action-policy tests moved here from core's tests/unit/oshal-walmart-cli.spec.ts. These functions (walmartFallbackMetadata / walmartCatalogAllowsActions / enforceWalmartCatalogActionPolicy) live in purchasing-routes.ts, which carved with the app; the CLI tests for the framework-resident oshal-walmart.js stay in core.
 */

import { describe, expect, it } from 'vitest';
import {
  enforceWalmartCatalogActionPolicy,
  walmartCatalogAllowsActions,
  walmartFallbackMetadata,
} from '../src-routes/purchasing-routes';

describe('walmart catalog action policy (purchasing route boundary)', () => {
  it('re-bounds provider diagnostics at the purchasing route boundary', () => {
    expect(walmartFallbackMetadata({ fallbackReason: 'not_connected' })).toEqual({
      fallbackReason: 'not_connected',
    });
    expect(walmartFallbackMetadata({
      fallbackReason: 'provider_error',
      providerError: {
        code: 'http_error',
        status: 503,
        message: `secret:${'x'.repeat(500)}`,
      },
    })).toEqual({
      fallbackReason: 'provider_error',
      providerError: {
        code: 'http_error',
        status: 503,
        message: 'Walmart provider returned HTTP 503.',
      },
    });
  });

  it('permits chat mutations only for an unqualified live Walmart catalog', () => {
    expect(walmartCatalogAllowsActions({ source: 'walmart', items: [] })).toBe(true);
    expect(walmartCatalogAllowsActions({
      source: 'demo', fallbackReason: 'not_connected', items: [{ productId: 'demo-1' }],
    })).toBe(false);
    expect(walmartCatalogAllowsActions({
      source: 'demo', fallbackReason: 'provider_error', providerError: { status: 503 },
    })).toBe(false);
    expect(walmartCatalogAllowsActions({ source: 'walmart', fallbackReason: undefined })).toBe(false);
    expect(walmartCatalogAllowsActions({ source: 'walmart', error: 'unexpected provider warning' })).toBe(false);
    expect(walmartCatalogAllowsActions({ source: 'demo', items: [] })).toBe(false);
  });

  it('deterministically clears model-requested add and checkout actions for demo rows', () => {
    const providerFailure = {
      say: 'I added the demo item and started checkout.',
      add: [{ productId: 'demo-1', quantity: 1 }],
      checkout: true,
    };
    expect(enforceWalmartCatalogActionPolicy(providerFailure, {
      source: 'demo',
      fallbackReason: 'provider_error',
      providerError: { code: 'http_error', status: 503 },
    })).toBe(true);
    expect(providerFailure).toEqual({
      say: 'Walmart is connected, but its provider request failed. The cards are demo examples, so I did not add anything or start checkout.',
      add: [],
      checkout: false,
    });

    const live = {
      say: 'I added the live item.',
      add: [{ productId: 'live-1', quantity: 1 }],
      checkout: true,
    };
    expect(enforceWalmartCatalogActionPolicy(live, { source: 'walmart' })).toBe(false);
    expect(live.add).toHaveLength(1);
    expect(live.checkout).toBe(true);
  });
});
