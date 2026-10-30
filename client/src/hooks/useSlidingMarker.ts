import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * Where the active item of a group sits (menu items, tabs), so one marker element can glide to it
 * instead of each item painting its own highlight. Measured from the container's own box after
 * every change listed in `deps` and on resize; null while there is no active item (or it is hidden).
 * The marker's CSS transitions `transform`, `width` and `height` (see ".nav-marker" and ".tab-marker").
 */
export function useSlidingMarker<T extends HTMLElement>(activeSelector: string, deps: unknown[]): [RefObject<T | null>, CSSProperties | null] {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const active = ref.current?.querySelector<HTMLElement>(activeSelector);
      if (!active || active.offsetWidth === 0) return setStyle(null);
      setStyle({ transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`, width: active.offsetWidth, height: active.offsetHeight });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, style];
}
