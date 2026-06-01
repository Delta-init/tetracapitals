import React, { useState } from 'react';
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, X } from "lucide-react";

/**
 * Multi-select dropdown driven by the admin-managed TransactionTag list.
 * Props:
 *   value:     string[]            currently-selected tag names
 *   onChange:  (next: string[]) => void
 *   disabled?: boolean
 */
export default function TagsPicker({ value = [], onChange, disabled }) {
  const [open, setOpen] = useState(false);

  const { data: tags = [] } = useQuery({
    queryKey: ['transaction-tags'],
    queryFn: async () => {
      // Only show active tags. The admin page can flip `active=false` to hide one.
      const all = await base44.entities.TransactionTag.list('name');
      return all.filter(t => t.active !== false);
    },
  });

  const toggle = (name) => {
    if (value.includes(name)) onChange(value.filter(v => v !== name));
    else onChange([...value, name]);
  };

  const remove = (name) => onChange(value.filter(v => v !== name));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">Select tag(s)…</span>
            ) : (
              <span>{value.length} tag{value.length === 1 ? '' : 's'} selected</span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
          {tags.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              No tags defined yet. An admin can add them in the <strong>Tags</strong> page.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {tags.map(t => {
                const checked = value.includes(t.name);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.name)}
                    className={`w-full text-left px-3 py-2 text-sm rounded flex items-center gap-2 hover:bg-slate-100 ${checked ? 'bg-slate-50' : ''}`}
                  >
                    <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
                    {t.color && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />}
                    <span>{t.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(name => {
            const meta = tags.find(t => t.name === name);
            return (
              <Badge
                key={name}
                variant="secondary"
                className="gap-1 pr-1"
                style={meta?.color ? { backgroundColor: meta.color + '20', color: meta.color, borderColor: meta.color + '40' } : undefined}
              >
                {name}
                <button
                  type="button"
                  onClick={() => remove(name)}
                  disabled={disabled}
                  className="ml-1 rounded-full hover:bg-black/10 p-0.5"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
