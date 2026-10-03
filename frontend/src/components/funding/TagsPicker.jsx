import React from 'react';
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Single-tag picker backed by the admin-managed TransactionTag list.
 * The data shape stays `tags: string[]` (so existing multi-tag records still
 * read fine) but a transaction can only carry one tag going forward.
 *
 * Props:
 *   value:     string[]            currently-selected tag names (length 0 or 1)
 *   onChange:  (next: string[]) => void
 *   disabled?: boolean
 *   only?:     (tag) => boolean   only these — a Bonus lists the courses with a bonus set
 */
export default function TagsPicker({ value = [], onChange, disabled, only }) {
  const { data: tags = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: async () => {
      const all = await base44.entities.TransactionTag.list('name');
      return all.filter(t => t.active !== false);
    },
    staleTime: 5 * 60_000,
  });

  // Read the first (and only) selected tag. Falls back to '' which the Select
  // renders as its placeholder.
  const selected = Array.isArray(value) && value.length > 0 ? value[0] : '';

  const handleChange = (name) => {
    if (!name) {
      onChange([]);
    } else {
      onChange([name]);
    }
  };

  const shown = only ? tags.filter(only) : tags;
  if (shown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {tags.length === 0 ? 'No products defined yet.' : 'No course has a bonus set yet.'} An admin can set them on the <strong>Products</strong> page.
      </p>
    );
  }

  return (
    <Select value={selected} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Select a product…" />
      </SelectTrigger>
      <SelectContent>
        {shown.map((t) => (
          <SelectItem key={t.id} value={t.name}>
            <span className="inline-flex items-center gap-2">
              {t.color && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />}
              {t.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
