import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
   State kept in the address (the user, 2026-10-10): a list's filters, search,
   tab and page, so Back, a refresh or a shared link land on the same view.

   Every write reads the address as it is NOW (window.location), not as it was
   when the component last drew — two changes in one click (a filter and its
   page, two tables going back to page 1) would otherwise each overwrite the
   other. It replaces the history entry, so Back still goes to the page before.
──────────────────────────────────────────────────────────────────────────── */

/** The address's query, and `update(mutate)` — `mutate` gets a URLSearchParams to change in place. */
export function useUrlParams() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const update = useCallback((mutate) => {
    const next = new URLSearchParams(window.location.search);
    mutate(next);
    const qs = next.toString();
    if (qs === window.location.search.replace(/^\?/, '')) return;
    navigate({ search: qs ? `?${qs}` : '' }, { replace: true });
  }, [navigate]);
  return [params, update];
}

/**
 * One value kept in the address under `name`; `fallback` is what an absent one means, and setting it back to that
 * removes it, so the plain list keeps a plain address. Takes a value or an updater, like useState.
 */
export function useUrlState(name, fallback = 'all') {
  const [params, update] = useUrlParams();
  const value = params.get(name) ?? fallback;
  const set = useCallback((v) => update((n) => {
    const val = typeof v === 'function' ? v(n.get(name) ?? fallback) : v;
    if (val === fallback || val === '' || val == null) n.delete(name); else n.set(name, String(val));
  }), [update, name, fallback]);
  return [value, set];
}
