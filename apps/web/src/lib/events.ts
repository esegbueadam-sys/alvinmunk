/**
 * Shared reputation-event reader. `constellation`, `feed`, and `leaderboard` all need the
 * same RPC `getEvents` window + ScVal decode — this is the one place that knows how to pull
 * and decode them, so the durable-indexer swap (Blue/Black, belts/00-strategy) is a
 * one-file change instead of three. RPC-direct for the MVP; degrades to [] on any failure.
 */
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { server, config } from './stellar';

/**
 * RPC event retention is ~24h; staying within ~9000 ledgers keeps `getEvents` returning
 * rows instead of an out-of-range error (≥16k returns 0 events).
 */
export const EVENT_LEDGER_WINDOW = 9000;

/** A decoded contract event: topics + value already run through scValToNative. */
export interface RepEvent {
  topics: unknown[];
  data: unknown;
  ledger: number;
}

/**
 * Decode an XDR/base64 ScVal to its native JS value.
 * Returns null on malformed input so that contract-event callers (leaderboard,
 * feed, constellation) degrade gracefully instead of crashing on bad data.
 */
export function decodeScVal(v: xdr.ScVal | string): unknown {
  try {
    const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
    return scValToNative(sv);
  } catch {
    return null;
  }
}

/**
 * Recent reputation-contract events (decoded), in RPC order (oldest-first). Returns [] if
 * the contract isn't deployed or RPC is unavailable so every caller degrades gracefully.
 */
export async function fetchReputationEvents(limit = 1000): Promise<RepEvent[]> {
  return fetchContractEvents(config.contracts.reputation, limit);
}

/**
 * Recent rewards-contract events (decoded) — the `tipped` feed source. Same window +
 * degrade-to-empty contract as fetchReputationEvents (Green tip rail, belts/04).
 */
export async function fetchRewardsEvents(limit = 1000): Promise<RepEvent[]> {
  return fetchContractEvents(config.contracts.rewards, limit);
}

async function fetchContractEvents(contractId: string, limit: number): Promise<RepEvent[]> {
  if (!contractId) return [];

  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - EVENT_LEDGER_WINDOW);
  } catch {
    return [];
  }

  try {
    const res = await server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [contractId], topics: [['*', '*']] }],
      limit,
    });
    return res.events.map((ev) => ({
      topics: (ev.topic as Array<xdr.ScVal | string>).map(decodeScVal),
      data: decodeScVal(ev.value as xdr.ScVal | string),
      ledger: ev.ledger,
    }));
  } catch {
    return [];
  }
}
