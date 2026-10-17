import { type InputHTMLAttributes, forwardRef, useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  errorMessage?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      id: customId,
      label,
      helperText,
      errorMessage,
      className = '',
      required,
      disabled,
      'aria-describedby': customAriaDescribedBy,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const id = customId ?? generatedId;
    const helperId = `${id}-helper`;
    const errorId = `${id}-error`;

    const isInvalid = Boolean(errorMessage);

    const describedBy =
      [customAriaDescribedBy, errorMessage ? errorId : undefined, helperText ? helperId : undefined]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <div className="flex flex-col gap-1.5 w-full text-left">
        {label && (
          <label
            htmlFor={id}
            className="text-sm font-medium text-slate-700 flex items-center gap-1"
          >
            <span>{label}</span>
            {required && (
              <span className="text-red-500 text-xs" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <input
          ref={ref}
          id={id}
          required={required}
          disabled={disabled}
          aria-invalid={isInvalid ? true : undefined}
          aria-describedby={describedBy}
          className={`px-3 py-2 text-sm bg-white border rounded-lg transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
            isInvalid
              ? 'border-red-400 focus:border-red-500 focus:ring-red-300 text-red-900'
              : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-300 text-slate-900'
          } ${className}`}
          {...props}
        />

        {errorMessage && (
          <p id={errorId} role="alert" className="text-xs text-red-600 font-medium">
            {errorMessage}
          </p>
        )}

        {!errorMessage && helperText && (
          <p id={helperId} className="text-xs text-slate-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
