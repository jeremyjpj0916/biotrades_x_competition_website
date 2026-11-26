"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: "flexible";
      theme: "auto";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
      "unsupported-callback": () => void;
      "response-field": false;
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  siteKey,
  nonce,
  action,
  onToken,
}: {
  siteKey: string;
  nonce?: string;
  action: string;
  onToken: (token: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!loaded || !siteKey || !host.current) return;
    const api = window.turnstile;
    const failed = () => {
      onToken("");
      setError("Verification couldn't finish. Try again.");
    };
    try {
      if (!api) throw new Error("Turnstile script did not initialize");
      widgetId.current = api.render(host.current, {
        sitekey: siteKey,
        action,
        size: "flexible",
        theme: "auto",
        "response-field": false,
        callback: (token) => {
          setError("");
          onToken(token);
        },
        "error-callback": failed,
        "timeout-callback": failed,
        "unsupported-callback": failed,
        "expired-callback": () => {
          onToken("");
          if (widgetId.current) api.reset(widgetId.current);
        },
      });
    } catch {
      failed();
    }
    return () => {
      if (widgetId.current) api?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [loaded, siteKey, action, onToken]);
  if (!siteKey)
    return (
      <p className="notice" role="status">
        Account verification is unavailable. Please try again later.
      </p>
    );
  return (
    <div className="captcha-field" aria-label="Human verification">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        nonce={nonce}
        onReady={() => setLoaded(true)}
        onError={() => setError("Verification couldn't load. Reload the page to try again.")}
      />
      <div ref={host} />
      {error && (
        <div className="form-actions">
          <p className="alert" role="alert">
            {error}
          </p>
          {widgetId.current && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setError("");
                window.turnstile?.reset(widgetId.current!);
              }}
            >
              Retry verification
            </button>
          )}
        </div>
      )}
    </div>
  );
}
