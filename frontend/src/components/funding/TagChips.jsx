import React from 'react';
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";

/**
 * Render the tags attached to a FundingTransaction as colored chips.
 * Resolves each tag's color from the TransactionTag entity (admin-managed).
 * Falls back to a neutral chip if the tag was deleted from the master list.
 */
export default function TagChips({ tags }) {
  // If there are no tags, render nothing. Callers should render their own '-' fallback.
  if (!tags || tags.length === 0) return null;

  const { data: catalog = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: () => base44.entities.TransactionTag.list('name'),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((name) => {
        const meta = catalog.find((t) => t.name === name);
        const style = meta?.color
          ? { backgroundColor: meta.color + '20', color: meta.color, borderColor: meta.color + '40' }
          : undefined;
        return (
          <Badge key={name} variant="outline" style={style} className="text-xs font-medium">
            {name}
          </Badge>
        );
      })}
    </div>
  );
}
