import { onMount, onCleanup } from 'dartsx';
import { Logomark } from './Logo';
import { Navigation } from './Navigation';
import { Link } from '../router';

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" class="h-6 w-6 stroke-slate-500">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" class="h-6 w-6 stroke-slate-500">
      <path d="M5 5l14 14M19 5l-14 14" />
    </svg>
  )
}

export component MobileNavigation() {
  state isOpen = false;

  navigation.addEventListener('navigatesuccess', () => {
    isOpen = false;
  });

  function open() { isOpen = true; }
  function close() { isOpen = false; }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) close();
    }
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  render (
    <div>
      <button type="button" onclick={open} class="relative" aria-label="Open navigation">
        <MenuIcon />
      </button>
      {if (isOpen) (
        <div
          class="fixed inset-0 z-50 flex items-start overflow-y-auto bg-slate-900/50 pr-10 backdrop-blur lg:hidden"
          aria-label="Navigation"
          onclick={onBackdropClick}
        >
          <div class="min-h-full w-full max-w-xs bg-white px-4 pt-5 pb-12 dark:bg-slate-900 sm:px-6">
            <div class="flex items-center">
              <button type="button" onclick={close} aria-label="Close navigation">
                <CloseIcon />
              </button>
              <Link to="/" class="ml-6 no-underline" aria-label="Home page">
                <Logomark className="h-9 w-9" />
              </Link>
            </div>
            <Navigation className="mt-5 px-1" />
          </div>
        </div>
      )}
    </div>
  )
}
