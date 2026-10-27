import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Tick any number of options, with a search box and Clear. Nothing ticked means
 * everyone — the trigger then shows `allLabel`.
 *
 * Props:
 *   value      string[]                     ticked values
 *   onChange   (next: string[]) => void
 *   options    [{ value, label, hint? }]    hint is shown dimmed on the right (a count)
 *   allLabel   trigger text with nothing ticked
 *   noun       "team" / "person" — the trigger says "3 people" etc.
 *   nounPlural
 *   searchPlaceholder
 */
export default function MultiSelect({
  value = [], onChange, options = [], allLabel = 'Everyone', noun = 'item', nounPlural, searchPlaceholder = 'Search…', className = '',
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const inputRef = useRef(null);
  const ticked = useMemo(() => new Set(value), [value]);

  useEffect(() => {
    if (!open) { setTerm(''); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? options.filter(o => String(o.label).toLowerCase().includes(t)) : options;
  }, [options, term]);

  const toggle = (v) => onChange(ticked.has(v) ? value.filter(x => x !== v) : [...value, v]);
  const first = options.find(o => o.value === value[0]);
  const label = !value.length ? allLabel
    : value.length === 1 ? (first?.label ?? `1 ${noun}`)
      : `${value.length} ${nounPlural || `${noun}s`}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button"
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm ${value.length ? 'border-cyan-300 bg-cyan-50/50 text-slate-900' : 'text-slate-700'} ${className}`}>
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {value.length > 0 && (
              <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" aria-label="Clear"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange([]); }} />
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input ref={inputRef} value={term} onChange={e => setTerm(e.target.value)} placeholder={searchPlaceholder} className="h-9 pl-8" />
          </div>
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">No matches</div>
          ) : filtered.map(o => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
              <Checkbox checked={ticked.has(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint != null && <span className="tabular text-xs text-slate-400">{o.hint}</span>}
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
          <span className="text-slate-500">{value.length ? `${value.length} ticked` : allLabel}</span>
          <button type="button" className="font-medium text-cyan-700 hover:underline disabled:text-slate-300 disabled:no-underline"
            disabled={!value.length} onClick={() => onChange([])}>Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
