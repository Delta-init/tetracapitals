import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { STAGE_LABEL, FOLLOW_UP_LABEL } from './meetingStage';

/* After a student meeting booked here is over, its mentor says how it went (the user, 2026-10-27: "a popup form … it
   closes only after it is filled"; backend students/meetingOutcomes.ts). On every page: the signed-in person's
   meetings waiting (the LMS knows them by this email — nobody else has any), oldest first, one at a time — no close,
   no click-away, no Escape; only Save takes one off. The same meeting may be filled in the LMS: the first counts, and
   this one then drops out. */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const selectCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';
const inputCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';
const tz = 'Asia/Dubai';
const when = (m) => {
  const d = new Date(m.startsAt);
  const t = (x) => new Date(x).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `${d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })} · ${t(m.startsAt)}–${t(m.endsAt)}`;
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const empty = { stage: '', remark: '' };

export default function MeetingOutcomeGate() {
  const queryClient = useQueryClient();
  const pending = useQuery({
    queryKey: ['meeting-outcomes-pending'],
    queryFn: () => fn('getPendingMeetingOutcomes', {}),
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const meetings = pending.data?.meetings ?? [];
  const meeting = meetings[0];
  const options = useQuery({
    queryKey: ['meeting-outcome-options'],
    queryFn: () => fn('getMeetingOutcomeOptions', {}),
    enabled: !!meeting,
    staleTime: 10 * 60_000,
  });
  const [form, setForm] = useState(empty);
  const [problem, setProblem] = useState('');
  // A fresh form for each meeting.
  useEffect(() => { setForm(empty); setProblem(''); }, [meeting?.id]);
  const course = useMemo(() => options.data?.courses?.find(c => c.id === form.courseId), [options.data, form.courseId]);
  const set = (patch) => { setForm(f => ({ ...f, ...patch })); setProblem(''); };

  const save = useMutation({
    mutationFn: (body) => fn('saveMeetingOutcome', body),
    onSuccess: () => {
      toast.success('Outcome saved — it is on the student and their CS has been told');
      queryClient.invalidateQueries({ queryKey: ['meeting-outcomes-pending'] });
      queryClient.invalidateQueries({ queryKey: ['student-meeting-outcomes'] });
    },
    onError: (e) => {
      // Filled already (in the LMS) or no longer this mentor's: it drops out on the refetch.
      if (e?.status === 409 && /already filled|cancelled/i.test(e?.message ?? '')) {
        toast.info(e.message);
        queryClient.invalidateQueries({ queryKey: ['meeting-outcomes-pending'] });
      } else setProblem(e?.message || 'Could not save');
    },
  });

  if (!meeting) return null;

  const missing = () => {
    if (!form.stage) return 'Pick where the client stands';
    if (form.stage === 'interested' && (!form.courseId || !form.paymentDate || !form.paymentMode)) return 'Pick the course, the payment date and how they will pay';
    if (form.stage === 'follow_up' && (!form.followUpKind || !form.followUpDate)) return 'Pick the follow-up and its date';
    if (form.stage === 'meeting_with' && !form.withMentorEmail) return 'Pick the mentor they will meet';
    if (form.stage === 'revision' && !form.courseId) return 'Pick the course to revise';
    if (form.stage === 'not_interested' && !form.reason) return 'Pick why they are not interested';
    if (!form.remark.trim()) return 'Write a remark';
    return '';
  };
  const submit = () => {
    const why = missing();
    if (why) { setProblem(why); return; }
    save.mutate({ meetingId: meeting.id, ...form });
  };
  const o = options.data;
  const stages = o?.stages ?? Object.keys(STAGE_LABEL);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="meeting-outcome-title">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><ClipboardCheck className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 id="meeting-outcome-title" className="text-base font-semibold text-slate-900">How did the meeting go?</h2>
            <p className="text-sm text-slate-500">{meeting.title} · {when(meeting)}</p>
            <p className="text-sm text-slate-500">With {meeting.attendees?.map(a => a.name).join(', ') || '—'}</p>
          </div>
          {meetings.length > 1 && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">1 of {meetings.length}</span>}
        </div>

        {options.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : options.isError ? (
          <div className="space-y-3 py-4 text-center text-sm text-red-600">
            <p>{options.error?.message || 'The form could not be loaded'}</p>
            <Button size="sm" variant="outline" onClick={() => options.refetch()}>Try again</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Where the client stands">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stages.map(s => (
                  <button key={s} type="button" onClick={() => set({ ...empty, remark: form.remark, stage: s })}
                    className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${form.stage === s ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                    {STAGE_LABEL[s] ?? s}
                  </button>
                ))}
              </div>
            </Field>

            {(form.stage === 'interested' || form.stage === 'revision') && (
              <Field label={form.stage === 'interested' ? 'Which course' : 'Course to revise'}>
                <select className={selectCls} value={form.courseId ?? ''} onChange={e => set({ courseId: e.target.value, moduleId: '' })}>
                  <option value="">Pick a course…</option>
                  {o?.courses?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </Field>
            )}

            {form.stage === 'interested' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Payment date"><input type="date" className={inputCls} value={form.paymentDate ?? ''} onChange={e => set({ paymentDate: e.target.value })} /></Field>
                <Field label="Payment mode">
                  <select className={selectCls} value={form.paymentMode ?? ''} onChange={e => set({ paymentMode: e.target.value })}>
                    <option value="">Pick…</option>
                    {o?.paymentModes?.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {form.stage === 'follow_up' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Follow-up">
                  <select className={selectCls} value={form.followUpKind ?? ''} onChange={e => set({ followUpKind: e.target.value })}>
                    <option value="">Pick…</option>
                    {o?.followUpKinds?.map(k => <option key={k} value={k}>{FOLLOW_UP_LABEL[k] ?? k}</option>)}
                  </select>
                </Field>
                <Field label="Follow-up date"><input type="date" className={inputCls} value={form.followUpDate ?? ''} onChange={e => set({ followUpDate: e.target.value })} /></Field>
              </div>
            )}

            {form.stage === 'revision' && (
              <Field label="Module (optional)">
                <select className={selectCls} value={form.moduleId ?? ''} onChange={e => set({ moduleId: e.target.value })} disabled={!course}>
                  <option value="">{course ? 'Any / not sure' : 'Pick the course first'}</option>
                  {course?.modules?.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </Field>
            )}

            {(form.stage === 'meeting_with' || form.stage === 'revision') && (
              <Field label={form.stage === 'meeting_with' ? 'Which mentor' : 'Preferred mentor (optional)'}>
                <select className={selectCls} value={form.withMentorEmail ?? ''} onChange={e => set({ withMentorEmail: e.target.value })}>
                  <option value="">{form.stage === 'meeting_with' ? 'Pick a mentor…' : 'No preference'}</option>
                  {o?.mentors?.map(m => <option key={m.email} value={m.email}>{m.name}</option>)}
                </select>
              </Field>
            )}

            {form.stage === 'not_interested' && (
              <Field label="Why">
                <select className={selectCls} value={form.reason ?? ''} onChange={e => set({ reason: e.target.value })}>
                  <option value="">Pick…</option>
                  {o?.notInterestedReasons?.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            )}

            <Field label="Remark">
              <textarea rows={3} maxLength={2000} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={form.remark}
                onChange={e => set({ remark: e.target.value })} placeholder="What the client said, what happens next" />
            </Field>

            {problem && <p className="text-sm text-red-600">{problem}</p>}
            <Button className="w-full" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save'}
            </Button>
            <p className="text-center text-xs text-slate-400">This stays open until it is filled. It goes on the student and to their CS.</p>
          </div>
        )}
      </div>
    </div>
  );
}
