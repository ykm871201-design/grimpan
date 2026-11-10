import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint' | 'peach';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const V: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/30',
  secondary: 'bg-white text-ink-700 border border-ink-200 hover:bg-ink-50',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100',
  danger: 'bg-peach-500 text-white hover:bg-peach-600',
  mint: 'bg-mint-500 text-white hover:bg-mint-600 shadow-sm shadow-mint-500/30',
  peach: 'bg-peach-100 text-peach-700 hover:bg-peach-200',
};
const S: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-14 px-6 text-lg gap-2 rounded-2xl',
  xl: 'h-16 px-8 text-xl gap-3 rounded-2xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex select-none items-center justify-center font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${V[variant]} ${S[size]} ${className}`}
      {...rest}
    />
  );
}
