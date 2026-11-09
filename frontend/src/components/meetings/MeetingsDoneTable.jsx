import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Filter, RotateCcw, X } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { cn } from '@/lib/utils';
import { MeetingStageBadge, STAGE_LABEL, FOLLOW_UP_LABEL, EXPERIENCE_LABEL, LOSS_WAY_LABEL } from './meetingStage';
import { MeetingStatusBadge, MEETING_STATUS, CATEGORY, when } from './meetingsUi';

/* ────────────────────────────────────────────────────────────────────────────
   Meetings done, every field (the user, 2026-11-09): pick the columns and
   their order (kept on this device), a filter for each field (dates from–to,
   lists from what is there, words "contains"), a row opened to its full card,
   and the export in the columns chosen. The rows: backend getMeetingsDone.
──────────────────────────────────────────────────────────────────────────── */

const CS_STATUS = { asked: 'Waiting for CS', asked_again: 'Waiting for CS', ongoing: 'Ongoing', completed: 'Completed', cancelled: 'Cancelled', cancelling: 'Cancelling…' };
const PROMISE = { paid: ['Paid', 'bg-emerald-50 text-emerald-700'], due: ['Due', 'bg-amber-50 text-amber-700'], overdue: ['Overdue', 'bg-rose-50 text-rose-700'] };
const payText = (r) => (r.payment ? `AED ${Math.round(r.payment.aed).toLocaleString('en-US')}${r.payment.product ? ` · ${r.payment.product}` : ''} · ${day(r.payment.date)} · ${r.payment.status === 'approved' ? 'approved' : 'waiting approval'}${r.payment.linked ? '' : ' (after it)'}` : '');
const money = (n, cur) => `${cur || ''} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();
const o = (r) => r.outcome || {};
const p = (r) => r.outcome?.profile || null;
const day = (iso) => (iso ? new Date(new Date(iso).getTime() + 4 * 3600e3).toISOString().slice(0, 10) : '');
const experience = (r) => { const x = p(r); if (!x) return ''; const e = EXPERIENCE_LABEL[x.experience] ?? x.experience ?? ''; return x.experience === 'fresher' || x.years == null ? e : `${e} · ${x.years} yr`; };
const lossWays = (r) => (p(r)?.lossHow ?? []).map(w => LOSS_WAY_LABEL[w] ?? w);

/**
 * Every field a meeting has. get: its text (filter, sort, export); show: how the cell looks (else the text);
 * filter: 'date' (from–to on a YYYY-MM-DD), 'select' (from the values there), 'text' (contains); on: shown at first.
 */
export const COLUMNS = [
  { key: 'when', label: 'When', on: true, get: r => when(r.starts_at), show: r => <>{when(r.starts_at)}<div className="text-xs text-slate-400">{r.title}</div></>, sortBy: r => r.starts_at },
  { key: 'category', label: 'Category', get: r => CATEGORY[r.category] ?? (r.category === 'course_upgrade' ? 'Course Upgradation' : r.category || ''), filter: 'select' },
  { key: 'student', label: 'Student', on: true, get: r => r.student?.name || r.attendee || '', filter: 'text',
    show: r => r.student
      ? <><Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}&tab=meetings`} onClick={e => e.stopPropagation()} className="font-medium text-blue-700 hover:underline">{r.student.name || r.attendee}</Link>{r.student.code && <div className="font-mono text-xs text-slate-400">{r.student.code}</div>}</>
      : <span className="text-slate-600">{r.attendee || '—'}</span> },
  { key: 'code', label: 'Code', get: r => r.student?.code || '', filter: 'text' },
  { key: 'mentor', label: 'Mentor', on: true, get: r => r.mentor?.name || '', filter: 'select' },
  { key: 'cs', label: 'CS', on: true, get: r => r.student?.cs || '', filter: 'select' },
  { key: 'team', label: 'Team', on: true, get: r => r.student?.team || '', filter: 'select' },
  { key: 'status', label: 'Status', on: true, get: r => MEETING_STATUS[r.status]?.label ?? r.status ?? '', filter: 'select', show: r => <MeetingStatusBadge status={r.status} /> },
  // What the CS said became of it, 10 minutes in (2026-11-09).
  { key: 'cs_status', label: 'Meeting status (CS)', on: true, get: r => CS_STATUS[r.cs_status?.status] ?? (r.cs_status?.status || ''), filter: 'select' },
  { key: 'cancel_reason', label: 'Cancel reason', get: r => r.cs_status?.reason || r.cancel_reason || '', filter: 'text' },
  { key: 'rescheduled_to', label: 'Rescheduled to', get: r => (r.cs_status?.rescheduled_to ? when(r.cs_status.rescheduled_to) : ''), filter: 'select' },
  // The payment that came from it (linked on the funding request, else an approved one after it) and the promised date (2026-11-09).
  { key: 'payment', label: 'Payment received', on: true, get: r => payText(r), show: r => (r.payment
      ? <span className={r.payment.status === 'approved' ? 'text-emerald-700' : 'text-amber-700'}>{payText(r)}</span>
      : r.student ? <span className="text-slate-400">Not paid</span> : <span className="text-slate-300">—</span>) },
  { key: 'payment_status', label: 'Payment status', get: r => (r.payment ? (r.payment.status === 'approved' ? 'Paid' : 'Waiting approval') : r.student ? 'Not paid' : ''), filter: 'select' },
  { key: 'promise', label: 'Promised payment', on: true, get: r => (r.promise ? `${r.promise.date} · ${PROMISE[r.promise.status][0]}` : ''),
    show: r => (r.promise ? <span className="whitespace-nowrap">{r.promise.date} <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', PROMISE[r.promise.status][1])}>{PROMISE[r.promise.status][0]}</span></span> : <span className="text-slate-300">—</span>) },
  { key: 'promise_status', label: 'Promise status', get: r => (r.promise ? PROMISE[r.promise.status][0] : ''), filter: 'select' },
  { key: 'mode', label: 'Online / in person', get: r => (r.in_person ? `In person${r.location ? ` — ${r.location}` : ''}` : r.duration_mins ? 'Online' : ''), filter: 'select' },
  { key: 'length', label: 'Length', get: r => (r.duration_mins ? `${r.duration_mins} min` : ''), filter: 'select' },
  { key: 'booked_by', label: 'Booked by', get: r => r.booked_by || '', filter: 'select' },
  { key: 'stage', label: 'Stage', on: true, get: r => STAGE_LABEL[r.stage] ?? (r.status === 'waiting' ? 'Waiting for mentor' : r.stage || ''), filter: 'select', show: r => (r.stage ? <MeetingStageBadge stage={r.stage} /> : <span className="text-slate-300">—</span>) },
  { key: 'course', label: 'Course', on: true, get: r => o(r).courseTitle || '', filter: 'select' },
  { key: 'payment_date', label: 'Payment date', on: true, get: r => o(r).paymentDate || '', filter: 'date' },
  { key: 'payment_intent', label: 'Payment intention', get: r => (r.stage === 'interested' ? ({ explicit_plan: 'Explicit plan', interested_no_commitment: 'No firm commitment', not_discussed: 'Not discussed' }[o(r).paymentIntent || 'explicit_plan']) : ''), filter: 'select' },
  { key: 'payment_mode', label: 'Payment mode', get: r => o(r).paymentMode || '', filter: 'select' },
  { key: 'followup_kind', label: 'Follow-up kind', get: r => FOLLOW_UP_LABEL[o(r).followUpKind] ?? o(r).followUpKind ?? '', filter: 'select' },
  { key: 'followup_date', label: 'Follow-up date', on: true, get: r => o(r).followUpDate || r.reminder?.date || '', filter: 'date' },
  { key: 'meeting_with', label: 'Meeting with', get: r => o(r).withMentorName || '', filter: 'select' },
  { key: 'module', label: 'Module', get: r => o(r).moduleTitle || '', filter: 'select' },
  { key: 'reason', label: 'Not interested — why', get: r => o(r).reason || '', filter: 'text' },
  { key: 'concern', label: 'Concern', on: true, get: r => o(r).concern || '', filter: 'text' },
  { key: 'remark', label: 'Remark', get: r => o(r).remark || '', filter: 'text' },
  { key: 'experience', label: 'Experience', get: experience, filter: 'select' },
  { key: 'losses', label: 'Losses', get: r => { const x = p(r); return !x ? '' : x.hadLosses ? money(x.lossAmount, x.lossCurrency) : 'None'; } },
  { key: 'had_losses', label: 'Had losses', get: r => { const x = p(r); return !x ? '' : x.hadLosses ? 'Yes' : 'No'; }, filter: 'select' },
  { key: 'loss_how', label: 'Loss — how', get: r => lossWays(r).join(', '), filter: 'select', options: rows => [...new Set(rows.flatMap(lossWays))], match: (r, v) => lossWays(r).includes(v) },
  { key: 'country', label: 'Country', get: r => p(r)?.country || '', filter: 'select' },
  { key: 'family', label: 'Family in Dubai', get: r => { const x = p(r); return !x ? '' : x.familyInDubai ? 'Yes' : 'No'; }, filter: 'select' },
  { key: 'occupation', label: 'Occupation', get: r => p(r)?.occupation || '', filter: 'text' },
  { key: 'filled_by', label: 'Outcome filled by', get: r => o(r).filledByName || '', filter: 'select' },
  { key: 'filled_at', label: 'Outcome filled on', get: r => day(o(r).filledAt), filter: 'date' },
];
const BY_KEY = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
const STORE = 'meetings-done-columns';
const DEFAULT = COLUMNS.map(c => ({ key: c.key, on: !!c.on }));

/** The chosen columns and their order, kept on this device. */
export function useColumns() {
  const [list, setList] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (Array.isArray(saved)) {
        const known = saved.filter(s => BY_KEY[s.key]);
        return [...known, ...DEFAULT.filter(d => !known.some(k => k.key === d.key))];
      }
    } catch { /* the default */ }
    return DEFAULT;
  });
  const save = (next) => { setList(next); try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* this visit only */ } };
  return { list, save, shown: list.filter(c => c.on).map(c => BY_KEY[c.key]), reset: () => save(DEFAULT) };
}

