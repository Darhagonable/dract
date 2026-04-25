import { QuickLinks, QuickLink } from '../components/QuickLinks';
import { getDoc } from '../docs';
import { onMount } from 'dartsx';

const quickStartIcon = '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M16 2L6 28h4l2-6h8l2 6h4L16 2zm0 8l3 10h-6l3-10z" fill="#38BDF8" /><circle cx="16" cy="16" r="14" stroke="#38BDF8" stroke-width="2" stroke-dasharray="4 4" opacity="0.3" /></svg>';
const componentsIcon = '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="10" height="10" rx="2" fill="#38BDF8" opacity="0.5" /><rect x="18" y="4" width="10" height="10" rx="2" fill="#38BDF8" /><rect x="4" y="18" width="10" height="10" rx="2" fill="#38BDF8" /><rect x="18" y="18" width="10" height="10" rx="2" fill="#38BDF8" opacity="0.5" /></svg>';
const reactivityIcon = '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M13 2L3 18h10L17 30l10-16H17L13 2z" fill="#38BDF8" /><path d="M13 2L3 18h10L17 30l10-16H17L13 2z" fill="none" stroke="#38BDF8" stroke-width="1" opacity="0.3" /></svg>';
const howItWorksIcon = '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M16 6a2 2 0 012 2v1.17a8 8 0 014.24 2.45l1.01-.59a2 2 0 012.74.73l1 1.73a2 2 0 01-.73 2.73l-1.02.59a8.1 8.1 0 010 4.88l1.02.59a2 2 0 01.73 2.73l-1 1.73a2 2 0 01-2.74.73l-1.01-.59A8 8 0 0118 26.83V28a2 2 0 01-2 2h-2a2 2 0 01-2-2v-1.17a8 8 0 01-4.24-2.45l-1.01.59a2 2 0 01-2.74-.73l-1-1.73a2 2 0 01.73-2.73l1.02-.59a8.1 8.1 0 010-4.88l-1.02-.59a2 2 0 01-.73-2.73l1-1.73a2 2 0 012.74-.73l1.01.59A8 8 0 0112 9.17V8a2 2 0 012-2h2z" fill="#38BDF8" opacity="0.3" /><circle cx="16" cy="18" r="4" fill="#38BDF8" /></svg>';

export default component Home() {
  const doc = getDoc('introduction');

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
      <p class="lead">Learn how to get DarTsx set up in your project. Fine-grained reactivity. No virtual DOM. Unchallenged DX.</p>
      <QuickLinks>
        <QuickLink title="Quick Start" description="Step-by-step guides to setting up your system and installing the framework." href="/docs/quick-start" icon={quickStartIcon} />
        <QuickLink title="Components" description="Learn how to define components with the component keyword, props, and scoped styles." href="/docs/components" icon={componentsIcon} />
        <QuickLink title="Reactivity" description="Fine-grained reactivity with state and derived. Only the DOM that needs to change updates." href="/docs/reactivity" icon={reactivityIcon} />
        <QuickLink title="How It Works" description="Understand how the compiler transforms your code into efficient DOM operations at build time." href="/docs/how-it-works" icon={howItWorksIcon} />
      </QuickLinks>
      {if (doc) {
        <div innerHTML={doc.html} />
      }}
    </div>
  )
}
