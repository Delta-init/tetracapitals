import React, { useEffect, useMemo, useRef } from 'react';
import { useUrlParams } from '@/components/utils/urlState';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Paging for every table: the bar under it ("1–25 of 4,370", rows per page,
   Prev · 1 2 3 … 9 · Next), and usePagination() for a list already in memory.
   Pages whose lists are paged by the server (Students, the logs,
   Transactions) use the bar alone, with page / total from the server.

   The page and the rows per page live in the address (the user, 2026-10-10):
   `?page=3&limit=50`, or `?<name>=3&<name minus "page">limit=50` for a table
   that is one of several on a screen (`urlKey`, e.g. "classes_page" →
   `classes_page` and `classes_limit`). Kept by replacing the history entry, so
   Back, a refresh or a shared link lands on the same page of the same list.
──────────────────────────────────────────────────────────────────────────── */

export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/** The page buttons to show: 1 … 4 5 [6] 7 8 … 20 */
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, page - 2), to = Math.min(pages - 1, page + 2);
  if (from > 2) out.push('…');
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

/**
 * The bar under a table. Nothing when everything fits on one page of the
 * smallest size. `onPageSizeChange` is optional (no "Rows" picker without it).
 */
export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange, busy = false, className = '' }) {
  if (!total || total <= PAGE_SIZES[0]) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const go = (p) => { if (p >= 1 && p <= pages && p !== page) onPageChange(p); };
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 text-sm text-slate-600 ${className}`}>
      <span className="tabular-nums">
        {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rows</span>
            <Select value={String(pageSize)} onValueChange={(v) => v && onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-8 w-[76px]" aria-label="Rows per page"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <nav className="flex items-center gap-1" aria-label="Pages">
          <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={busy || page <= 1} onClick={() => go(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {pageList(page, pages).map((p, i) => (p === '…'
            ? <span key={`gap-${i}`} className="px-1 text-slate-400">…</span>
            : (
              <Button key={p} type="button" variant={p === page ? 'default' : 'ghost'} size="sm" className="h-8 min-w-[32px] px-2 tabular-nums"
                disabled={busy && p !== page} onClick={() => go(p)} aria-current={p === page ? 'page' : undefined}>
                {p}
              </Button>
            )))}
          <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" disabled={busy || page >= pages} onClick={() => go(page + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </div>
  );
}

/** The address names a table's page and rows per page go by: "page"/"limit", "classes_page"/"classes_limit". */
const limitKeyOf = (urlKey) => (urlKey === 'page' ? 'limit' : `${urlKey.replace(/_?page$/, '')}_limit`);

/**
 * A table's page and rows per page, kept in the address. For a server-paged list (Students, the logs…) as much as one
 * in memory. Changing the rows per page goes back to page 1.
 */
export function useUrlPage(urlKey = 'page', defaultSize = DEFAULT_PAGE_SIZE) {
  const [params, update] = useUrlParams();
  const limitKey = limitKeyOf(urlKey);
  const page = Math.max(1, parseInt(params.get(urlKey) || '1', 10) || 1);
  const asked = parseInt(params.get(limitKey) || '', 10);
  const pageSize = PAGE_SIZES.includes(asked) ? asked : defaultSize;
  const write = (nextPage, nextSize) => update((next) => {
    if (nextPage <= 1) next.delete(urlKey); else next.set(urlKey, String(nextPage));
    if (nextSize !== undefined) { if (nextSize === defaultSize) next.delete(limitKey); else next.set(limitKey, String(nextSize)); }
  });
  return {
    page,
    pageSize,
    setPage: (p) => write(p),
    setPageSize: (n) => write(1, n),
  };
}

/** Back to page 1 when `key` (the search and filters) changes — never on the first render, which would throw away the page the address asked for. */
export function useResetPage(key, setPage) {
  const before = useRef(key);
  useEffect(() => {
    if (before.current === key) return;
    before.current = key;
    setPage(1);
  }, [key, setPage]);
}

/**
 * Paging for a list already in memory: `pageItems` to render, `bar` to spread
 * onto <TablePagination />. Back to page 1 whenever `resetKey` changes — pass
 * the search and filters; by default, the list's length.
 *
 *   const { pageItems, bar } = usePagination(filtered, { resetKey: `${search}|${status}` });
 */
export function usePagination(items, { pageSize: initialSize = DEFAULT_PAGE_SIZE, resetKey, urlKey = 'page' } = {}) {
  const list = Array.isArray(items) ? items : [];
  const { page, pageSize, setPage, setPageSize } = useUrlPage(urlKey, initialSize);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  /* Back to page 1 when the search or a filter changes — not on the first render, and not while the list is still
     arriving (a key that counts the rows changes as they load): either would throw away the page the address asked for. */
  const seen = useRef({ key: resetKey, total });
  useEffect(() => {
    const before = seen.current;
    seen.current = { key: resetKey, total };
    if (resetKey === undefined || before.key === resetKey || before.total === 0) return;
    setPage(1);
  }, [resetKey]);
  // Showing: never past the last page, though the address is left as it is until the reader moves.
  const current = total ? Math.min(page, pages) : page;
  const pageItems = useMemo(() => list.slice((current - 1) * pageSize, current * pageSize), [list, current, pageSize]);
  return {
    pageItems,
    page: current,
    pageSize,
    total,
    setPage,
    setPageSize,
    bar: { page: current, pageSize, total, onPageChange: setPage, onPageSizeChange: setPageSize },
  };
}

/**
 * usePagination as a component — for a list worked out after an early return,
 * or one table among several on a page:
 *
 *   <Paged items={rows} resetKey={search}>
 *     {(pageRows, bar) => (<>
 *       <Table>…{pageRows.map(…)}…</Table>
 *       <TablePagination {...bar} />
 *     </>)}
 *   </Paged>
 */
export function Paged({ items, resetKey, pageSize, urlKey, children }) {
  const { pageItems, bar } = usePagination(items, { resetKey, pageSize, urlKey });
  return children(pageItems, bar);
}
