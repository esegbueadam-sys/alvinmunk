import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EVENTS } from '@alvinmunk/shared';
import {
  computeBadges,
  earnedBadges,
  foldVouchEdges,
  foldTips,
  mergeBadgeSnapshot,
  THRESHOLDS,
  type BadgeInput,
} from './badges';

// ── computeBadges — pure, per-threshold ───────────────────────────────────────

const EMPTY: BadgeInput = {
  backedBy: 0,
  vouchedFor: 0,
  isVerified: false,
  streakBest: 0,
  tipped: false,
};

describe('computeBadges', () => {
  it('gives a fresh wallet six locked badges with next steps', () => {
    const badges = computeBadges(EMPTY);
    expect(badges.map((b) => b.id)).toEqual([
      'first-star',
      'connector',
      'constellation',
      'verified',
      'four-weeks',
      'generous',
    ]);
    for (const b of badges) {
      expect(b.earned).toBe(false);
      expect(b.nextStep).toBeTruthy();
    }
  });

  it('is deterministic (pure): same input, same output', () => {
    const a = computeBadges({ ...EMPTY, backedBy: 3 });
    const b = computeBadges({ ...EMPTY, backedBy: 3 });
    expect(a).toEqual(b);
  });

  it('locks everything at threshold-1 (except First Star, already earned by then)', () => {
    const badges = computeBadges({
      backedBy: THRESHOLDS.CONSTELLATION_VOUCHED_BY - 1,
      vouchedFor: THRESHOLDS.CONNECTOR_BACKED - 1,
      isVerified: false,
      streakBest: THRESHOLDS.FOUR_WEEKS_STREAK - 1,
      tipped: false,
    });
    // First Star unlocked long ago (backedBy ≥ 1); every other badge still locked.
    expect(badges.find((b) => b.id === 'first-star')!.earned).toBe(true);
    const rest = badges.filter((b) => b.id !== 'first-star');
    expect(rest.every((b) => !b.earned)).toBe(true);
    // Remaining steps count down correctly (faces over numbers, but numbers still honest)
    const connector = badges.find((b) => b.id === 'connector')!;
    expect(connector.nextStep).toBe('1 more vouch');
    const four = badges.find((b) => b.id === 'four-weeks')!;
    expect(four.nextStep).toBe('1 more week');
  });

  it('awards First Star on the first vouch received and NAMES the backer', () => {
    const badges = computeBadges({ ...EMPTY, backedBy: 1, firstBackerName: 'alice' });
    const first = badges.find((b) => b.id === 'first-star')!;
    expect(first.earned).toBe(true);
    expect(first.namedBy).toBe('alice');
    expect(first.description).toContain('@alice');
  });

  it('awards Connector at vouchedFor = 5 with the milestone copy', () => {
    const at4 = computeBadges({ ...EMPTY, vouchedFor: 4 }).find((b) => b.id === 'connector')!;
    const at5 = computeBadges({ ...EMPTY, vouchedFor: 5 }).find((b) => b.id === 'connector')!;
    expect(at4.earned).toBe(false);
    expect(at4.nextStep).toBe('1 more vouch');
    expect(at5.earned).toBe(true);
    expect(at5.description).toBe('vouched for 5 people');
    // Past the threshold there is no next step.
    expect(computeBadges({ ...EMPTY, vouchedFor: 9 }).find((b) => b.id === 'connector')!.nextStep).toBeUndefined();
  });

  it('awards Constellation at backedBy = 10', () => {
    const at9 = computeBadges({ ...EMPTY, backedBy: 9 }).find((b) => b.id === 'constellation')!;
    const at10 = computeBadges({ ...EMPTY, backedBy: 10 }).find((b) => b.id === 'constellation')!;
    expect(at9.earned).toBe(false);
    expect(at9.nextStep).toBe('1 more vouch');
    expect(at10.earned).toBe(true);
    expect(at10.description).toBe('vouched by 10 people');
  });

  it('awards Verified only from the Earned (verified) track', () => {
    // High Social XP is irrelevant — the two-track split (belts/08) holds.
    const social = computeBadges({ ...EMPTY, backedBy: 20, vouchedFor: 20 });
    expect(social.find((b) => b.id === 'verified')!.earned).toBe(false);
    const verified = computeBadges({ ...EMPTY, isVerified: true }).find(
      (b) => b.id === 'verified',
    )!;
    expect(verified.earned).toBe(true);
  });

  it('awards Four Weeks at streakBest = 4', () => {
    const at3 = computeBadges({ ...EMPTY, streakBest: 3 }).find((b) => b.id === 'four-weeks')!;
    const at4 = computeBadges({ ...EMPTY, streakBest: 4 }).find((b) => b.id === 'four-weeks')!;
    expect(at3.earned).toBe(false);
    expect(at4.earned).toBe(true);
  });

  it('awards Generous on the first tip SENT and names the recipient', () => {
    const locked = computeBadges(EMPTY).find((b) => b.id === 'generous')!;
    expect(locked.earned).toBe(false);
    const tipped = computeBadges({ ...EMPTY, tipped: true, firstTippedName: 'bob' }).find(
      (b) => b.id === 'generous',
    )!;
    expect(tipped.earned).toBe(true);
    expect(tipped.description).toBe('first tip — to @bob');
  });

  it('earnedBadges filters to earned only, in catalog order', () => {
    const badges = computeBadges({ ...EMPTY, backedBy: 1, tipped: true });
    expect(earnedBadges(badges).map((b) => b.id)).toEqual(['first-star', 'generous']);
  });
});

