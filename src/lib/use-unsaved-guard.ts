'use client';
import { useEffect } from 'react';

const MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * While `dirty` is true, leaving the page asks first:
 *  - in-app links (Next <Link>): a confirm dialog before navigating
 *  - the back/forward buttons: a confirm dialog; staying restores the URL
 *  - reload, closing the tab, typing a new address: the browser's own prompt
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // older browsers need this to show the prompt
    };

    // Capture phase on document runs before React/Next's own click handling.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return; // full page load: beforeunload handles it
      if (url.pathname === location.pathname && url.search === location.search) return; // same page (#hash)
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Back/forward: push a guard entry; if the user pops it, ask, and re-push to stay.
    history.pushState({ unsavedGuard: true }, '', location.href);
    const onPopState = () => {
      if (window.confirm(MESSAGE)) {
        window.removeEventListener('popstate', onPopState);
        history.back();
      } else {
        history.pushState({ unsavedGuard: true }, '', location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
