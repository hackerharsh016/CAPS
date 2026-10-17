import { type HTMLAttributes, forwardRef } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'urgent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  default: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    dot: 'bg-slate-400'
  },
  success: {
    bg: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500'
  },
  warning: {
    bg: 'bg-amber-50 text-amber-700 border border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500'
  },
  danger: {
    bg: 'bg-red-50 text-red-700 border border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500'
  },
  info: {
    bg: 'bg-blue-50 text-blue-700 border border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500'
  },
  urgent: {
    bg: 'bg-purple-100 text-purple-800 border border-purple-300 font-bold',
    text: 'text-purple-800',
    dot: 'bg-purple-600 animate-pulse'
  }
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', dot = false, children, ...props }, ref) => {
    const style = variantStyles[variant];

    return (
      <span
        ref={ref}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium select-none ${style.bg} ${style.text} ${className}`}
        {...props}
      >
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />}
        <span>{children}</span>
      </span>
    );
  }
);

Badge.displayName = 'Badge';
