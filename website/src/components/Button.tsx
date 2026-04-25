import { Link } from '../router';

const styles = {
  primary:
    'rounded-full bg-sky-300 py-2 px-4 text-sm font-semibold text-slate-900 hover:bg-sky-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300/50 active:bg-sky-500 no-underline',
  secondary:
    'rounded-full bg-slate-800 py-2 px-4 text-sm font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 active:text-slate-400 no-underline',
} as const;

export component Button(variant: 'primary' | 'secondary' = 'primary', className: string = '', href: string = '', children: any) {
  derived cls = `${styles[variant]} ${className}`;

	if (href) {
		render <Link to={href as any} class={cls}>{children}</Link>
	}
	else {
		render <button class={cls}>{children}</button>
	}
}
