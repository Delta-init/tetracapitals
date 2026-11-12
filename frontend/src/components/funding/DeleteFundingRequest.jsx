import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/* Deleting a pending or rejected funding request (the user, 2026-11-12): its CS, a CS Manager or a Super Admin, with a
   reason. One still with Delta Finance comes off there first; the server decides who may (finance/fundingDelete.ts). */
export const FUNDING_DELETERS = ['super_admin', 'cs_manager', 'cs'];

export const mayDeleteFunding = (tx, role) =>
  FUNDING_DELETERS.includes(role) && ['PENDING', 'REJECTED'].includes(tx?.status) && tx?.finance_approval?.state !== 'removing';

export function DeleteFundingButton({ tx, role, label = false }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: async () => (await base44.functions.invoke('deleteFundingRequest', { id: tx.id, reason: reason.trim() })).data,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['funding-transactions'] });
      toast.success(r?.finance === 'removed' ? 'Deleted — and taken off Delta Finance'
        : r?.finance === 'queued' ? 'Deleted — Delta Finance takes its copy off too' : 'Deleted');
      setOpen(false);
      setReason('');
    },
    onError: (e) => toast.error(e?.message || 'Could not delete it'),
  });
  if (!mayDeleteFunding(tx, role)) return null;
  const withFinance = tx.status === 'PENDING' && ['sent', 'queued'].includes(tx.finance_approval?.state);
  const amount = `$${Number(tx.amount_usd || 0).toLocaleString('en-US')}`;
  return (
    <>
      <Button size="sm" variant="ghost" title="Delete this request"
        className={label ? 'mt-1 h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700' : 'h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700'}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Trash2 className={label ? 'mr-1 h-3.5 w-3.5' : 'h-4 w-4'} />{label ? 'Delete' : null}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!del.isPending) setOpen(o); }}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete this request?</DialogTitle>
            <DialogDescription>
              {tx.student_name || tx.student_code} · {String(tx.type || '').toLowerCase()} {amount} · {String(tx.status).toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {withFinance && <p className="rounded-md bg-sky-50 px-3 py-2 text-sky-800">It is with Delta Finance — it comes off there too.</p>}
            {tx.status === 'REJECTED' && tx.finance_approval?.state === 'decided' && <p className="rounded-md bg-sky-50 px-3 py-2 text-sky-800">Delta Finance's copy is taken off too.</p>}
            <label className="block font-medium text-slate-700" htmlFor={`del-${tx.id}`}>Why is it deleted?</label>
            <Textarea id={`del-${tx.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. raised twice by mistake" />
            <p className="text-xs text-slate-500">It goes off the lists. The whole request is kept, with your name and the reason, on the student's history.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={del.isPending}>Keep it</Button>
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending || reason.trim().length < 3}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
