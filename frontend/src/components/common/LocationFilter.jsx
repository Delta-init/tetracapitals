import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { LOCATIONS, locationByUser } from '@/components/utils/teams';

/* Dubai / Bangalore on the commission pages (2026-10-10): each person counts for the location of the team they are on
   (components/utils/teams.js locationByUser); a pool for its Chief's. */

/** userId → 'dubai' | 'bangalore', for whoever may see everyone's figures. */
export function useUserLocations(enabled = true) {
  const { data: users = [] } = useQuery({ queryKey: ['users-locations'], queryFn: () => base44.entities.User.list(), enabled, staleTime: 5 * 60_000 });
  return useMemo(() => locationByUser(users), [users]);
}

/** Whether someone (by id) belongs to the picked location; 'all' lets everyone through. */
export const inLocation = (locOf, loc, userId) => loc === 'all' || locOf[userId] === loc;

/** "Bangalore" beside a team or a student — nothing for Dubai, which every one was before (2026-10-10). */
export function BangaloreBadge({ location, className = '' }) {
  if (location !== 'bangalore') return null;
  return (
    <span title="Bangalore academy" className={`inline-block whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-amber-800 ${className}`}>Bangalore</span>
  );
}

export function LocationFilter({ value, onChange, className = '' }) {
  return (
    <div className={`flex rounded-md border bg-white p-0.5 text-xs ${className}`} role="group" aria-label="Location">
      {[{ value: 'all', label: 'All locations' }, ...LOCATIONS].map(l => (
        <button key={l.value} type="button" onClick={() => onChange(l.value)}
          className={`rounded px-2.5 py-1.5 font-medium ${value === l.value ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l.label}</button>
      ))}
    </div>
  );
}
