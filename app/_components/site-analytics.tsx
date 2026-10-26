"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Page views for the public site and the request forms, so a visit can be
 * followed from landing page to "thanks". Staff screens and customer links
 * that carry a private token are never reported.
 */
const PRIVATE = /^\/(office|driver|crew|login|auth|api|p|f|r)(\/|$)/;

function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    return PRIVATE.test(new URL(event.url).pathname) ? null : event;
  } catch {
    return null;
  }
}

export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
