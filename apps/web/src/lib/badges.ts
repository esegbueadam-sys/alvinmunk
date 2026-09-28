/**
 * Milestone badges (Green belt, belts/04 §UX) — "BADGES THAT NAME PEOPLE".
 *
 * The engine is PURE: `computeBadges(input) -> Badge[]` reads plain numbers, so it
 * is unit-testable per threshold and never touches a wallet, XP, or the treasury.
 * Everything it reads is a public Social/Earned state read (belts/08 two-track:
 * badges are pure reads, they grant nothing and unlock nothing cashable).
 *
 * Faces over numbers: badges whose story involves another person carry a name
 * (`namedBy` — the @handle of the first voucher/tipper, or a short address).
 *
 * Data sources (all degrade gracefully — a badge row never blocks a page):
 *   - `vouch:claimed` events → inbound (backed) + outbound (vouched-for) unique edges
 *   - `tipped` events         → first tip sent (Generous)
 *   - get_profile             → is_verified (Verified badge), Earned XP
 *   - get_streak              → best weekly streak (Four Weeks)
 * The RPC event window is ~24h, so inbound/outbound edges persist to a localStorage
 * snapshot (same pattern as the leaderboard) and are merged on load.
 */
import { EVENTS } from '@alvinmunk/shared';
import { fetchReputationEvents, fetchRewardsEvents } from './events';
import { getProfile } from './reputation';
import { getStreak } from './quests';
import { reverseHandle } from './registry';
import { shortAddress } from './utils';

// ── Public shapes ─────────────────────────────────────────────────────────────

/** Everything the pure engine needs — no wallets, no promises, just numbers/names. */
export interface BadgeInput {
  /** unique people who vouched for this address (claimed half-cards) */
  backedBy: number;
  /** unique people this address has vouched for (claimed their half-cards) */
  vouchedFor: number;
  /** has ≥1 attester-verified (Earned) action happened */
  isVerified: boolean;
  /** best consecutive-weeks quest streak (get_streak.best) */
  streakBest: number;
  /** has this address sent ≥1 USDC tip */
  tipped: boolean;
  /** @handle of the first person who vouched this address (resolved best-effort) */
  firstBackerName?: string;
  /** @handle of the first person this address tipped (resolved best-effort) */
  firstTippedName?: string;
  /** @handle of the badge owner (used for "your" copy fallbacks) */
  handle?: string;
}

export type BadgeId =
  | 'first-star'
  | 'connector'
  | 'constellation'
  | 'verified'
  | 'four-weeks'
  | 'generous';

export interface Badge {
  id: BadgeId;
  /** Short display name, e.g. "Connector". */
  name: string;
  /** Milestone sentence, name-the-person when known: "vouched for 5 people". */
  description: string;
  earned: boolean;
  /** Sticker-asset key (lib/assets STICKER / STATE) rendering the badge face. */
  sticker: string;
  /** For a person-tied badge: WHO made it happen ("First star — lit by @alice"). */
  namedBy?: string;
  /** The remaining step when locked: "2 more vouches". */
  nextStep?: string;
}

// ── The catalog (thresholds) ──────────────────────────────────────────────────

export const THRESHOLDS = {
  CONNECTOR_BACKED: 5,
  CONSTELLATION_VOUCHED_BY: 10,
  FOUR_WEEKS_STREAK: 4,
} as const;

/**
 * PURE — the whole badge engine. Deterministic in `input`; no clock, no network,
 * no side effects. Ordered so the next-to-earn social badge comes first (the
 * pull-toward-the-next-milestone UX, belts/04 "almost there" state).
 */
