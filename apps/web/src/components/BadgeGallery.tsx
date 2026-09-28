'use client';

import { useEffect, useState } from 'react';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { Skeleton } from '@/components/ui/skeleton';
import { getBadges, type Badge } from '@/lib/badges';
import { cn } from '@/lib/utils';

/**
 * BadgeGallery — the milestone row (belts/04: "badge gallery on the profile").
 * Earned badges are full-color stickers; locked ones are greyed out WITH the
 * remaining step ("2 more vouches") — the "almost there" pull toward the next
 * milestone. Badges name people where the story involves one ("lit by @alice").
 * Pure reads of Social/Earned state: no XP, no treasury, no writes.
 */
export function BadgeGallery({ address, className }: { address: string; className?: string }) {
  const [badges, setBadges] = useState<Badge[] | null>(null);

  useEffect(() => {
    let alive = true;
    getBadges(address)
      .then((b) => alive && setBadges(b))
      .catch(() => alive && setBadges([]));
    return () => {
      alive = false;
    };
  }, [address]);

  const earnedCount = badges?.filter((b) => b.earned).length ?? 0;

  return (
    <Frame label="badges // milestones" index={badges ? `${earnedCount}/${badges.length}` : '…'} accent="tertiary" tape="br" className={className}>
      <ul className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6" data-testid="badge-gallery">
        {badges === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex flex-col items-center gap-2 p-2">
                <Skeleton className="size-12" />
                <Skeleton className="h-3 w-14" />
              </li>
            ))
          : badges.map((b) => <BadgeTile key={b.id} badge={b} />)}
      </ul>
    </Frame>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  return (
    <li
      title={badge.earned ? `${badge.name} — ${badge.description}` : `${badge.name} — ${badge.nextStep ?? badge.description}`}
      className={cn(
        'flex flex-col items-center gap-1.5 p-2 text-center transition-opacity',
        !badge.earned && 'opacity-40 grayscale',
      )}
    >
      <Sticker
        name={badge.sticker as 'star-lime'}
        size={48}
        alt={`${badge.name} badge`}
        className={badge.earned ? undefined : 'opacity-70'}
      />
      <p className={cn('text-[11px] font-semibold leading-tight', !badge.earned && 'text-muted-foreground')}>
        {badge.name}
      </p>
      <p className="font-mono text-[9px] uppercase tracking-wider leading-tight text-muted-foreground">
        {badge.earned ? badge.namedBy ? `by @${badge.namedBy}` : badge.description : (badge.nextStep ?? badge.description)}
      </p>
      {!badge.earned && (
        <span className="sr-only">
          Locked: {badge.nextStep ?? badge.description}
        </span>
      )}
    </li>
  );
}
