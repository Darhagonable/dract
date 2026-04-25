import { Link } from '../router';
import { getGroups } from '../docs';

export component Navigation(className: string = '') {
  const groups = getGroups();

  state currentPath = window.location.pathname;

  navigation.addEventListener('navigate', (e: NavigateEvent) => {
    if (!e.canIntercept || e.hashChange || e.downloadRequest) return;
    const url = new URL(e.destination.url);
    currentPath = url.pathname;
  });

  render (
    <nav class={`text-base lg:text-sm ${className}`}>
      <ul role="list" class="space-y-9">
        {for (const group of groups) {
          render (
            <li key={group.name}>
              <h2 class="font-display font-medium text-slate-900 dark:text-white">{group.name}</h2>
              <ul role="list" class="mt-2 space-y-2 border-l-2 border-slate-100 lg:mt-4 lg:space-y-4 lg:border-slate-200 dark:border-slate-800">
                {for (const entry of group.entries) {
                  const href = `/docs/${entry.slug}`;
                  render (
                    <li class="relative" key={entry.slug}>
                      <Link to={href} class={currentPath === href
                        ? 'no-underline block w-full pl-3.5 before:pointer-events-none before:absolute before:top-1/2 before:-left-1 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full font-semibold text-sky-500 before:bg-sky-500'
                        : 'no-underline block w-full pl-3.5 before:pointer-events-none before:absolute before:top-1/2 before:-left-1 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full text-slate-500 before:hidden before:bg-slate-300 hover:text-slate-600 hover:before:block dark:text-slate-400 dark:before:bg-slate-700 dark:hover:text-slate-300'}>
                        {entry.title}
                      </Link>
                    </li>
                  )
                }}
              </ul>
            </li>
          )
        }}
      </ul>
    </nav>
  )
}
