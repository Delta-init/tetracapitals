import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, CreditCard, Loader2, MessageCircle, Plus, XCircle } from 'lucide-react';
import { WA_GREEN } from '@/components/whatsapp/waUi';

/* ────────────────────────────────────────────────────────────────────────────
   Payment links on the student page (backend/src/functions/paymentLinks.ts).
   Their CS asks for one — the platform (Tabby, Tamara, SmartInvoice,
   BillXpro), the amount and what it is for; a Super Admin makes the link
   and pastes it in on the Payment Links page. It is emailed to the
   student and shows here, for the CS to copy or send on their WhatsApp. An
   answer the CS who asked hadn't seen is marked New, and seen once shown.
──────────────────────────────────────────────────────────────────────────── */

export const PAYMENT_STATUS = {
  pending: { label: 'Waiting for approval', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: 'Link ready', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Turned down', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
export function PaymentStatusBadge({ status }) {
  const s = PAYMENT_STATUS[status] || PAYMENT_STATUS.cancelled;
  return <Badge variant="outline" className={`whitespace-nowrap ${s.cls}`}>{s.label}</Badge>;
}
/** On an answer (link ready, turned down) the CS who asked sees for the first time. */
export const NewChip = () => (
  <span className="rounded-full bg-brand-mint/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">New</span>
);
/** The server marks answers seen as it shows them (markSeen) — the sidebar's numbers drop. */
export function useAnswersSeen(data) {
  const queryClient = useQueryClient();
  const sawNew = (data?.requests || []).some(r => r.new);
  useEffect(() => { if (sawNew) queryClient.invalidateQueries({ queryKey: ['nav-counts'] }); }, [sawNew, data, queryClient]);
}
/** Where a link is made — the CS picks one when asking; the Super Admin may make it on another (backend PLATFORMS). */
export const PLATFORMS = [
  { key: 'tabby', label: 'Tabby' },
  { key: 'tamara', label: 'Tamara' },
  { key: 'smartinvoice', label: 'SmartInvoice' },
  { key: 'billxpro', label: 'BillXpro' },
];
export const platformLabel = (key) => PLATFORMS.find(p => p.key === key)?.label || '';
/** The platform a request is on: where it was made once a link is in (and what was asked, when that differs). */
export function PlatformChip({ request: r }) {
  const on = r.made_on || r.platform;
  if (!on) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {platformLabel(on)}
      {r.made_on && r.platform && r.made_on !== r.platform && <span className="font-normal text-slate-400">· asked {platformLabel(r.platform)}</span>}
    </span>
  );
}
/** Pick a platform: four buttons, one chosen (none at first when `value` is ''). */
export function PlatformPicker({ value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {PLATFORMS.map(p => (
        <button key={p.key} type="button" disabled={disabled} onClick={() => onChange(p.key)} aria-pressed={value === p.key}
          className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${value === p.key ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
export const money = (currency, amount) => `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const copyLink = async (url) => {
  try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Could not copy — select the link and copy it'); }
};
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

export default function PaymentLinksCard({ student }) {
  const queryClient = useQueryClient();
  const key = ['payment-links', student?.id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await base44.functions.invoke('getPaymentLinks', { studentId: student.id, markSeen: true })).data,
    enabled: !!student?.id,
    // While one waits for a Super Admin, look now and then — the link shows as soon as it is in.
    refetchInterval: (q) => ((q.state.data?.requests || []).some(r => r.status === 'pending') ? 30_000 : false),
  });
  useAnswersSeen(data);
  // The CS's own WhatsApp, to send the link there (shared with the WhatsApp card on this page).
  const { data: wa } = useQuery({
    queryKey: ['student-whatsapp', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: student.id })).data,
    enabled: !!student?.id && !!data?.can_request,
    refetchInterval: 10_000,
  });
  const [asking, setAsking] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['student-history', student?.id] });
  };

  const cancel = useMutation({
    mutationFn: async (id) => (await base44.functions.invoke('cancelPaymentLinkRequest', { id })).data,
    onSuccess: () => { toast.success('Request cancelled'); refresh(); },
    onError: (e) => { toast.error(e?.message || 'Could not cancel it'); refresh(); },
  });
  const waNumber = wa?.numbers?.[0];
  const sendOnWhatsApp = useMutation({
    mutationFn: async (r) => (await base44.functions.invoke('sendWhatsApp', {
      chat: waNumber,
      text: `Hi ${firstName(student.full_name)}, here is your ${[platformLabel(r.made_on), 'payment link'].filter(Boolean).join(' ')} for ${money(r.currency, r.amount)} (${r.description}):\n${r.url}`,
    })).data,
    onSuccess: () => { toast.success('Sent on WhatsApp'); queryClient.invalidateQueries({ queryKey: ['student-whatsapp', student?.id] }); },
    onError: (e) => toast.error(e?.message || 'Not sent on WhatsApp'),
  });

  if (!data) return null;
  const requests = data.requests || [];
  if (!requests.length && !data.can_request) return null;   // nothing to show, and not someone who can ask

  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-emerald-600" />Payment links</span>
          {data.can_request && (
            <Button size="sm" onClick={() => setAsking(true)}><Plus className="h-4 w-4" /> Ask for a link</Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {requests.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No payment links for them yet. Ask for one — a Super Admin adds the link, and it is emailed to them.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {requests.map(r => (
              <li key={r.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-slate-900">{money(r.currency, r.amount)}</span>
                    <PlatformChip request={r} />
                    <span className="text-sm text-slate-600">{r.description}</span>
                    <PaymentStatusBadge status={r.status} />
                    {r.new && <NewChip />}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.status === 'approved' && r.url && (<>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => copyLink(r.url)}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
                      {data.can_request && wa?.can_send && waNumber && (
                        <Button size="sm" variant="outline" className="h-8" title={`To +${waNumber}, from your WhatsApp`}
                          disabled={sendOnWhatsApp.isPending} onClick={() => sendOnWhatsApp.mutate(r)}>
                          {sendOnWhatsApp.isPending && sendOnWhatsApp.variables?.id === r.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <MessageCircle className="h-3.5 w-3.5" style={{ color: WA_GREEN }} />} WhatsApp
                        </Button>
                      )}
                    </>)}
                    {r.status === 'pending' && data.can_approve && (
                      <Button size="sm" variant="outline" className="h-8" asChild>
                        <Link to={createPageUrl('PaymentLinks')}>Add the link</Link>
                      </Button>
                    )}
                    {r.status === 'pending' && r.mine && (
                      <Button size="sm" variant="ghost" className="h-8 text-slate-500" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                        {cancel.isPending && cancel.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {r.status === 'approved' && r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-blue-600 hover:underline">{r.url}</a>
                )}
                <p className="text-xs text-slate-500">
                  Asked by {r.requested_by_name} · {when(r.created_at)}
                  {r.status === 'approved' && ` · link added by ${r.approved_by_name} · ${when(r.approved_at)}`}
                  {r.emailed_to && ` · emailed to ${r.emailed_to}`}
                  {r.status === 'rejected' && ` · turned down by ${r.rejected_by_name} · ${when(r.rejected_at)}`}
                  {r.status === 'cancelled' && ` · cancelled ${when(r.cancelled_at)}`}
                </p>
                {r.note && <p className="text-xs text-slate-500">Note: {r.note}</p>}
                {r.admin_note && <p className="text-xs text-slate-600">{r.approved_by_name}: {r.admin_note}</p>}
                {r.status === 'approved' && r.email_error && (
                  <p className="text-xs text-amber-700">Not emailed — {r.email_error}. Copy the link or send it on WhatsApp.</p>
                )}
                {r.status === 'rejected' && r.reject_reason && <p className="text-xs text-rose-700">{r.reject_reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {asking && <AskDialog student={student} currency={data.currency} onClose={() => setAsking(false)} onDone={refresh} />}
    </Card>
  );
}

function AskDialog({ student, currency, onClose, onDone }) {
  const [platform, setPlatform] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const ask = useMutation({
    mutationFn: async () => (await base44.functions.invoke('requestPaymentLink', { studentId: student.id, platform, amount, description, note })).data,
    onSuccess: () => { toast.success(`Asked — a Super Admin will add the ${platformLabel(platform)} link`); onDone(); onClose(); },
    onError: (e) => toast.error(e?.message || 'Could not send the request'),
  });
  const ready = platform && Number(amount) > 0 && description.trim();

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !ask.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Ask for a payment link for {student.full_name}</DialogTitle>
          <DialogDescription>
            A Super Admin makes the link and adds it. It is then emailed to the student and shows here, for you to copy or send on WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !ask.isPending) ask.mutate(); }}>
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <PlatformPicker value={platform} onChange={setPlatform} disabled={ask.isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-amount">Amount ({currency})</Label>
            <Input id="pl-amount" type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1500" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-for">For</Label>
            <Input id="pl-for" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. DSLP course fee" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-note">Note for the Super Admin (optional)</Label>
            <Textarea id="pl-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Pay in 4, first payment today" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={ask.isPending}>Cancel</Button>
            <Button type="submit" disabled={!ready || ask.isPending}>
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
