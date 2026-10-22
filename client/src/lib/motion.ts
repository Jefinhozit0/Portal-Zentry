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
  const lift = () => {
    if (!loading()) return intro.classList.add("zentry-intro-done");
    const watch = new MutationObserver(() => {
      if (loading()) return;
      watch.disconnect();
      intro.classList.add("zentry-intro-done");
    });
    watch.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
  };
  requestAnimationFrame(() => window.setTimeout(lift, Math.max(0, INTRO_MS - performance.now())));
}

/** Panels that rise in when scrolled into view. */
const REVEAL_SELECTOR = ".page-content .panel, .hub-dashboard .panel";

/**
 * Makes panels that mount below the visible area rise in once they are scrolled into view.
 * Panels already on screen are left alone, and nothing is hidden unless the observer that will
 * show it again is in place. Call once at start-up.
 */
export function startScrollReveal() {
  if (prefersReducedMotion() || typeof IntersectionObserver !== "function" || typeof MutationObserver !== "function") return;
  const seen = new WeakSet<Element>();
  const onView = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      onView.unobserve(entry.target);
      entry.target.classList.remove("zentry-reveal-wait");
      entry.target.classList.add("zentry-reveal-in");
    }
  }, { rootMargin: "0px 0px -8% 0px" });

  const check = (panel: Element) => {
    if (seen.has(panel)) return;
    seen.add(panel);
    const { top, height } = panel.getBoundingClientRect();
    // Hidden tabs (no size) and panels that start on screen are not touched.
    if (height === 0 || top < window.innerHeight) return;
    panel.classList.add("zentry-reveal-wait");
    onView.observe(panel);
  };

  const scan = (root: ParentNode) => root.querySelectorAll(REVEAL_SELECTOR).forEach(check);
  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(REVEAL_SELECTOR)) check(node);
        scan(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
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
