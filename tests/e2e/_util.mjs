// Collects uncaught page errors, ignoring known-benign network noise.
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => {
    if (!/ResizeObserver|AbortError|Failed to fetch|Load failed/i.test(e.message)) errors.push(e.message);
  });
  return errors;
}
