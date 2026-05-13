import { getDoc } from '../docs';
import { Link } from '../router';
import { onMount } from 'dartsx';

export default component DocPage(slug: string) {
  derived doc = getDoc(slug);

  let article: HTMLElement;

  onMount(() => {
    if (!article) return;
    for (const btn of article.querySelectorAll('.copy-btn')) {
      btn.addEventListener('click', () => {
        const code = btn.parentElement?.querySelector('code');
        if (code) navigator.clipboard.writeText(code.textContent || '');
      });
    }
  });

  render (
    <div bind:this={article}>
      {if (doc) (
        <div innerHTML={doc.html} />
      ) else (
        <div class="flex h-full flex-col items-center justify-center text-center">
          <p class="font-display text-sm font-medium text-slate-900 dark:text-white">404</p>
          <h1 class="mt-3 font-display text-3xl tracking-tight text-slate-900 dark:text-white">Page not found</h1>
          <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">No doc for "{slug}"</p>
          <Link to="/docs/introduction" class="mt-8 text-sm font-medium text-slate-900 dark:text-white no-underline">Go back home</Link>
        </div>
      )}
    </div>
  )
}
