import React from 'react';
import { motion } from 'framer-motion';
import { EASE, RevealText } from '@/components/motion';

/**
 * Animated page title: optional eyebrow label, optional icon chip, and a
 * word-by-word reveal when the title is plain text.
 *   <PageTitle eyebrow="Commission" icon={Layers}>Commission Plans</PageTitle>
 */
export function PageTitle({ eyebrow, icon: Icon, children, className = '' }) {
  const text = React.Children.toArray(children).every(c => typeof c === 'string' || typeof c === 'number')
    ? React.Children.toArray(children).join('').replace(/\s+/g, ' ').trim()
    : null;

  return (
    <div className={`min-w-0 ${className}`}>
      {eyebrow && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
        >
          <span className="h-1.5 w-6 rounded-full bg-brand-gradient" />
          {eyebrow}
        </motion.div>
      )}
      <h1 className="flex items-center gap-3 text-3xl font-bold leading-tight tracking-tight text-brand-navy sm:text-4xl">
        {Icon && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-navy text-brand-cyan shadow-lift sm:h-11 sm:w-11"
          >
            <Icon className="h-5 w-5" />
          </motion.span>
        )}
        {text !== null ? (
          <RevealText text={text} delay={Icon ? 0.1 : 0} />
        ) : (
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            {children}
          </motion.span>
        )}
      </h1>
    </div>
  );
}

/**
 * Consistent animated page header.
 *   <PageHeader eyebrow="Funding" title="Funding Requests" description="…" actions={<Button/>} />
 */
export default function PageHeader({ eyebrow, title, icon, description, actions, className = '' }) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <PageTitle eyebrow={eyebrow} icon={icon}>{title}</PageTitle>
        {description && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.25 }}
            className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base"
          >
            {description}
          </motion.p>
        )}
      </div>
      {actions && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
          className="flex flex-wrap items-center gap-2"
        >
          {actions}
        </motion.div>
      )}
    </div>
  );
}