export function computeBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = [];

  // First Star — the first claimed vouch you RECEIVED (someone backed you).
  // This is the one badge that must name its person: "First star — lit by @alice".
  badges.push({
    id: 'first-star',
    name: 'First Star',
    description: input.firstBackerName
      ? `lit by @${input.firstBackerName}`
      : 'your first vouch received',
    earned: input.backedBy >= 1,
    sticker: 'star-lime',
    namedBy: input.backedBy >= 1 ? input.firstBackerName : undefined,
    nextStep: 'receive your first vouch',
  });

  // Connector — vouched FOR people (giving, not receiving; matches quest copy
  // "rewards backing others, not just being backed").
  const toConnector = THRESHOLDS.CONNECTOR_BACKED - input.vouchedFor;
  badges.push({
    id: 'connector',
    name: 'Connector',
    description: `vouched for ${THRESHOLDS.CONNECTOR_BACKED} people`,
    earned: input.vouchedFor >= THRESHOLDS.CONNECTOR_BACKED,
    sticker: 'hand-shake',
    nextStep: toConnector > 0 ? `${toConnector} more vouch${toConnector === 1 ? '' : 'es'}` : undefined,
  });

  // Constellation — vouched BY people (the inbound milestone).
  const toConstellation = THRESHOLDS.CONSTELLATION_VOUCHED_BY - input.backedBy;
  badges.push({
    id: 'constellation',
    name: 'Constellation',
    description: `vouched by ${THRESHOLDS.CONSTELLATION_VOUCHED_BY} people`,
    earned: input.backedBy >= THRESHOLDS.CONSTELLATION_VOUCHED_BY,
    sticker: 'star-arc',
    nextStep:
      toConstellation > 0
        ? `${toConstellation} more vouch${toConstellation === 1 ? '' : 'es'}`
        : undefined,
  });

  // Verified — the first attester-verified (Earned) action. Earned track only:
  // Social XP can never unlock this badge (two-track, belts/08).
  badges.push({
    id: 'verified',
    name: 'Verified',
    description: 'first verified action',
    earned: input.isVerified,
    sticker: 'stamp-verified',
    nextStep: 'complete a verified quest',
  });

  // Four Weeks — a 4-week best streak on the weekly quests.
  const toFour = THRESHOLDS.FOUR_WEEKS_STREAK - input.streakBest;
  badges.push({
    id: 'four-weeks',
    name: 'Four Weeks',
    description: `${THRESHOLDS.FOUR_WEEKS_STREAK}-week best streak`,
    earned: input.streakBest >= THRESHOLDS.FOUR_WEEKS_STREAK,
    sticker: 'stamp-strip',
    nextStep: toFour > 0 ? `${toFour} more week${toFour === 1 ? '' : 's'}` : undefined,
  });

  // Generous — the first USDC tip SENT (a social act on the tip rail, not a payout).
  badges.push({
    id: 'generous',
    name: 'Generous',
    description: input.firstTippedName ? `first tip — to @${input.firstTippedName}` : 'sent your first tip',
    earned: input.tipped,
    sticker: 'ticker-coin',
    namedBy: input.tipped ? input.firstTippedName : undefined,
    nextStep: 'send your first tip',
  });

  return badges;
}

/** Earned badges only, in catalog order. */
export function earnedBadges(badges: Badge[]): Badge[] {
  return badges.filter((b) => b.earned);
}

// ── Event fold (pure) ─────────────────────────────────────────────────────────

/** Pure fold of reputation events into unique vouch-edge counts for one address. */
export function foldVouchEdges(
  events: { topics: unknown[]; data: unknown }[],
  address: string,
): { backedBy: number; vouchedFor: number; firstBacker?: string } {
  const backed = new Set<string>();
  const vouched = new Set<string>();
  // Events are oldest-first, so the FIRST edge seen for each direction is the
  // earliest one in the window — the person who lit the first star.
  let firstBacker: string | undefined;
  for (const { topics, data } of events) {
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    if (!Array.isArray(data) || data.length < 3) continue;
    const from = String(data[1]);
    const claimer = String(data[2]);
    if (claimer === from) continue; // self-vouches are rejected on-chain; belt & braces
    if (claimer === address) {
      backed.add(from);
      if (!firstBacker && from !== address) firstBacker = from;
    } else if (from === address) {
      vouched.add(claimer);
    }
  }
  return { backedBy: backed.size, vouchedFor: vouched.size, firstBacker };
}

/** Pure fold of rewards events into "has this address sent a tip (and to whom first)".
 *  Canonical tipped shape: topics ('tipped', from, to) · data amount (packages/shared). */