export function ColumnPicker({ cols }) {
  const move = (i, d) => { const n = [...cols.list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; cols.save(n); };
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9 gap-1.5"><Columns3 className="h-4 w-4" />Columns <span className="text-xs text-slate-400">{cols.shown.length}</span></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Show and order</p>
          <button type="button" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={cols.reset}><RotateCcw className="h-3 w-3" />Reset</button>
        </div>
        <ul className="max-h-[60vh] overflow-auto">
          {cols.list.map((c, i) => (
            <li key={c.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4" checked={c.on} onChange={e => cols.save(cols.list.map(x => (x.key === c.key ? { ...x, on: e.target.checked } : x)))} id={`col-${c.key}`} />
              <label htmlFor={`col-${c.key}`} className="flex-1 cursor-pointer text-sm text-slate-700">{BY_KEY[c.key].label}</label>
              <button type="button" aria-label="Up" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Down" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 disabled:opacity-30" disabled={i === cols.list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** One filter per field: { [key]: value | { from, to } }. */
export function applyFilters(rows, filters) {
  return rows.filter(r => Object.entries(filters).every(([k, v]) => {
    const c = BY_KEY[k];
    if (!c) return true;
    if (c.filter === 'date') { const d = c.get(r); if (!v.from && !v.to) return true; return !!d && (!v.from || d >= v.from) && (!v.to || d <= v.to); }
    if (c.filter === 'text') return !v || c.get(r).toLowerCase().includes(String(v).toLowerCase());
    if (!v) return true;
    if (v === '__none__') return !c.get(r);
    return c.match ? c.match(r, v) : c.get(r) === v;
  }));
}
const isOn = (v) => (v && typeof v === 'object' ? !!(v.from || v.to) : !!v);
const selectCls = 'h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';

export function FilterPanel({ rows, filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const active = Object.entries(filters).filter(([, v]) => isOn(v));
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const optionsOf = (c) => (c.options ? c.options(rows) : [...new Set(rows.map(c.get).filter(Boolean))]).sort((a, b) => String(a).localeCompare(String(b)));
  const chip = ([k, v]) => {
    const c = BY_KEY[k];
    const text = typeof v === 'object' ? `${v.from || '…'} – ${v.to || '…'}` : v === '__none__' ? '(empty)' : v;
    return (
      <span key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs text-brand-navy">
        {c.label}: {text}
        <button type="button" aria-label={`Clear ${c.label}`} onClick={() => setFilters(f => { const n = { ...f }; delete n[k]; return n; })}><X className="h-3 w-3" /></button>
      </span>
    );
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={open ? 'default' : 'outline'} size="sm" className="h-9 gap-1.5" onClick={() => setOpen(v => !v)}>
          <Filter className="h-4 w-4" />Filters{active.length ? ` · ${active.length}` : ''}{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </Button>
        {active.map(chip)}
        {active.length > 0 && <button type="button" className="text-xs text-slate-500 underline" onClick={() => setFilters({})}>Clear all</button>}
      </div>
      {open && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.filter(c => c.filter).map(c => (
            <div key={c.key} className="space-y-1">
              <p className="text-xs font-medium text-slate-600">{c.label}</p>
              {c.filter === 'date' ? (
                <div className="flex items-center gap-1">
                  <Input type="date" className="h-8 px-2 text-xs" value={filters[c.key]?.from || ''} onChange={e => set(c.key, { ...(filters[c.key] || {}), from: e.target.value })} />
                  <span className="text-xs text-slate-400">–</span>
                  <Input type="date" className="h-8 px-2 text-xs" value={filters[c.key]?.to || ''} onChange={e => set(c.key, { ...(filters[c.key] || {}), to: e.target.value })} />
                </div>
              ) : c.filter === 'text' ? (
                <Input className="h-8 text-sm" placeholder="contains…" value={filters[c.key] || ''} onChange={e => set(c.key, e.target.value)} />
              ) : (
                <select className={selectCls} value={filters[c.key] || ''} onChange={e => set(c.key, e.target.value)}>
                  <option value="">Any</option>
                  {optionsOf(c).map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="__none__">(empty)</option>
                </select>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A row opened: every field it has, as on the student's Meetings tab. */
function FullCard({ r }) {
  const fields = COLUMNS.filter(c => !['when', 'student', 'status', 'stage'].includes(c.key)).map(c => [c.label, c.get(r)]).filter(([, v]) => v);
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-brand-navy">{when(r.starts_at)}</span><span className="text-slate-500">{r.title}</span>
        <MeetingStatusBadge status={r.status} />{r.stage && <MeetingStageBadge stage={r.stage} />}
      </div>
      {r.summary && <p className="text-sm text-slate-700">{r.summary}</p>}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {fields.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="whitespace-pre-wrap text-slate-800">{v}</dd></div>)}
      </dl>
    </div>
  );
}

/** The table in the columns chosen; a row opens its full card. */
export function MeetingsDoneTable({ rows, columns, resetKey }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Paged items={rows} resetKey={resetKey}>
      {(pageRows, bar) => (<>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-6 px-1 py-2" />
                {columns.map(c => <th key={c.key} className="whitespace-nowrap px-3 py-2">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-b align-top last:border-0 hover:bg-slate-50" onClick={() => toggle(r.id)}>
                    <td className="px-1 py-2 text-slate-400">{open.has(r.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    {columns.map(c => (
                      <td key={c.key} className={cn('px-3 py-2', ['concern', 'remark', 'reason', 'occupation'].includes(c.key) ? 'min-w-[220px] max-w-[320px]' : 'whitespace-nowrap')}>
                        {c.show ? c.show(r) : (c.get(r) || <span className="text-slate-300">—</span>)}
                      </td>
                    ))}
                  </tr>
                  {open.has(r.id) && <tr className="border-b bg-slate-50/60"><td /><td colSpan={columns.length} className="px-3 py-3"><FullCard r={r} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination {...bar} />
      </>)}
    </Paged>
  );
}

/** The rows as a CSV in the columns chosen, in their order. */
export function exportMeetings(rows, columns, name) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(c => cell(c.label)).join(','), ...rows.map(r => columns.map(c => cell(c.get(r))).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
