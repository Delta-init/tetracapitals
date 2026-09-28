import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Where the Root portal sends somebody it is opening this app for:
 * /sso?token=… — a one-time token the server checks with the portal before
 * signing that person in, exactly as a password login would.
 *
 * A full reload afterwards rather than a client-side navigation, so the whole
 * app starts again from the new session instead of the empty one it loaded
 * with.
 */
export default function Sso() {
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // Once: the token is single-use, and a second attempt would only fail.
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setError('This link has no sign-in token. Open Tetra Commission from the portal again.');
      return;
    }
    base44.auth.ssoLogin(token)
      .then(() => window.location.replace('/'))
      .catch((err) => setError(err?.message || 'Could not sign you in from the portal.'));
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background bg-dot-grid p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <img src="/brand/delta-logo.png" alt="Delta" className="mx-auto mb-5 h-9 w-auto" />
        {error ? (
          <>
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Could not sign you in</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <a href="/Login" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
              Sign in with a password instead
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Signing you in from the portal…</p>
          </>
        )}
      </div>
    </div>
  );
}
