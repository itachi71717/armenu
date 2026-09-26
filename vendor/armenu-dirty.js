// Global unsaved-changes guard. Watches inputs/textareas/selects inside any
// element with class "wiz-card" (the modal chrome) or with data-track-dirty.
// If any of them change and the user tries to close the tab / reload / navigate
// away, we prompt them. Cleared automatically when a wiz save toast fires.
(function () {
  if (typeof window === 'undefined') return;
  const state = { dirty: new WeakSet(), snapshot: new WeakMap() };
  function snapshot(el) {
    return el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  }
  function markDirty(root) {
    root.querySelectorAll('input, textarea, select').forEach(el => {
      if (state.snapshot.has(el)) return;
      state.snapshot.set(el, snapshot(el));
      el.addEventListener('input', () => {
        if (snapshot(el) !== state.snapshot.get(el)) state.dirty.add(root);
      }, { passive: true });
    });
  }
  window.ArMenuDirty = {
    watch(rootEl) { if (rootEl) markDirty(rootEl); },
    clear(rootEl) { if (rootEl) state.dirty.delete(rootEl); },
    isDirty(rootEl) { return state.dirty.has(rootEl); }
  };
  // beforeunload — if any tracked root is dirty, prompt
  window.addEventListener('beforeunload', (e) => {
    for (const el of document.querySelectorAll('.wiz-card, [data-track-dirty]')) {
      if (state.dirty.has(el)) { e.preventDefault(); e.returnValue = ''; return; }
    }
  });
  // Watch new modals as they open (MutationObserver)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.classList?.contains('wiz-card') || n.querySelector?.('.wiz-card')) {
        const card = n.classList?.contains('wiz-card') ? n : n.querySelector('.wiz-card');
        if (card) markDirty(card);
      }
    }
  });
  if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
})();
