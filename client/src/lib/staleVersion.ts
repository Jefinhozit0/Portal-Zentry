/**
 * After a deploy the page files get new names. A tab opened before it still asks for the old
 * names and the browser fails to load that part of the portal. Reloading picks up the new version.
 */

// Chrome/Edge, Safari and Firefox word this error differently.
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleVersionError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return STALE_CHUNK.test(message);
}

const KEY = "zentry-reloaded-for-new-version";
const MIN_INTERVAL_MS = 30_000;

/**
 * Reloads the page, at most once every 30 seconds, so a file that is really missing cannot cause
 * a reload loop. Returns false when it already tried recently.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Without sessionStorage there is no way to avoid a loop, so leave it to the button.
    return false;
  }
  window.location.reload();
  return true;
}
