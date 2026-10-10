import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";

/**
 * Whether the link to Delta Finance is on — the server's own switch (its
 * FINANCE_* settings), so the pages and the server agree about which requests
 * are waiting on the accountants: new bonuses, and deposits sent before
 * 2026-10-10 (new deposits are approved here).
 */
export function useFinanceLink() {
  const { data } = useQuery({
    queryKey: ['finance-link'],
    queryFn: async () => (await base44.functions.invoke('getFinanceLink', {})).data,
    staleTime: 5 * 60_000,
  });
  return data?.depositsToFinance ?? true;
}

/** "With accounts", in place of Pending, for a deposit or bonus Delta Finance is deciding. */
export function WithAccountsBadge({ transaction }) {
  const fa = transaction?.finance_approval || {};
  const then = transaction?.type === 'BONUS' ? ' — then a broker admin credits the bonus and approves it here' : '';
  const title = fa.state === 'queued'
    ? (fa.last_error ? `Not reached Delta Finance yet (${fa.last_error}) — retrying on its own` : 'On its way to Delta Finance')
    : `With Delta Finance — the accountants approve or reject it there${then}`;
  return (
    <Badge variant="outline" className="bg-sky-100 text-sky-800 border-sky-200 whitespace-nowrap" title={title}>
      With accounts
    </Badge>
  );
}

/** A line under the status: handed back by finance, or a note the accountants left. */
export function FinanceApprovalNote({ transaction }) {
  const fa = transaction?.finance_approval;
  if (!fa) return null;
  if (transaction.status === 'PENDING' && fa.state === 'refused') {
    return (
      <span className="block text-[11px] text-amber-700 mt-1" title={fa.reason || ''}>
        Accounts could not take it — {transaction.type === 'BONUS' ? 'a broker admin approves it here' : 'approve here'}
      </span>
    );
  }
  // A bonus: finance approved the payment; a broker admin or a Super Admin credits it and approves.
  if (transaction.type === 'BONUS' && transaction.status === 'PENDING' && fa.state === 'decided' && fa.decision === 'approved') {
    return (
      <span className="block text-[11px] font-medium text-emerald-700 mt-1"
        title={`Approved in Delta Finance${fa.decided_by_name ? ` by ${fa.decided_by_name}` : ''}${fa.note ? ` — ${fa.note}` : ''}`}>
        Accounts approved — for a broker admin
      </span>
    );
  }
  if (fa.state === 'decided' && fa.note) {
    return <span className="block text-[11px] text-gray-500 mt-1" title={fa.note}>Accounts: {fa.note}</span>;
  }
  return null;
}
