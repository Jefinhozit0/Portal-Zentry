import { useEffect, useState } from "react";

/** Shortest time the mark stays in the middle, so the shine is seen even when the portal is quick. */
const MIN_HOLD_MS = 650;
/** If the portal never says it is ready, the curtain opens anyway. */
const MAX_HOLD_MS = 9000;

/**
 * Right after signing in. The login ends with the brand mark in the middle of the screen; this curtain
 * shows the same mark in the same place and size while the portal loads behind it (so nothing jumps
 * from one screen to the next), then closes into the mark like an iris, and the portal comes in
 * around it (html.portal-revealing drives that entrance in index.css, see "After sign-in").
 * Ready means the loading screen and the login are both gone.
 */
export function PortalReveal({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const started = performance.now();
    const isReady = () => document.querySelector(".brand-loader, .login-page") === null;
    let timer = 0;
    const check = () => {
      const waited = performance.now() - started;
      if ((isReady() && waited >= MIN_HOLD_MS) || waited >= MAX_HOLD_MS) {
        document.documentElement.classList.add("portal-revealing");
        setLeaving(true);
        return;
      }
      timer = window.setTimeout(check, 80);
    };
    check();
    return () => window.clearTimeout(timer);
  }, []);

  function finish(event: React.AnimationEvent) {
    if (event.animationName !== "portal-reveal-out") return;
    // The portal's entrance runs a little longer than the curtain: let it end before clearing the class.
    window.setTimeout(() => document.documentElement.classList.remove("portal-revealing"), 900);
    onDone();
  }

  return (
    <div className={`portal-reveal ${leaving ? "is-leaving" : ""}`} aria-hidden="true" onAnimationEnd={finish}>
      <div className="portal-reveal-mark">
        <img src="/icons/icon-512.png" alt="" />
        <span className="login-mark-shine" />
      </div>
    </div>
  );
}
