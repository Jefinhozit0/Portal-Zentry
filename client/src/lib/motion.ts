/**
 * Small helpers for the portal's motion. Animations are CSS-first (see the "Motion" section of
 * index.css); these cover the few cases CSS cannot trigger on its own.
 */

/** True when the visitor asked the system to reduce motion (or the browser cannot tell us). */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** When the opening screen of index.html finishes its logo animation, counted from the page load. */
const INTRO_MS = 1750;

/**
 * Lifts the opening screen (index.html) once the logo animation is over and the portal has its
 * first real screen up: while the loading screen (BrandLoader) is showing, it keeps waiting, so the
 * curtain opens straight onto the login or the panel. If this never runs, the screen leaves on its
 * own after a few seconds.
 */
export function finishIntro() {
  const intro = document.getElementById("zentry-intro");
  if (!intro) return;
  const loading = () => document.querySelector(".brand-loader") !== null;
  // The login's entrance starts as the curtain begins to fade, so one runs into the other.
  const open = () => {
    intro.classList.add("zentry-intro-done");
    document.documentElement.classList.add("zentry-ready");
  };
  const lift = () => {
    if (!loading()) return open();
    const watch = new MutationObserver(() => {
      if (loading()) return;
      watch.disconnect();
      open();
    });
    watch.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
  };
  requestAnimationFrame(() => window.setTimeout(lift, Math.max(0, INTRO_MS - performance.now())));
}

/**
 * Replays a short fade/slide on elements that stay mounted but change content
 * (e.g. the login card switching between "entrar", "criar login" and "redefinir senha").
 * Uses the Web Animations API, so nothing is remounted and focus is untouched.
 */
export function playEnter(elements: Iterable<Element>, { distance = 6, duration = 240, stagger = 30 } = {}) {
  if (prefersReducedMotion()) return;
  let index = 0;
  for (const element of Array.from(elements)) {
    if (typeof (element as HTMLElement).animate !== "function") return;
    (element as HTMLElement).animate(
      [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "none" }],
      { duration, delay: index * stagger, easing: "cubic-bezier(.2, .7, .2, 1)", fill: "backwards" },
    );
    index += 1;
  }
}

/** Glass surfaces whose highlight follows the pointer ("Liquid glass" in index.css). */
const GLASS_SELECTOR = ".panel, .kpi-card, .action-panel, .ranking-card, .hub-metric, .hub-panel, .hub-filter-panel, .control-panel, .client-portal-card";

/**
 * Moves the soft highlight of the glass surface under the mouse to where the mouse is (--gx/--gy),
 * once per frame. Touch and pen leave it alone, and so does "reduzir movimento". Call once at start-up.
 */
export function startGlassLight() {
  if (prefersReducedMotion()) return;
  let pending: { target: HTMLElement; x: number; y: number } | null = null;
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>(GLASS_SELECTOR);
    if (!target) return;
    const schedule = pending === null;
    pending = { target, x: event.clientX, y: event.clientY };
    if (!schedule) return;
    requestAnimationFrame(() => {
      if (!pending) return;
      const { target: surface, x, y } = pending;
      pending = null;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty("--gx", `${x - box.left}px`);
      surface.style.setProperty("--gy", `${y - box.top}px`);
    });
  }, { passive: true });
}
