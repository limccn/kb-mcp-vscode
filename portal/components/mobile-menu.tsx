"use client";

import { useRef, type ReactNode } from "react";

export function MobileMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  function close() {
    if (ref.current) ref.current.open = false;
  }

  return (
    <details
      className="mobile-menu"
      ref={ref}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      {children}
    </details>
  );
}