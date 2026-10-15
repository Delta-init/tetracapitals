import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown, Loader2, Search, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Add students by group (the user, 2026-10-15) — one dropdown, several ticks:
   every student in the portal, a team's, a CS's. Ticking one adds its students
   (those with an LMS account — the only ones a program can take); unticking it
   takes off the ones only it brought. backend functions/programs.ts
   getProgramAudiences / searchProgramStudents { all | teams | cs, enrolledOnly }.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const bodyOf = (key) => (key === 'all' ? { all: true } : key.startsWith('t:') ? { teams: [key.slice(2)] } : { cs: [key.slice(2)] });

/**
 * selected: the ticked keys ('all', 't:<team>', 'c:<cs>'); onAdd(key, students) and onRemove(key) — the dialog keeps
 * which key brought which student, so unticking takes off only those.
 */
export default function AudiencePicker({ selected, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['program-audiences'], staleTime: 5 * 60_000, retry: false,
    queryFn: () => fn('getProgramAudiences', {}),
  });
  const needle = q.trim().toLowerCase();
  const options = useMemo(() => {
    const out = [];
    if (data) out.push({ key: 'all', label: 'All students in the portal', sub: `${data.all} enrolled`, group: '' });
    for (const t of data?.teams ?? []) out.push({ key: `t:${t.id}`, label: t.name, sub: `${t.count} enrolled${t.location === 'bangalore' ? ' · Bangalore' : ''}`, group: 'Teams' });
    for (const c of data?.cs ?? []) out.push({ key: `c:${c.id}`, label: c.name, sub: `${c.count} enrolled · ${c.team}`, group: 'CSs' });
    return needle ? out.filter(o => o.label.toLowerCase().includes(needle) || o.sub.toLowerCase().includes(needle)) : out;
  }, [data, needle]);

  const toggle = async (o) => {
    if (selected.includes(o.key)) { onRemove(o.key); return; }
    setBusy(o.key);
    try {
      const r = await fn('searchProgramStudents', { q: '', ...bodyOf(o.key), enrolledOnly: true });
      const found = r?.students ?? [];
      onAdd(o.key, found);
      toast.success(found.length ? `${found.length} student${found.length === 1 ? '' : 's'} from ${o.label}` : `${o.label}: no students with an LMS account`);
    } catch (e) {
      toast.error(e?.response?.data?.error || e?.message || "Couldn't add them");
    } finally {
      setBusy('');
    }
  };

  const label = selected.length ? `${selected.length} group${selected.length === 1 ? '' : 's'} picked` : 'Add students by group — all, a team, a CS…';
  let lastGroup = null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="flex items-center gap-2 truncate"><Users className="h-4 w-4 text-gray-500" />{label}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="relative border-b p-2">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a team or CS…" className="h-8 pl-8" />
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {isLoading && <p className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Loading…</p>}
          {error && <p className="px-3 py-2 text-xs text-amber-700">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This needs the server update (the API deploy).' : error.message}</p>}
          {options.map(o => {
            const head = o.group !== lastGroup && o.group ? o.group : null;
            lastGroup = o.group;
            const on = selected.includes(o.key);
            return (
              <div key={o.key}>
                {head && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{head}</p>}
                <button type="button" disabled={!!busy} onClick={() => toggle(o)}
                  className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-60', on && 'bg-blue-50')}>
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300')}>
                    {busy === o.key ? <Loader2 className="h-3 w-3 animate-spin text-gray-500" /> : on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-xs text-gray-400">{o.sub}</span>
                </button>
              </div>
            );
          })}
          {!isLoading && !error && !options.length && <p className="px-3 py-2 text-xs text-gray-500">Nothing matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
