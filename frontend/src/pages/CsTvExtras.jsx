import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Monitor, Plus, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   TV amounts (the user, 2026-11-13): amounts added by hand for a CS that the CS
   TV board counts like payments — totals, ranking, latest payments, pop-up and
   voice — and shows like any other. Only the TV: nothing else in the portal
   counts them. Super Admins only (backend functions/csTvExtras.ts).
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.response?.data?.error || e?.data?.error || e?.message || fallback;
const dubaiNow = () => new Date(Date.now() + 4 * 3600e3).toISOString();
const thisMonth = () => dubaiNow().slice(0, 7);
const money = (n) => `AED ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default function CsTvExtras() {
  const qc = useQueryClient();
  const [location, setLocation] = useState('bangalore');
  const [month, setMonth] = useState(thisMonth());
  const [csId, setCsId] = useState('');
  const [aed, setAed] = useState('');
  const [product, setProduct] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [removing, setRemoving] = useState(null);

  const q = useQuery({ queryKey: ['cs-tv-extras', location, month], queryFn: () => fn('getCsTvExtras', { location, month }) });
  const d = q.data;

  const add = useMutation({
    mutationFn: () => fn('addCsTvExtra', {
      cs_id: csId, aed: Number(aed), product: product.trim(),
      at: date ? new Date(`${date}T${time || '12:00'}:00+04:00`).toISOString() : undefined,
    }),
    onSuccess: () => {
      toast.success('Added — on the TV within 20 seconds');
      setAed(''); setDate(''); setTime('');
      qc.invalidateQueries({ queryKey: ['cs-tv-extras'] });
    },
    onError: (e) => toast.error(errorText(e, "That wasn't added")),
  });
  const remove = useMutation({
    mutationFn: (id) => fn('removeCsTvExtra', { id }),
    onSuccess: () => { toast.success('Removed from the TV'); setRemoving(null); qc.invalidateQueries({ queryKey: ['cs-tv-extras'] }); },
    onError: (e) => toast.error(errorText(e, "That wasn't removed")),
  });

  const ready = csId && Number(aed) > 0 && product.trim() && !(time && !date);
  const today = dubaiNow().slice(0, 10);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <PageTitle eyebrow="CS TV" icon={Monitor}>TV amounts</PageTitle>
          <p className="mt-2 text-sm text-slate-500">
            Amounts added here count on the CS TV board like payments: in the CS's month and today, their team, the totals, the ranking and the
            latest payments, with the pop-up and voice. They show on the TV like any other payment, and count nowhere else in the portal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[['bangalore', 'Bangalore'], ['dubai', 'Dubai']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setLocation(k); setCsId(''); }}
              className={cn('rounded-full border px-3 py-1 text-sm', location === k ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white hover:bg-slate-50')}>
              {label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Month
            <Input id="tv-extras-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} className="h-9 w-40" />
          </label>
        </div>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-brand-navy">Add an amount</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700">CS *</span>
                <select id="tv-extras-cs" value={csId} onChange={(e) => setCsId(e.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="">Choose…</option>
                  {(d?.cs || []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.team}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700">Amount (AED) *</span>
                <Input id="tv-extras-aed" type="number" min="1" step="0.01" value={aed} onChange={(e) => setAed(e.target.value)} placeholder="e.g. 5000" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-700">Course *</span>
                <Input id="tv-extras-product" list="tv-extras-products" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. MSNR" />
                <datalist id="tv-extras-products">{(d?.products || []).map((p) => <option key={p} value={p} />)}</datalist>
              </label>
              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-700">When (Dubai time)</span>
                <div className="grid grid-cols-2 gap-2">
                  <Input id="tv-extras-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                  <Input id="tv-extras-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
                </div>
                <p className="mt-1 text-xs text-slate-500">{time && !date ? 'Give the date too.' : 'Leave empty for now — it pops up on the TV.'}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button disabled={!ready || add.isPending} onClick={() => add.mutate()} className="gap-2">
                {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add to the TV
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold text-brand-navy">Added for {location === 'bangalore' ? 'Bangalore' : 'Dubai'} · {month}</p>
              <p className="text-sm tabular-nums text-slate-600">{d ? `${d.extras.length} · ${money(d.total_aed)}` : ''}</p>
            </div>
            {q.isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : q.isError ? (
              <p className="p-6 text-sm text-rose-700">{errorText(q.error, "These couldn't be loaded")}</p>
            ) : !d?.extras.length ? (
              <p className="p-6 text-sm text-slate-500">Nothing added for this month yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-2">CS</th><th className="px-4 py-2">Course</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2">On the TV at</th><th className="px-4 py-2">Added by</th><th className="px-4 py-2" /></tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.extras.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{e.cs_name}</td>
                        <td className="px-4 py-2">{e.product}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{money(e.aed)}</td>
                        <td className="px-4 py-2 text-slate-600">{when(e.at)}</td>
                        <td className="px-4 py-2 text-slate-500">{e.added_by}</td>
                        <td className="px-4 py-2 text-right">
                          {removing === e.id ? (
                            <span className="inline-flex gap-1">
                              <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>Remove</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Keep</Button>
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(e.id)} aria-label={`Remove ${e.cs_name}'s amount`}><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
