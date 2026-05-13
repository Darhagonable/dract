import { effect, onDestroy } from 'dartsx';
import { docs, getDoc } from '../docs';

interface SearchResult {
  slug: string;
  title: string;
  group: string;
  section?: string;
  sectionSlug?: string;
}

function buildIndex(): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of docs) {
    results.push({ slug: entry.slug, title: entry.title, group: entry.group });
    const doc = getDoc(entry.slug);
    if (doc) {
      for (const s of doc.sections) {
        results.push({
          slug: entry.slug,
          title: entry.title,
          group: entry.group,
          section: s.title,
          sectionSlug: s.slug,
        });
      }
    }
  }
  return results;
}

let searchIndex: SearchResult[] | null = null;

function getIndex() {
  if (!searchIndex) searchIndex = buildIndex();
  return searchIndex;
}

function search(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const terms = query.toLowerCase().split(/\s+/);
  const index = getIndex();
  const scored: { result: SearchResult; score: number }[] = [];

  for (const result of index) {
    const text = `${result.title} ${result.section || ''} ${result.group}`.toLowerCase();
    let matched = true;
    let score = 0;
    for (const term of terms) {
      if (!text.includes(term)) {
        matched = false;
        break;
      }
      if (result.title.toLowerCase().includes(term)) score += 10;
      if (result.section?.toLowerCase().includes(term)) score += 5;
      if (result.group.toLowerCase().includes(term)) score += 1;
    }
    if (matched) scored.push({ result, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const { result } of scored) {
    const key = `${result.slug}#${result.sectionSlug || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }
  return deduped.slice(0, 20);
}

export default component SearchDialog(open: boolean, onClose: () => void) {
  state query = '';
  state activeIndex = 0;
  derived results = search(query);

  let inputEl: HTMLInputElement | undefined;
  let dialogEl: HTMLDivElement | undefined;

  effect(open, (isOpen) => {
    if (isOpen) {
      requestAnimationFrame(() => inputEl?.focus());
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });

  onDestroy(() => {
    document.body.style.overflow = '';
  });

  function navigate(result: SearchResult) {
    const hash = result.sectionSlug ? `#${result.sectionSlug}` : '';
    const url = `/docs/${result.slug}${hash}`;
    onClose();
    query = '';
    activeIndex = 0;
    navigation.navigate(url);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIndex < results.length - 1) activeIndex++;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex > 0) activeIndex--;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) navigate(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      query = '';
      activeIndex = 0;
    }
  }

  function onInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
    activeIndex = 0;
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      onClose();
      query = '';
      activeIndex = 0;
    }
  }

  if (open) render (
    <div
      bind:this={dialogEl}
      class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-slate-900/50 backdrop-blur-sm"
      onclick={onBackdropClick}
    >
      <div class="w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-slate-700">
        <div class="flex items-center border-b border-slate-200 px-4 dark:border-slate-700">
          <svg class="h-5 w-5 flex-none fill-slate-400" viewBox="0 0 20 20" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
          </svg>
          <input
            bind:this={inputEl}
            type="text"
            class="h-12 w-full border-0 bg-transparent pl-3 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none dark:text-white dark:placeholder-slate-500"
            placeholder="Search documentation..."
            value={query}
            oninput={onInput}
            onkeydown={onKeyDown}
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="hidden font-medium text-slate-400 dark:text-slate-500 sm:block">
            <kbd class="rounded border border-slate-300 px-1.5 py-0.5 font-sans text-xs dark:border-slate-600">Esc</kbd>
          </kbd>
        </div>
        {if (query.trim() && results.length === 0) (
          <div class="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No results for "<span class="font-semibold text-slate-900 dark:text-white">{query}</span>"
          </div>
        )}
        {if (results.length > 0) (
          <ul class="max-h-80 overflow-y-auto py-2">
            {for (const result of results; index i) (
              <li>
                <button
                  class={`flex w-full items-center px-4 py-2 text-left text-sm ${i === activeIndex ? 'bg-sky-500 text-white' : 'text-slate-700 dark:text-slate-300'}`}
                  onmouseenter={() => { activeIndex = i; }}
                  onclick={() => navigate(result)}
                >
                  <div class="flex-auto">
                    {if (result.section) (
                      <div class={`text-xs ${i === activeIndex ? 'text-sky-200' : 'text-slate-400 dark:text-slate-500'}`}>
                        {result.title}
                      </div>
                      <div class="font-medium">{result.section}</div>
                    )}
                    {if (!result.section) (
                      <div class="font-medium">{result.title}</div>
                    )}
                  </div>
                  <div class={`flex-none text-xs ${i === activeIndex ? 'text-sky-200' : 'text-slate-400 dark:text-slate-500'}`}>
                    {result.group}
                  </div>
                </button>
              </li>
            )}
          </ul>
        )}
        {if (!query.trim()) (
          <div class="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Type to search the documentation
          </div>
        )}
      </div>
    </div>
  )
}