export function foldTips(
  events: { topics: unknown[]; data: unknown }[],
  address: string,
): { tipped: boolean; firstRecipient?: string } {
  let tipped = false;
  let firstRecipient: string | undefined;
  for (const { topics } of events) {
    if (topics[0] !== EVENTS.TIPPED || topics.length < 3) continue;
    const from = String(topics[1]);
    if (from !== address) continue;
    if (!tipped) firstRecipient = String(topics[2]);
    tipped = true;
  }
  return { tipped, firstRecipient };
}

// ── Snapshot (RPC events are ephemeral; scores survive the window) ────────────

const SNAPSHOT_KEY = 'alvinmunk.badges.snapshot';

interface BadgeSnapshot {
  backedBy: number;
  vouchedFor: number;
  tipped: boolean;
  firstBacker?: string;
  firstTippedName?: string;
  /** best-known values; a fresh window can only ADD edges, never remove them */
}

function loadSnapshot(): Partial<BadgeSnapshot> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '{}') as Partial<BadgeSnapshot>;
  } catch {
    return {};
  }
}

function saveSnapshot(s: BadgeSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
  } catch {
    // localStorage blocked (private mode) — badges still render from the live window
  }
}

/** Monotone merge: a fresh event window can only add unique edges, never remove. */
export function mergeBadgeSnapshot(
  fresh: { backedBy: number; vouchedFor: number; tipped: boolean; firstBacker?: string; firstTippedName?: string },
  prev: Partial<BadgeSnapshot> = {},
): BadgeSnapshot {
  return {
    backedBy: Math.max(fresh.backedBy, prev.backedBy ?? 0),
    vouchedFor: Math.max(fresh.vouchedFor, prev.vouchedFor ?? 0),
    tipped: fresh.tipped || Boolean(prev.tipped),
    // Prefer whichever name is present; fresh wins if both have one (newest first star).
    firstBacker: fresh.firstBacker ?? prev.firstBacker,
    firstTippedName: fresh.firstTippedName ?? prev.firstTippedName,
  };
}

// ── Name resolution (faces over numbers) ──────────────────────────────────────

/** Reverse-resolve an address to @handle, falling back to GABC…WXYZ. */
async function nameOf(address: string | undefined): Promise<string | undefined> {
  if (!address) return undefined;
  const handle = await reverseHandle(address).catch(() => null);
  return handle ?? shortAddress(address);
}

// ── The one async entry point the UI calls ────────────────────────────────────

/**
 * Gather on-chain state for `address` and compute its badges. Every source fails
 * soft (contract not deployed / RPC down → that signal reads as 0/false) so a
 * badge row NEVER breaks a page. Best-effort resolves the first backer/tippee to
 * @handles; falls back to short addresses.
 */
export async function getBadges(address: string): Promise<Badge[]> {
  const [repEvents, tipEvents] = await Promise.all([
    fetchReputationEvents().catch(() => []),
    fetchRewardsEvents().catch(() => []),
  ]);

  const edges = foldVouchEdges(repEvents, address);
  const tips = foldTips(tipEvents, address);

  // Persist the monotone union so badges survive the ~24h RPC event window.
  const snapshot = mergeBadgeSnapshot(
    {
      backedBy: edges.backedBy,
      vouchedFor: edges.vouchedFor,
      tipped: tips.tipped,
      firstBacker: edges.firstBacker,
      firstTippedName: tips.firstRecipient,
    },
    loadSnapshot(),
  );
  saveSnapshot(snapshot);

  const [profile, streak, firstBackerName, firstTippedName] = await Promise.all([
    getProfile(address).catch(() => ({ social: 0, earned: 0, verified: false })),
    getStreak(address, address).catch(() => ({ weeks: 0, best: 0, lastWeek: 0 })),
    nameOf(snapshot.firstBacker),
    nameOf(snapshot.firstTippedName),
  ]);

  return computeBadges({
    backedBy: snapshot.backedBy,
    vouchedFor: snapshot.vouchedFor,
    isVerified: profile.verified,
    streakBest: streak.best,
    tipped: snapshot.tipped,
    firstBackerName,
    firstTippedName,
  });
}
