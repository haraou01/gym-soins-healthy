import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export function Button({
  className,
  variant = 'default',
  size = 'md',
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}) {
  const variants = {
    default: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    outline:
      'border border-line-strong bg-card text-content hover:bg-surface-raised',
    ghost:
      'text-content-muted hover:bg-surface-overlay hover:text-content',
  };
  const sizes = {
    sm: 'h-8 gap-1.5 px-3 text-xs',
    md: 'h-10 gap-2 px-4 text-sm',
    lg: 'h-12 gap-2 px-6 text-base',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-content transition-colors placeholder-content-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-content-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-content transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-content-subtle',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-content transition-colors placeholder-content-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-content-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-card p-6 text-content shadow-card transition-colors dark:shadow-glass',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variants = {
    default: 'border-line bg-surface-overlay text-content',
    success:
      'border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300',
    warning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    danger:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  tone,
  children,
  className,
}: {
  tone: 'error' | 'success';
  children: React.ReactNode;
  className?: string;
}) {
  const toneClasses =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
  const Icon = tone === 'error' ? AlertTriangle : CheckCircle2;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm transition-colors',
        toneClasses,
        className,
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export type StatTone =
  | 'brand'
  | 'purple'
  | 'blue'
  | 'emerald'
  | 'amber'
  | 'red';

const STAT_TONES: Record<StatTone, string> = {
  brand: 'border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-500',
  purple:
    'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  amber:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-line bg-card p-5 shadow-card transition-colors dark:shadow-glass">
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border',
          STAT_TONES[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-content-subtle">
          {label}
        </div>
        <div className="text-2xl font-semibold text-content">{value}</div>
        <div className="truncate text-xs text-content-subtle">{hint}</div>
      </div>
    </div>
  );
}

export { FeatureGate } from './FeatureGate';
