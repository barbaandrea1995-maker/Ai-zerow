"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        void registration.update();
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      }).catch(() => undefined);
    }
  }, []);

  return null;
}
