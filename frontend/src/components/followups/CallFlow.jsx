import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Phone, PhoneOff, Plus } from 'lucide-react';
import { LogFollowupDialog, NewFollowupDialog, StageBadge, StatusBadge, fmtDate } from './followupUi';
import { dialInfo } from './phone';

/* ────────────────────────────────────────────────────────────────────────────
   Call, then log. Every Call button dials through 3CX (tel: link, handled by
   the 3CX desktop app) and then opens the right place to record the call:
     - a follow-up row → its Log dialog;
     - a student → their one open follow-up's Log dialog; a picker when they
       have several; "New follow-up" (then Log) when they have none.
   Only for people who may log for that student (their mentor, Super Admin /
   Admin) — anyone else just dials. One set of dialogs for the whole app,
   mounted by Layout.
──────────────────────────────────────────────────────────────────────────── */

const CallFlowContext = createContext(null);
export const useCallFlow = () => useContext(CallFlowContext);

const isOpen = (f) => f.followup_status !== 'Closed' && f.stage !== 'Converted' && f.stage !== 'Lost';

export function CallFlowProvider({ children }) {
  const queryClient = useQueryClient();
  const [logging, setLogging] = useState(null);     // follow-up being logged
  const [choosing, setChoosing] = useState(null);   // { student, followups }
  const [creating, setCreating] = useState(null);   // { student, afterCall }

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['followups'] }), [queryClient]);

  const openLog = useCallback((followup) => setLogging(followup), []);

  /** After a Call button dialled: find where to record the call. */
  const startCall = useCallback(async (student, followup = null) => {
    if (!student?.id) return;
    if (followup && followup.can_edit && isOpen(followup)) {
      setLogging({ ...followup, phone: followup.phone || student.phone });
      return;
    }
    try {
      const data = (await base44.functions.invoke('getFollowups', { studentId: student.id })).data;
      const open = (data?.followups || []).filter(f => f.can_edit && isOpen(f));
      const withPhone = (f) => ({ ...f, phone: f.phone || student.phone });
      if (open.length === 1) setLogging(withPhone(open[0]));
      else if (open.length > 1) setChoosing({ student, followups: open.map(withPhone), canCreate: !!data?.can_create });
      else if (data?.can_create) setCreating({ student, afterCall: true });
      else toast.info(`Calling ${student.full_name || 'the student'} with 3CX`);
    } catch {
      // Dialling already happened; not being able to open the log is not worth an error.
    }
  }, []);

  const value = useMemo(() => ({ startCall, openLog }), [startCall, openLog]);

  return (
    <CallFlowContext.Provider value={value}>
      {children}

      <LogFollowupDialog followup={logging} onClose={() => setLogging(null)} onSaved={refresh} />

      <Dialog open={!!choosing} onOpenChange={(o) => { if (!o) setChoosing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-brand-navy">Log the call · {choosing?.student?.full_name}</DialogTitle>
            <DialogDescription>Which follow-up was this call about?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(choosing?.followups || []).map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setChoosing(null); setLogging(f); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-brand-cyan/60 hover:bg-cyan-50/40"
              >
                <span>
                  <span className="block font-medium text-slate-900">{f.target_outcome}</span>
                  <span className="text-xs text-slate-500">Next follow-up {fmtDate(f.next_followup_date)}</span>
                </span>
                <span className="flex items-center gap-1.5"><StageBadge stage={f.stage} /><StatusBadge status={f.followup_status} /></span>
              </button>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setChoosing(null)}>Skip</Button>
            {choosing?.canCreate && (
              <Button variant="outline" onClick={() => { const s = choosing.student; setChoosing(null); setCreating({ student: s, afterCall: true }); }}>
                <Plus className="h-4 w-4" /> New follow-up instead
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewFollowupDialog
        open={!!creating}
        onClose={() => setCreating(null)}
        student={creating?.student ? { id: creating.student.id, full_name: creating.student.full_name } : null}
        title={creating?.afterCall ? `Log the call · ${creating.student.full_name}` : null}
        description={creating?.afterCall ? 'No open follow-up for this student yet — open one for this call, then record what they said.' : null}
        onSaved={(id, input) => {
          refresh();
          const s = creating?.student;
          if (creating?.afterCall && id && s) {
            // Straight on to logging the call against the new follow-up.
            setLogging({
              id, student_id: s.id, student_name: s.full_name, phone: s.phone, target_outcome: input.targetOutcome,
              stage: 'New', client_said: input.clientSaid || '', notes: input.notes || '', objection_reason: '',
              converted_date: '', deal_value: null, can_edit: true,
            });
          }
        }}
      />
    </CallFlowContext.Provider>
  );
}

/**
 * The green Call button (3CX). `student` needs { id, full_name, phone };
 * pass `followup` on a follow-up row so the call is logged against it.
 * variant: "button" (Call label) or "icon".
 */
export function CallButton({ student, followup = null, variant = 'button', className = '' }) {
  const flow = useCallFlow();
  const info = dialInfo(student?.phone ?? followup?.phone);
  const size = variant === 'icon' ? 'h-8 w-8 justify-center' : 'h-8 gap-1.5 px-3';

  if (!info.ok) {
    return (
      <span
        title={info.reason}
        className={`inline-flex flex-shrink-0 cursor-not-allowed items-center rounded-lg border border-slate-200 text-xs font-semibold text-slate-300 ${size} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <PhoneOff className="h-3.5 w-3.5" />{variant !== 'icon' && 'Call'}
      </span>
    );
  }
  return (
    <a
      href={`tel:${info.dial}`}
      title={`Call ${info.dial} with 3CX${info.note ? ` — ${info.note}` : ''}`}
      onClick={(e) => { e.stopPropagation(); flow?.startCall(student || { id: followup?.student_id, full_name: followup?.student_name, phone: followup?.phone }, followup); }}
      className={`inline-flex flex-shrink-0 items-center rounded-lg text-xs font-semibold transition-colors ${variant === 'icon'
        ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
        : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'} ${info.check ? 'ring-1 ring-amber-300' : ''} ${size} ${className}`}
    >
      <Phone className="h-3.5 w-3.5" />{variant !== 'icon' && 'Call'}
    </a>
  );
}
