import { onMount, onDestroy } from 'dartsx';
import { Link } from '../router';
import { Logo, Logomark } from './Logo';
import { MobileNavigation } from './MobileNavigation';
import { Navigation } from './Navigation';
import { Prose } from './Prose';
import { Search } from './Search';
import { ThemeSelector } from './ThemeSelector';
import { Hero } from './Hero';
import { docs, getDoc, getGroups } from '../docs';

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" class="h-6 w-6 fill-slate-400 group-hover:fill-slate-500 dark:group-hover:fill-slate-300">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

component Header() {
  state isScrolled = window.scrollY > 0;

  onMount(() => {
    function onScroll() {
      isScrolled = window.scrollY > 0;
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    onDestroy(() => window.removeEventListener('scroll', onScroll));
  });

  render (
    <header
      class={`sticky top-0 z-50 flex flex-wrap items-center justify-between bg-white px-4 py-5 shadow-md shadow-slate-900/5 transition duration-500 sm:px-6 lg:px-8 dark:shadow-none ${isScrolled ? 'dark:bg-slate-900/95 dark:backdrop-blur dark:[@supports(backdrop-filter:blur(0))]:bg-slate-900/75' : 'dark:bg-transparent'}`}
    >
      <div class="mr-6 flex lg:hidden">
        <MobileNavigation />
      </div>
      <div class="relative flex grow basis-0 items-center">
        <Link to="/" aria-label="Home page" class="no-underline">
          <Logomark className="h-9 w-9 lg:hidden" />
          <Logo className="hidden h-9 w-auto fill-slate-700 dark:fill-sky-100 lg:block" />
        </Link>
      </div>
      <div class="-my-5 mr-6 sm:mr-8 md:mr-0">
        <Search />
      </div>
      <div class="relative flex basis-0 justify-end gap-6 sm:gap-8 md:grow">
        <ThemeSelector className="relative z-10" />
        <a href="https://github.com/nicejs-is-cool/dartsx" class="group" aria-label="GitHub" target="_blank" rel="noopener">
          <GitHubIcon />
        </a>
      </div>
    </header>
  )
}

interface Heading {
  id: string;
  title: string;
  children: { id: string; title: string }[];
}

export component Layout(children: any) {
  state currentPath = window.location.pathname;

  navigation.addEventListener('navigate', (e) => {
    if (!e.canIntercept || e.hashChange || e.downloadRequest) return;
    const url = new URL(e.destination.url);
    currentPath = url.pathname;
  });

  derived isHomePage = currentPath === '/';
  derived currentSlug = currentPath.startsWith('/docs/') ? currentPath.slice(6) : '';
  derived currentDoc = currentSlug ? getDoc(currentSlug) : null;
  derived currentTitle = currentDoc ? currentDoc.title : '';
  derived allLinks = docs.map(d => ({ href: `/docs/${d.slug}`, title: d.title }));
  derived linkIndex = allLinks.findIndex(link => link.href === currentPath);
  derived previousPage = linkIndex > 0 ? allLinks[linkIndex - 1] : null;
  derived nextPage = linkIndex < allLinks.length - 1 ? allLinks[linkIndex + 1] : null;
  derived currentSection = (() => {
    const groups = getGroups();
    for (const g of groups) {
      for (const e of g.entries) {
        if (`/docs/${e.slug}` === currentPath) return g.name;
      }
    }
    return '';
  })();
  derived tableOfContents: Heading[] = (() => {
    const sections = currentDoc ? currentDoc.sections : [];
    const result: Heading[] = [];
    let current: Heading | null = null;
    for (const s of sections) {
      if (s.level === 2) {
        current = { id: s.slug, title: s.title, children: [] };
        result.push(current);
      } else if (s.level === 3 && current) {
        current.children.push({ id: s.slug, title: s.title });
      }
    }
    return result;
  })();

  // Table of contents active section tracking
  state activeTocId = '';

  onMount(() => {
    let observer: IntersectionObserver | null = null;

    function setupObserver() {
      if (observer) observer.disconnect();

      const headingEls = document.querySelectorAll('article h2[id], article h3[id]');
      if (headingEls.length === 0) return;

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              activeTocId = entry.target.id;
              break;
            }
          }
        },
        { rootMargin: '-80px 0px -80% 0px', threshold: 0 }
      );
      headingEls.forEach(el => observer!.observe(el));
    }

    requestAnimationFrame(() => setupObserver());
    navigation.addEventListener('navigatesuccess', () => {
      requestAnimationFrame(() => setupObserver());
    });
    onDestroy(() => { if (observer) observer.disconnect(); });
  });

  function isActive(tocEntry: Heading | { id: string; title: string }) {
    if (tocEntry.id === activeTocId) return true;
    if ('children' in tocEntry) {
      return (tocEntry as Heading).children.some(c => c.id === activeTocId);
    }
    return false;
  }

  render (
    <div class="flex w-full flex-col">
      <Header />

      {if (isHomePage) {
        <Hero />
      }}

      <div class="relative mx-auto flex max-w-8xl justify-center sm:px-2 lg:px-8 xl:px-12">
        <div class="hidden lg:relative lg:block lg:flex-none">
          <div class="absolute inset-y-0 right-0 w-[50vw] bg-slate-50 dark:hidden" />
          <div class="absolute top-16 bottom-0 right-0 hidden h-12 w-px bg-linear-to-t from-slate-800 dark:block" />
          <div class="absolute top-28 bottom-0 right-0 hidden w-px bg-slate-800 dark:block" />
          <div class="sticky top-[4.5rem] -ml-0.5 h-[calc(100vh-4.5rem)] overflow-y-auto overflow-x-hidden py-16 pl-0.5">
            <Navigation className="w-64 pr-8 xl:w-72 xl:pr-16" />
          </div>
        </div>
        <div class="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
          <article>
            {if (currentTitle || currentSection) {
              <header class="mb-9 space-y-1">
                {if (currentSection) {
                  <p class="font-display text-sm font-medium text-sky-500">{currentSection}</p>
                }}
                {if (currentTitle) {
                  <h1 class="font-display text-3xl tracking-tight text-slate-900 dark:text-white">{currentTitle}</h1>
                }}
              </header>
            }}
            <Prose>{children}</Prose>
          </article>
          <dl class="mt-12 flex border-t border-slate-200 pt-6 dark:border-slate-800">
            {if (previousPage) {
              <div>
                <dt class="font-display text-sm font-medium text-slate-900 dark:text-white">Previous</dt>
                <dd class="mt-1">
                  <Link to={previousPage.href} class="flex items-center gap-x-1 text-base font-semibold text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300 no-underline flex-row-reverse">
                    {previousPage.title}<svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4 flex-none fill-current -scale-x-100"><path d="m9.182 13.423-1.17-1.16 3.505-3.505H3V7.065h8.517l-3.506-3.5L9.181 2.4l5.512 5.511-5.511 5.512Z"></path></svg>
                  </Link>
                </dd>
              </div>
            }}
            {if (nextPage) {
              <div class="ml-auto text-right">
                <dt class="font-display text-sm font-medium text-slate-900 dark:text-white">Next</dt>
                <dd class="mt-1">
                  <Link to={nextPage.href} class="flex items-center gap-x-1 text-base font-semibold text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300 no-underline">
                    {nextPage.title}<svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4 flex-none fill-current"><path d="m9.182 13.423-1.17-1.16 3.505-3.505H3V7.065h8.517l-3.506-3.5L9.181 2.4l5.512 5.511-5.511 5.512Z"></path></svg>
                  </Link>
                </dd>
              </div>
            }}
          </dl>
        </div>
        <div class="hidden xl:sticky xl:top-[4.5rem] xl:-mr-6 xl:block xl:h-[calc(100vh-4.5rem)] xl:flex-none xl:overflow-y-auto xl:py-16 xl:pr-6">
          <nav aria-labelledby="on-this-page-title" class="w-56">
            {if (tableOfContents.length > 0) {
              <div>
                <h2 id="on-this-page-title" class="font-display text-sm font-medium text-slate-900 dark:text-white">On this page</h2>
                <ol role="list" class="mt-4 space-y-3 text-sm">
                  {for (const tocSection of tableOfContents) {
                    render (
                      <li key={tocSection.id}>
                        <h3>
                          <a
                            href={`#${tocSection.id}`}
                            class={isActive(tocSection) ? 'text-sky-500' : 'font-normal text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}
                          >
                            {tocSection.title}
                          </a>
                        </h3>
                        {if (tocSection.children.length > 0) {
                          <ol role="list" class="mt-2 space-y-3 pl-5 text-slate-500 dark:text-slate-400">
                            {for (const sub of tocSection.children) {
                              render (
                                <li key={sub.id}>
                                  <a
                                    href={`#${sub.id}`}
                                    class={isActive(sub) ? 'text-sky-500' : 'hover:text-slate-600 dark:hover:text-slate-300'}
                                  >
                                    {sub.title}
                                  </a>
                                </li>
                              )
                            }}
                          </ol>
                        }}
                      </li>
                    )
                  }}
                </ol>
              </div>
            }}
          </nav>
        </div>
      </div>
    </div>
  )
}
