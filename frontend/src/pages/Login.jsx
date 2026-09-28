import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { EASE, RevealText, Stagger, StaggerItem } from '@/components/motion';

const HIGHLIGHTS = [
  { k: 'Commissions', v: 'Position-based plans, tracked to the cent' },
  { k: 'Funding', v: 'Every deposit and withdrawal, approved in one flow' },
  { k: 'Performance', v: 'Targets, leaderboards and team insights live' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await base44.auth.login({ email, password });
      toast.success('Signed in');
      // Hard navigate so AuthProvider re-runs its `me()` check on the next mount.
      window.location.href = '/';
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-brand-navy p-12 text-white lg:flex xl:p-16">
        <motion.div
          className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-cyan/30 blur-[110px]"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-brand-mint/20 blur-[120px]"
          animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

        <motion.img
          src="/brand/delta-logo-white.png"
          alt="Delta"
          className="relative h-9 w-auto self-start"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        />

        <div className="relative">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/50"
          >
            <span className="h-1.5 w-8 rounded-full bg-brand-gradient" /> Commission Portal
          </motion.p>
          <h1 className="text-5xl font-bold leading-[1.05] xl:text-6xl">
            <RevealText text="Performance," delay={0.15} />
            <br />
            <span className="font-serif text-6xl font-normal italic text-gradient xl:text-7xl">
              <RevealText text="rewarded." delay={0.35} />
            </span>
          </h1>

          <Stagger className="mt-12 space-y-5" delay={0.7} stagger={0.12}>
            {HIGHLIGHTS.map(h => (
              <StaggerItem key={h.k} className="flex items-start gap-4 border-t border-white/10 pt-5">
                <span className="w-28 flex-shrink-0 text-sm font-semibold text-white">{h.k}</span>
                <span className="text-sm text-white/55">{h.v}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Delta Institutions</p>
      </div>

      {/* Form */}
      <div className="relative flex flex-1 items-center justify-center bg-dot-grid px-5 py-12 sm:px-8">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-brand-cyan/10 blur-3xl lg:hidden" />
        <Stagger className="relative w-full max-w-sm" delay={0.1} stagger={0.08}>
          <StaggerItem className="mb-10 lg:hidden">
            <img src="/brand/delta-logo.png" alt="Delta" className="h-9 w-auto" />
          </StaggerItem>

          <StaggerItem>
            <h2 className="text-3xl font-bold text-brand-navy">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">Sign in to your Delta workspace to continue.</p>
          </StaggerItem>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <StaggerItem>
              <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Email</label>
              <div className="group relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-navy" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@delta.com"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-brand-navy shadow-soft outline-none transition-all placeholder:text-slate-400 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/15"
                />
              </div>
            </StaggerItem>

            <StaggerItem>
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Password</label>
              <div className="group relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-navy" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 text-sm text-brand-navy shadow-soft outline-none transition-all placeholder:text-slate-400 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-navy"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </StaggerItem>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 3, 0] }}
                transition={{ duration: 0.4 }}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </motion.div>
            )}

            <StaggerItem>
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-navy text-sm font-semibold text-white shadow-lift transition-shadow hover:shadow-glow disabled:opacity-70"
              >
                <span className="absolute inset-0 translate-y-full bg-brand-gradient transition-transform duration-500 ease-out group-hover:translate-y-0" />
                <span className="relative flex items-center gap-2 transition-colors duration-300 group-hover:text-brand-navy">
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                  ) : (
                    <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>
                  )}
                </span>
              </motion.button>
            </StaggerItem>
          </form>

          <StaggerItem>
            <p className="mt-10 text-center text-xs text-slate-400">Protected workspace · Access is logged</p>
          </StaggerItem>
        </Stagger>
      </div>
    </div>
  );
}
