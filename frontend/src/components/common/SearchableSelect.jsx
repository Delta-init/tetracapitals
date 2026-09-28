import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

/**
 * A Radix Select with a sticky search box at the top that filters the options.
 * Same approach as SearchableStudentSelect but generic.
 *
 * Props:
 *   value          currently-selected value (string)
 *   onValueChange  (value) => void
 *   options        [{ value, label }]  (value must be a non-empty string)
 *   placeholder    trigger placeholder
 *   searchPlaceholder
 *   noneLabel      if set, shows a first "none" option with this label
 *   noneValue      the value used for the none option (default "__none__")
 *   disabled
 */
export default function SearchableSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  noneLabel,
  noneValue = "__none__",
  disabled,
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  // Radix focuses the first option when the menu opens, which steals focus from
  // the search box — so typing did nothing. Re-focus the box right after open,
  // and clear the search on close (so the selected label always renders).
  useEffect(() => {
    if (!open) { setTerm(''); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter(o =>
      String(o.label).toLowerCase().includes(t) || String(o.value).toLowerCase().includes(t)
    );
  }, [options, term]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} open={open} onOpenChange={setOpen}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Shrink to the space actually available so the search box never ends up off-screen. */}
      <SelectContent className="max-h-[min(300px,var(--radix-select-content-available-height))]">
        <div className="sticky top-0 z-10 bg-white p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              ref={inputRef}
              placeholder={searchPlaceholder}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="pl-8 h-9"
              // Keep clicks/keys inside the input from reaching Radix (which would
              // move selection / close the menu / hijack typeahead).
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        {noneLabel != null && <SelectItem value={noneValue}>{noneLabel}</SelectItem>}
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">No matches</div>
        ) : (
          filtered.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
