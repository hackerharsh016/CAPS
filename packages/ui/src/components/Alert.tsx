import { type HTMLAttributes, forwardRef } from 'react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

const variantStyles: Record<AlertVariant, { container: string; title: string; text: string }> = {
  info: {
    container: 'bg-blue-50 border-blue-200 text-blue-900',
    title: 'text-blue-900',
    text: 'text-blue-700'
  },
  success: {
    container: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    title: 'text-emerald-900',
    text: 'text-emerald-700'
  },
  warning: {
    container: 'bg-amber-50 border-amber-200 text-amber-900',
    title: 'text-amber-900',
    text: 'text-amber-700'
  },
  error: {
    container: 'bg-red-50 border-red-200 text-red-900',
    title: 'text-red-900',
    text: 'text-red-700'
  }
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className = '', variant = 'info', title, children, ...props }, ref) => {
    const style = variantStyles[variant];

    return (
      <div
        ref={ref}
        role="alert"
        className={`p-4 rounded-xl border text-sm flex flex-col gap-1 text-left ${style.container} ${className}`}
        {...props}
      >
        {title && <h4 className={`font-semibold ${style.title}`}>{title}</h4>}
        {children && <div className={`${style.text}`}>{children}</div>}
      </div>
    );
  }
);

Alert.displayName = 'Alert';
