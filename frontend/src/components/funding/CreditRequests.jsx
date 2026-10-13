import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Loader2, Paperclip, Search, Send, Upload } from 'lucide-react';
import { Mt5LoginField, MT5_LOGIN, mt5LoginOf } from '@/components/students/mt5Accounts';

/* ────────────────────────────────────────────────────────────────────────────
   Bonus not credited (the user, 2026-10-13; backend functions/creditRequests.ts):
   a CS, CS Manager or Super Admin tells the broker admins a student's bonus is
   still not in their MT5 — the MT5 login, the amount, the bonus request it is
   (when one was raised) and what is missing. Answered on the Not Credited Yet
   page. A CS only for their own students (the server checks).
──────────────────────────────────────────────────────────────────────────── */

export const RAISERS = ['cs', 'cs_manager', 'super_admin', 'admin'];
const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const why = (e) => (/unknown function|not found|404/i.test(String(e?.message)) ? 'This needs the server update (the API deploy)' : e?.message);

/** Pick a student by name, email or code — a CS only sees their own here. */
function StudentPicker({ currentUser, onPick }) {
  const [q, setQ] = useState('');
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['credit-request-student-search', q],
    queryFn: async () => (await base44.functions.invoke('searchStudents', { q })).data || [],
    enabled: q.trim().length >= 2,
  });
  const mine = currentUser?.app_role === 'cs' ? found.filter(s => s.primary_mentor_id === currentUser.id) : found;
  return (
    <div className="space-y-2">
      <Label>Student *</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or STU code…" className="pl-9" autoFocus />
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {isFetching && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
        {!isFetching && q.trim().length >= 2 && !mine.length && <p className="py-3 text-center text-sm text-gray-500">{currentUser?.app_role === 'cs' ? 'None of your students match.' : 'No student found.'}</p>}
        {mine.map(s => (
          <button key={s.id} type="button" onClick={() => onPick(s)}
            className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-blue-300 hover:bg-blue-50/40">
            <span className="font-medium text-gray-900">{s.full_name}</span>
            <span className="block text-xs text-gray-500">{[s.student_code, s.email, s.primary_mentor_name].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Raise "bonus not credited" — `student` ({ id, full_name, student_code }) given, or picked here. */
export function RaiseCreditRequestDialog({ student: given = null, currentUser, onClose }) {
  const qc = useQueryClient();
  const [student, setStudent] = useState(given);
  const [mt5, setMt5] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [txId, setTxId] = useState('none');
  const [note, setNote] = useState('');
  const [shot, setShot] = useState(null);   // { url, name } | { uploading } | { error }
  const [busy, setBusy] = useState(false);
  const { data: opts, isLoading, error } = useQuery({
    queryKey: ['credit-request-options', student?.id],
    queryFn: async () => (await base44.functions.invoke('getCreditRequestOptions', { studentId: student.id })).data,
    enabled: !!student?.id,
    retry: false,
  });
  const bonuses = opts?.bonuses || [];
  const pickTx = (id) => {
    setTxId(id);
    const t = bonuses.find(b => b.id === id);
    if (t) {
      if (!amount) { setAmount(String(t.amount_usd || '')); setCurrency('USD'); }
      if (!mt5 && t.mt5_login) setMt5(t.mt5_login);
    }
  };
  const openAlready = (opts?.open || []).some(o => (txId !== 'none' ? o.funding_tx_id === txId : !o.funding_tx_id && o.mt5_login === mt5LoginOf(mt5)));
  const upload = async (file) => {
    if (!file) return;
    setShot({ uploading: true });
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      setShot({ url: res.file_url, name: res.name || file.name });
    } catch (e) {
      setShot({ error: e?.message || 'Could not upload that file' });
    }
  };
  const ok = student && MT5_LOGIN.test(mt5LoginOf(mt5)) && Number(amount) > 0 && note.trim().length >= 5 && !shot?.uploading && !openAlready;
  const send = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke('raiseCreditRequest', {
        studentId: student.id, mt5Login: mt5LoginOf(mt5), amount: Number(amount), currency,
        fundingTxId: txId === 'none' ? '' : txId, note: note.trim(), ...(shot?.url ? { screenshot: { url: shot.url, name: shot.name } } : {}),
      });
      toast.success('Sent to the broker admins — you will be told when they answer');
      ['credit-requests', 'nav-counts', 'credit-request-options'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) {
      toast.error(why(e) || "Couldn't send it");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Bonus not credited</DialogTitle>
          <DialogDescription>Tell the broker admins a bonus is still not in the student's MT5. They credit it, or say it was already credited — you are told either way.</DialogDescription>
        </DialogHeader>
        {!student ? <StudentPicker currentUser={currentUser} onPick={setStudent} /> : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <div><div className="font-medium text-slate-900">{student.full_name}</div><div className="text-xs text-slate-500">{student.student_code}</div></div>
              {!given && <Button variant="ghost" size="sm" onClick={() => { setStudent(null); setTxId('none'); }}>Change</Button>}
            </div>
            {isLoading ? <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Their bonus requests…</div>
              : error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">{why(error)}</p> : (
              <>
                <div className="space-y-2">
                  <Label>Which bonus</Label>
                  <Select value={txId} onValueChange={(v) => v && pickTx(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No request raised for it / not listed</SelectItem>
                      {bonuses.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {day(b.requested_at)} · {usd(b.amount_usd)} · {b.status.toLowerCase()}{b.course ? ` · ${b.course}` : ''}{b.bonus_credit === 'sales_close' ? ' · sales close' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {txId !== 'none' && (() => { const t = bonuses.find(b => b.id === txId); return t ? <p className="text-xs text-slate-500">Raised by {t.requested_by_name || '—'}{t.transaction_id ? ` · transaction ${t.transaction_id}` : ''}{t.status === 'PENDING' ? (t.with_finance ? ' · still with finance' : ' · waiting on MT5 Approvals — answered here, it is approved too') : ''}</p> : null; })()}
                </div>
                <Mt5LoginField studentId={student.id} value={mt5} onChange={setMt5} id="credit-mt5" label="MT5 login *" newNote="saved to their page" />
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <div className="space-y-2"><Label>Bonus amount *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Currency</Label>
                    <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="AED">AED</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>What is missing *</Label>
                  <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved on 7 Oct but the student says the $500 is not in MT5 922253" />
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                  {shot?.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : shot?.url ? <Paperclip className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                  {shot?.uploading ? 'Uploading…' : shot?.url ? `${shot.name || 'Screenshot'} — replace` : 'Attach a screenshot (optional)'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                {shot?.error && <p className="text-xs text-rose-600">{shot.error}</p>}
                {openAlready && <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> There is an open request for this already — it is with the broker admins.</p>}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={send} disabled={!ok || busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send to broker admins</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Bonus not credited?" — on the student's page, for the people who may raise it. */
export function RaiseCreditRequestButton({ student, currentUser, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!student?.id || !RAISERS.includes(currentUser?.app_role)) return null;
  return (
    <>
      <Button size="sm" variant="outline" className={`h-7 gap-1 px-2 text-xs ${className}`} onClick={() => setOpen(true)}>
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Bonus not credited?
      </Button>
      {open && <RaiseCreditRequestDialog student={student} currentUser={currentUser} onClose={() => setOpen(false)} />}
    </>
  );
}
