import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, CreditCard, Loader2, MessageCircle, Plus, XCircle } from 'lucide-react';
import { WA_GREEN } from '@/components/whatsapp/waUi';

/* ────────────────────────────────────────────────────────────────────────────
   Tabby payment links on the student page (backend/src/functions/tabbyLinks.ts).
   Their CS, Super Admin or Admin sends one for an amount: Tabby checks the
   student, then texts them the link — it works for 20 minutes. Every link
   stays listed with where it stands; a waiting one can be copied, sent on
   the CS's WhatsApp, or cancelled.
──────────────────────────────────────────────────────────────────────────── */

const LINK_MINUTES = 20;   // Tabby's session timeout
const STATUS = {
  CREATING: { label: 'Sending…', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
  CREATED: { label: 'Waiting for payment', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  AUTHORIZED: { label: 'Paid', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  CLOSED: { label: 'Paid', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Declined at Tabby', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  EXPIRED: { label: 'Expired', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
  NOT_ELIGIBLE: { label: 'Not eligible', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  ERROR: { label: 'Not sent', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const money = (currency, amount) => `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

export default function TabbyLinksCard({ student }) {
  const queryClient = useQueryClient();
  const key = ['tabby-links', student?.id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await base44.functions.invoke('getTabbyLinks', { studentId: student.id })).data,
    enabled: !!student?.id,
    // While a link can still be paid, keep looking — the CS sees "Paid" during the call.
    refetchInterval: (q) => ((q.state.data?.links || []).some(l => l.status === 'CREATED' || l.status === 'CREATING') ? 10_000 : false),
  });
  // The CS's own WhatsApp, to send the link there too (shared with the WhatsApp card on this page).
  const { data: wa } = useQuery({
    queryKey: ['student-whatsapp', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: student.id })).data,
    enabled: !!student?.id && !!data?.can_create,
    refetchInterval: 10_000,
  });
  const [open, setOpen] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const cancel = useMutation({
    mutationFn: async (id) => (await base44.functions.invoke('cancelTabbyLink', { id })).data,
    onSuccess: (r) => { toast[r.too_late ? 'info' : 'success'](r.too_late ? 'Too late to cancel — see where it stands now' : 'Link cancelled — it no longer works'); refresh(); },
    onError: (e) => toast.error(e?.message || 'Could not cancel it'),
  });
  const sendOnWhatsApp = useMutation({
    mutationFn: async (l) => (await base44.functions.invoke('sendWhatsApp', {
      chat: String(l.phone).replace(/\D/g, ''),
      text: `Hi ${firstName(student.full_name)}, here is your Tabby payment link for ${money(l.currency, l.amount)} (${l.description}):\n${l.url}\nIt works for ${LINK_MINUTES} minutes.`,
    })).data,
    onSuccess: () => { toast.success('Sent on WhatsApp'); queryClient.invalidateQueries({ queryKey: ['student-whatsapp', student?.id] }); },
    onError: (e) => toast.error(e?.message || 'Not sent on WhatsApp'),
  });
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Could not copy — select the link and copy it'); }
  };

  if (!data) return null;
  const links = data.links || [];
  if (!links.length && !data.can_create) return null;   // nothing to show, and not someone who can send one

  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-emerald-600" />Tabby payment links</span>
          {data.can_create && (
            <Button size="sm" onClick={() => setOpen(true)} disabled={!data.configured} title={data.configured ? undefined : "Tabby isn't set up on the server yet"}>
              <Plus className="h-4 w-4" /> New link
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.can_create && !data.configured && (
          <p className="border-b border-gray-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">Tabby isn’t set up on the server yet, so links can’t be sent.</p>
        )}
        {links.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No Tabby links sent to them yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {links.map(l => {
              const s = l.status === 'EXPIRED' && l.cancelled_by_name ? { label: 'Cancelled', cls: STATUS.EXPIRED.cls } : STATUS[l.status] || STATUS.ERROR;
              const waiting = l.status === 'CREATED';
              const until = Date.parse(l.created_at) + LINK_MINUTES * 60_000;
              return (
                <li key={l.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums text-slate-900">{money(l.currency, l.amount)}</span>
                      <span className="text-sm text-slate-600">{l.description}</span>
                      <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                    </div>
                    {waiting && data.can_create && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {l.url && <Button size="sm" variant="outline" className="h-8" onClick={() => copy(l.url)}><Copy className="h-3.5 w-3.5" /> Copy link</Button>}
                        {l.url && wa?.can_send && (
                          <Button size="sm" variant="outline" className="h-8" disabled={sendOnWhatsApp.isPending} onClick={() => sendOnWhatsApp.mutate(l)}>
                            <MessageCircle className="h-3.5 w-3.5" style={{ color: WA_GREEN }} /> WhatsApp
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-8 text-slate-500" disabled={cancel.isPending} onClick={() => cancel.mutate(l.id)}>
                          {cancel.isPending && cancel.variables === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    To {l.phone}{l.sms_sent ? ' by SMS' : ''} · by {l.created_by_name} · {when(l.created_at)}
                    {waiting && ` · works until ${hhmm(until)}`}
                    {l.paid_at && ` · paid ${when(l.paid_at)}`}
                    {l.cancelled_by_name && ` · cancelled by ${l.cancelled_by_name}`}
                    <span className="text-slate-400"> · {l.reference_id}</span>
                  </p>
                  {waiting && !l.sms_sent && (
                    <p className="text-xs text-amber-700">Tabby couldn’t text it{l.sms_error ? ` (${l.sms_error})` : ''} — copy the link or send it on WhatsApp.</p>
                  )}
                  {l.message && <p className="text-xs text-rose-700">{l.message}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {open && <NewLinkDialog student={student} data={data} onClose={() => setOpen(false)} onSent={refresh} />}
    </Card>
  );
}

function NewLinkDialog({ student, data, onClose, onSent }) {
  const numbers = data.numbers || [];
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState(numbers[0] ? `+${numbers[0]}` : '');
  const [email, setEmail] = useState(data.email || '');
  const [lang, setLang] = useState('en');
  const create = useMutation({
    mutationFn: async () => (await base44.functions.invoke('createTabbyLink', { studentId: student.id, amount, description, phone, email, lang })).data,
    onSuccess: ({ link }) => {
      onSent();
      if (link.status === 'CREATED') {
        if (link.sms_sent) toast.success(`Tabby texted the link to ${link.phone}`);
        else toast.warning('The link is ready, but Tabby couldn’t text it — copy it or send it on WhatsApp');
        onClose();
      } else {
        toast.error(link.message || 'Tabby didn’t make a link');
        onClose();
      }
    },
    onError: (e) => toast.error(e?.message || 'Could not make the link'),
  });
  const ready = Number(amount) > 0 && description.trim() && phone.replace(/\D/g, '').length >= 9;

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !create.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">New Tabby link for {student.full_name}</DialogTitle>
          <DialogDescription>
            Tabby checks the student first. If they can pay with Tabby, it texts them the link — it works for {LINK_MINUTES} minutes, so send it while you’re on the call.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !create.isPending) create.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="tabby-amount">Amount ({data.currency})</Label>
            <Input id="tabby-amount" type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1500" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tabby-for">For</Label>
            <Input id="tabby-for" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. DSLP course fee" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tabby-phone">Mobile — the link goes here</Label>
            <Input id="tabby-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 5x xxx xxxx" />
            {numbers.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {numbers.map(n => (
                  <button key={n} type="button" onClick={() => setPhone(`+${n}`)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${phone === `+${n}` ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    +{n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tabby-email">Email (optional)</Label>
              <Input id="tabby-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={lang} onValueChange={(v) => v && setLang(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Create & send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
