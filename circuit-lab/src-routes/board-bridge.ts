/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the typed door to the breadboard model the
 *                     |                             | surface and the routes SHARE (tools/circuit-lab-board-model.js,
 *                     |                             | plain JS so one copy serves the browser and node): the board
 *                     |                             | shape, and the functions the routes call to lay a board out,
 *                     |                             | validate an edited one, derive wires from it and keep it in
 *                     |                             | step with every schematic change.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A placement may carry `rot` (a turned footprint, BACKLOG B2).
 */

import path from 'node:path';
import type { CircuitPart, CircuitWire } from './circuit-contract';

/** @description Where a part sits: its anchor hole (a DIP's row is always 'e') and its turn (0 when absent; 90 runs its legs down the rows). */
export interface BoardPlacement { col: number; row: string; rot?: 90 | 180 | 270 }
/** @description A jumper wire between two holes. */
export interface BoardJumper { id: string; from: string; to: string }
/** @description The board beside a schematic; `stale` names why it no longer implies the schematic's nets. */
export interface BoardLayout { placements: Record<string, BoardPlacement>; jumpers: BoardJumper[]; stale?: string }

type Contract = { parts: Record<string, { pins: Array<{ name: string; kind: string }> }> };
type Nets = string[][];

/** The model's surface as the routes use it. */
export interface BoardModelApi {
  COLS: number;
  validateBoard(board: unknown, parts: CircuitPart[]): BoardLayout;
  wireNets(parts: CircuitPart[], wires: CircuitWire[], contract: Contract): Nets;
  boardNets(board: BoardLayout, parts: CircuitPart[], contract: Contract): Nets;
  sameNets(a: Nets, b: Nets): boolean;
  wiresFromBoard(board: BoardLayout, parts: CircuitPart[], wires: CircuitWire[], contract: Contract): CircuitWire[];
  autoLayout(parts: CircuitPart[], wires: CircuitWire[], contract: Contract): BoardLayout | null;
  reconcileBoard(board: BoardLayout, parts: CircuitPart[], wires: CircuitWire[], contract: Contract): BoardLayout;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const boardModel: BoardModelApi = require(path.join(__dirname, '..', 'tools', 'circuit-lab-board-model.js')) as BoardModelApi;

/** @description A board validation failure carries the field it names. */
export function boardFailure(error: unknown): { field: string; message: string } | null {
  const e = error as { field?: unknown; message?: unknown };
  return e && typeof e.field === 'string' ? { field: e.field, message: String(e.message) } : null;
}
