import React from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Minus } from 'lucide-react';
import { CountUp, EASE } from '@/components/motion';

const ACCENTS = {
  blue:    { chip: 'bg-blue-50 text-blue-700 ring-blue-100',          bar: 'from-brand-navy to-blue-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', bar: 'from-emerald-400 to-brand-mint' },
  purple:  { chip: 'bg-violet-50 text-violet-600 ring-violet-100',    bar: 'from-violet-500 to-fuchsia-400' },
  amber:   { chip: 'bg-amber-50 text-amber-600 ring-amber-100',       bar: 'from-amber-400 to-orange-400' },
  red:     { chip: 'bg-rose-50 text-rose-600 ring-rose-100',          bar: 'from-rose-500 to-red-400' },
  cyan:    { chip: 'bg-cyan-50 text-cyan-700 ring-cyan-100',          bar: 'from-brand-cyan to-brand-mint' },
};

export default function StatsCard({ title, value, icon: Icon, color = 'blue', trend, trendUp, delay = 0 }) {
  const accent = ACCENTS[color] || ACCENTS.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      whileHover={{ y: -4 }}
      className="group relative h-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft transition-shadow duration-300 hover:shadow-lift sm:p-6"
    >
      {/* accent line that grows on hover */}
      <span className={`absolute inset-x-0 top-0 h-[3px] origin-left scale-x-[0.18] bg-gradient-to-r ${accent.bar} transition-transform duration-500 ease-out group-hover:scale-x-100`} />

      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] font-medium text-slate-500">{title}</p>
        {Icon && (
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${accent.chip} transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110`}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>

      <p className="mt-3 truncate text-[1.75rem] font-bold leading-none tracking-tight text-brand-navy sm:text-3xl">
        <CountUp value={value} />
      </p>

      {trend && (
        <div className="mt-3 flex items-center gap-1.5">
          {trendUp !== undefined && (
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            </span>
          )}
          <p className={`truncate text-xs font-medium ${trendUp ? 'text-emerald-600' : 'text-slate-500'}`}>{trend}</p>
        </div>
      )}
    </motion.div>
  );
}