// ── Event folds — pure ────────────────────────────────────────────────────────

const claimed = (from: string, claimer: string) => ({
  topics: [EVENTS.VOUCH, 'claimed'],
  data: [1, from, claimer],
});

describe('foldVouchEdges', () => {
  it('counts unique inbound and outbound edges separately', () => {
    const events = [
      claimed('A', 'ME'),
      claimed('B', 'ME'),
      claimed('A', 'ME'), // duplicate edge — counted once
      claimed('ME', 'C'),
      claimed('ME', 'C'), // duplicate — counted once
      claimed('ME', 'D'),
    ];
    expect(foldVouchEdges(events, 'ME')).toEqual({
      backedBy: 2,
      vouchedFor: 2,
      firstBacker: 'A',
    });
  });

  it('ignores other events and malformed payloads', () => {
    const events = [
      { topics: [EVENTS.SOCIAL, 'ME'], data: [5, 50] }, // social xp event
      { topics: [EVENTS.VOUCH, 'minted'], data: [2, 'A', 'ME'] }, // unclaimed mint
      { topics: [EVENTS.VOUCH, 'claimed'], data: 'junk' }, // malformed
      claimed('A', 'ME'),
    ];
    expect(foldVouchEdges(events, 'ME')).toEqual({ backedBy: 1, vouchedFor: 0, firstBacker: 'A' });
  });

  it('ignores self-vouch edges defensively', () => {
    const events = [claimed('ME', 'ME')];
    expect(foldVouchEdges(events, 'ME')).toEqual({ backedBy: 0, vouchedFor: 0, firstBacker: undefined });
  });

  it('keeps the OLDEST backer as firstBacker (events are oldest-first)', () => {
    const events = [claimed('A', 'ME'), claimed('B', 'ME'), claimed('C', 'ME')];
    expect(foldVouchEdges(events, 'ME').firstBacker).toBe('A');
  });
});

describe('foldTips', () => {
  // Canonical tipped shape: topics ('tipped', from, to) · data amount (packages/shared).
  const tipped = (from: string, to: string) => ({
    topics: [EVENTS.TIPPED, from, to],
    data: 1_000_000,
  });

  it('detects a tip sent and keeps the first recipient', () => {
    const events = [tipped('ME', 'B'), tipped('ME', 'C'), tipped('A', 'ME')];
    expect(foldTips(events, 'ME')).toEqual({ tipped: true, firstRecipient: 'B' });
  });

  it('reports no tip when the address only RECEIVED tips', () => {
    const events = [tipped('A', 'ME')];
    expect(foldTips(events, 'ME')).toEqual({ tipped: false, firstRecipient: undefined });
  });

  it('ignores non-tip events', () => {
    const events = [{ topics: [EVENTS.SOCIAL, 'ME'], data: [1, 2] }];
    expect(foldTips(events, 'ME').tipped).toBe(false);
  });
});

// ── Snapshot merge (monotone across the ~24h RPC event window) ────────────────

