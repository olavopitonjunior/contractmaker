"use client";

import { useEffect, useRef } from "react";

/**
 * Beacon client-side: dispara UMA vez no mount pra sinalizar "visualizada" (§9.1).
 * Bots/crawlers não executam JS, então só um humano real com browser bate aqui —
 * ao contrário do GET da página, que crawlers acionam.
 */
export function ViewBeacon({ token }: { token: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fetch(`/api/public/proposals/${token}/seen`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, [token]);
  return null;
}
