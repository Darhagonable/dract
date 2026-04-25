import { onMount, onCleanup } from 'dartsx';

component LightIcon(className: string = '') {
  render (
    <svg aria-hidden="true" viewBox="0 0 16 16" class={className}>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7 1a1 1 0 0 1 2 0v1a1 1 0 1 1-2 0V1Zm4 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm2.657-5.657a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm-1.415 11.313-.707-.707a1 1 0 0 1 1.415-1.415l.707.708a1 1 0 0 1-1.415 1.414ZM16 7.999a1 1 0 0 0-1-1h-1a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1ZM7 14a1 1 0 1 1 2 0v1a1 1 0 1 1-2 0v-1Zm-2.536-2.464a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm0-8.486A1 1 0 0 1 3.05 4.464l-.707-.707a1 1 0 0 1 1.414-1.414l.707.707ZM3 8a1 1 0 0 0-1-1H1a1 1 0 0 0 0 2h1a1 1 0 0 0 1-1Z" />
    </svg>
  )
}

component DarkIcon(className: string = '') {
  render (
    <svg aria-hidden="true" viewBox="0 0 16 16" class={className}>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7.23 3.333C7.757 2.905 7.68 2 7 2a6 6 0 1 0 0 12c.68 0 .758-.905.23-1.332A5.989 5.989 0 0 1 5 8c0-1.885.87-3.568 2.23-4.668ZM12 5a1 1 0 0 1 1 1 1 1 0 0 0 1 1 1 1 0 1 1 0 2 1 1 0 0 0-1 1 1 1 0 1 1-2 0 1 1 0 0 0-1-1 1 1 0 1 1 0-2 1 1 0 0 0 1-1 1 1 0 0 1 1-1Z" />
    </svg>
  )
}

component SystemIcon(className: string = '') {
  render (
    <svg aria-hidden="true" viewBox="0 0 16 16" class={className}>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1.5l.31 1.242c.084.333.36.573.63.808.091.08.182.158.264.24A1 1 0 0 1 11 15H5a1 1 0 0 1-.704-1.71c.082-.082.173-.16.264-.24.27-.235.546-.475.63-.808L5.5 11H4a3 3 0 0 1-3-3V4Zm3-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4Z" />
    </svg>
  )
}

const themes = [
  { name: 'Light', value: 'light' },
  { name: 'Dark', value: 'dark' },
  { name: 'System', value: 'system' },
] as const;

export component ThemeSelector(className: string = '') {
  state selectedTheme = window.localStorage.theme ?? 'system';
  state isOpen = false;

  function applyTheme(value: string) {
    if (value === 'system') {
      localStorage.removeItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', prefersDark);
    } else {
      localStorage.theme = value;
      document.documentElement.classList.toggle('dark', value === 'dark');
    }
  }

  onMount(() => {
    applyTheme(selectedTheme);

    const handler = () => {
      selectedTheme = window.localStorage.theme ?? 'system';
    };
    window.addEventListener('storage', handler);
    onCleanup(() => window.removeEventListener('storage', handler));

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-theme-selector]')) {
        isOpen = false;
      }
    };
    document.addEventListener('click', onClick);
    onCleanup(() => document.removeEventListener('click', onClick));
  });

  function select(value: string) {
    selectedTheme = value;
    isOpen = false;
    applyTheme(value);
  }

  function toggle() {
    isOpen = !isOpen;
  }

  render (
    <div class={`relative z-10 ${className}`} data-theme-selector>
      <button
        type="button"
        onclick={toggle}
        class="flex h-6 w-6 items-center justify-center rounded-lg shadow-md shadow-black/5 ring-1 ring-black/5 dark:bg-slate-700 dark:ring-inset dark:ring-white/5"
        aria-label={themes.find(t => t.value === selectedTheme)?.name ?? 'Theme'}
      >
        <LightIcon className={`h-4 w-4 ${selectedTheme === 'light' ? 'fill-sky-400' : 'hidden'}`} />
        <DarkIcon className={`h-4 w-4 ${selectedTheme === 'dark' ? 'fill-sky-400' : 'hidden'}`} />
        <LightIcon className={`h-4 w-4 ${selectedTheme === 'system' && !document.documentElement.classList.contains('dark') ? 'fill-slate-400' : 'hidden'}`} />
        <DarkIcon className={`h-4 w-4 ${selectedTheme === 'system' && document.documentElement.classList.contains('dark') ? 'fill-slate-400' : 'hidden'}`} />
      </button>
      {if (isOpen) {
        <div class="absolute top-full left-1/2 mt-3 w-36 -translate-x-1/2 space-y-1 rounded-xl bg-white p-3 text-sm font-medium shadow-md shadow-black/5 ring-1 ring-black/5 dark:bg-slate-800 dark:ring-white/5">
          {for (const theme of themes) {
            <button
              key={theme.value}
              type="button"
              onclick={() => select(theme.value)}
              class={`flex w-full cursor-pointer items-center rounded-[0.625rem] p-1 ${selectedTheme === theme.value ? 'text-sky-500' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900/40'}`}
            >
              <div class="rounded-md bg-white p-1 shadow ring-1 ring-slate-900/5 dark:bg-slate-700 dark:ring-inset dark:ring-white/5">
                {if (theme.value === 'light') {
                  <LightIcon className={`h-4 w-4 ${selectedTheme === theme.value ? 'fill-sky-400' : 'fill-slate-400'}`} />
                }}
                {if (theme.value === 'dark') {
                  <DarkIcon className={`h-4 w-4 ${selectedTheme === theme.value ? 'fill-sky-400' : 'fill-slate-400'}`} />
                }}
                {if (theme.value === 'system') {
                  <SystemIcon className={`h-4 w-4 ${selectedTheme === theme.value ? 'fill-sky-400' : 'fill-slate-400'}`} />
                }}
              </div>
              <div class="ml-3">{theme.name}</div>
            </button>
          }}
        </div>
      }}
    </div>
  )
}