describe('mergeBadgeSnapshot', () => {
  it('keeps the max of each count (edges can only be added)', () => {
    expect(
      mergeBadgeSnapshot({ backedBy: 3, vouchedFor: 1, tipped: false }, { backedBy: 5, vouchedFor: 0 }),
    ).toMatchObject({ backedBy: 5, vouchedFor: 1 });
  });

  it('sticky-flags tips and preserves known names', () => {
    expect(
      mergeBadgeSnapshot(
        { backedBy: 0, vouchedFor: 0, tipped: false },
        { tipped: true, firstBacker: 'alice', firstTippedName: 'bob' },
      ),
    ).toMatchObject({ tipped: true, firstBacker: 'alice', firstTippedName: 'bob' });
  });

  it('prefers the fresh firstBacker when both windows saw one', () => {
    expect(
      mergeBadgeSnapshot(
        { backedBy: 1, vouchedFor: 0, tipped: false, firstBacker: 'carol' },
        { firstBacker: 'alice' },
      ).firstBacker,
    ).toBe('carol');
  });
});

// ── getBadges end-to-end (mocked RPC + contract reads) ────────────────────────

vi.mock('./events', () => ({
  fetchReputationEvents: vi.fn(async () => []),
  fetchRewardsEvents: vi.fn(async () => []),
}));

vi.mock('./reputation', () => ({
  getProfile: vi.fn(async () => ({ social: 0, earned: 0, verified: false })),
}));

vi.mock('./quests', () => ({
  getStreak: vi.fn(async () => ({ weeks: 0, best: 0, lastWeek: 0 })),
}));

vi.mock('./registry', () => ({
  reverseHandle: vi.fn(async () => null),
}));

import { getBadges } from './badges';
import { fetchReputationEvents, fetchRewardsEvents } from './events';
import { getProfile } from './reputation';
import { getStreak } from './quests';
import { reverseHandle } from './registry';

describe('getBadges', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchReputationEvents).mockResolvedValue([]);
    vi.mocked(fetchRewardsEvents).mockResolvedValue([]);
    vi.mocked(getProfile).mockResolvedValue({ social: 0, earned: 0, verified: false });
    vi.mocked(getStreak).mockResolvedValue({ weeks: 0, best: 0, lastWeek: 0 });
    vi.mocked(reverseHandle).mockResolvedValue(null);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('folds events + on-chain reads into badges and resolves @handles', async () => {
    vi.mocked(fetchReputationEvents).mockResolvedValue([
      claimed('GBACKER'.padEnd(56, 'A'), 'ME'),
    ]);
    vi.mocked(getProfile).mockResolvedValue({ social: 30, earned: 10, verified: true });
    vi.mocked(reverseHandle).mockResolvedValue('alice');

    const badges = await getBadges('ME');
    const first = badges.find((b) => b.id === 'first-star')!;
    const verified = badges.find((b) => b.id === 'verified')!;

    expect(first.earned).toBe(true);
    expect(first.namedBy).toBe('alice');
    expect(verified.earned).toBe(true);
  });

  it('survives the RPC event window via the localStorage snapshot', async () => {
    vi.mocked(fetchReputationEvents).mockResolvedValue([claimed('A', 'ME'), claimed('B', 'ME')]);
    await getBadges('ME'); // first pass persists the snapshot

    // Later: the event window rolled over and returns nothing.
    vi.mocked(fetchReputationEvents).mockResolvedValue([]);
    const badges = await getBadges('ME');
    expect(badges.find((b) => b.id === 'first-star')!.earned).toBe(true);
  });

  it('degrades to all-locked badges when every source fails', async () => {
    vi.mocked(fetchReputationEvents).mockRejectedValue(new Error('rpc down'));
    vi.mocked(fetchRewardsEvents).mockRejectedValue(new Error('rpc down'));
    vi.mocked(getProfile).mockRejectedValue(new Error('not deployed'));
    vi.mocked(getStreak).mockRejectedValue(new Error('not deployed'));
    vi.mocked(reverseHandle).mockRejectedValue(new Error('not deployed'));

    const badges = await getBadges('ME');
    expect(badges).toHaveLength(6);
    expect(badges.every((b) => !b.earned)).toBe(true);
  });
});
