"use client";

import { forwardRef } from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  loading?: boolean;
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[var(--base-blue)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--base-blue-hover)] active:scale-[0.98]",
  ghost:
    "bg-transparent text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]",
  outline:
    "bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)] active:scale-[0.98]",
  danger:
    "bg-[var(--surface)] border border-[var(--border)] text-[var(--danger)] hover:bg-[var(--danger-soft)] hover:border-[var(--danger)] active:scale-[0.98]",
};

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-[var(--background)] ${variants[variant]} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      )}
      {children}
    </button>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, FieldProps>(function Input(
  { label, hint, className = "", id, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      <span className="block text-[13px] font-medium text-[var(--foreground)]">
        {label}
      </span>
      <input
        {...props}
        id={inputId}
        ref={ref}
        className={`w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] outline-none transition-all focus:border-[var(--base-blue)] focus:shadow-[var(--ring)] ${className}`}
      />
      {hint && (
        <span className="block text-[12px] leading-snug text-[var(--muted)]">
          {hint}
        </span>
      )}
    </label>
  );
});

type TextareaProps = {
  label: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({
  label,
  className = "",
  id,
  ...props
}: TextareaProps) {
  const inputId = id ?? props.name;
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      <span className="block text-[13px] font-medium text-[var(--foreground)]">
        {label}
      </span>
      <textarea
        {...props}
        id={inputId}
        className={`w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-2)] outline-none transition-all focus:border-[var(--base-blue)] focus:shadow-[var(--ring)] ${className}`}
      />
    </label>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ${className}`}
    >
      {children}
    </div>
  );
}

type SelectProps = {
  label: string;
  hint?: string;
  options: { label: string; value: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({
  label,
  hint,
  options,
  className = "",
  id,
  ...props
}: SelectProps) {
  const inputId = id ?? props.name;
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      <span className="block text-[13px] font-medium text-[var(--foreground)]">
        {label}
      </span>
      <select
        {...props}
        id={inputId}
        className={`w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] outline-none transition-all focus:border-[var(--base-blue)] focus:shadow-[var(--ring)] ${className}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="block text-[12px] leading-snug text-[var(--muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}

type ToggleFieldProps = {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

/** A labelled toggle switch used for boolean options like discoverability. */
export function Toggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--foreground)]">
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[12px] leading-snug text-[var(--muted)]">
            {hint}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-[var(--background)] ${
          checked
            ? "border-[var(--base-blue)] bg-[var(--base-blue)]"
            : "border-[var(--border)] bg-[var(--surface-2)]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform duration-150 ${
            checked ? "translate-x-[22px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

type SegmentedProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
};

/** A compact two/three-way toggle, e.g. Free vs Paid. */
export function Segmented({ label, value, onChange, options }: SegmentedProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <span className="block text-[13px] font-medium text-[var(--foreground)]">
          {label}
        </span>
      )}
      <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-[calc(var(--radius-sm)-2px)] px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
