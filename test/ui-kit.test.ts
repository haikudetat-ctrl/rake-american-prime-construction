import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
import { Callout } from "@/app/_ui/callout";
import { ConsequenceReview } from "@/app/_ui/consequence-review";
import { Field } from "@/app/_ui/field";
import { Icon } from "@/app/_ui/icon";
import { Empty, Skeleton, Unavailable } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import KitPage from "@/app/dev/kit/page";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("shared UI components", () => {
  it("keeps icons decorative unless they are labelled", () => {
    expect(html(h(Icon, { name: "inbox" }))).toContain('aria-hidden="true"');
    const labelled = html(h(Icon, { name: "inbox", label: "Inbox" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Inbox"');
    expect(labelled).not.toContain("aria-hidden");
  });

  it("renders a work row as a linked list item with its context", () => {
    const out = html(h(WorkList, { headings: ["Work / person", "Context / status"], label: "Billing", children: h(WorkRow, { href: "/office/billing/1", title: "Contractor A", detail: "3 completed rentals ready" }) }));
    expect(out).toContain('<ul aria-label="Billing"');
    expect(out).toMatch(/<li><a [^>]*href="\/office\/billing\/1"/);
    expect(out).toContain("Contractor A");
    expect(out).toContain("3 completed rentals ready");
    expect(out).toContain("Work / person");
  });

  it("shows a field error instead of its hint, and announces it", () => {
    const withHint = html(h(Field, { label: "Squares", hint: "From the report", children: h("input", { className: "input" }) }));
    expect(withHint).toContain("From the report");
    const withError = html(h(Field, { label: "Squares", hint: "From the report", error: "Enter squares", children: h("input", { className: "input" }) }));
    expect(withError).toContain('role="alert"');
    expect(withError).toContain("Enter squares");
    expect(withError).not.toContain("From the report");
  });

  it("maps pill and callout tones to the soft token pairs", () => {
    expect(html(h(StatusPill, { tone: "warning", children: "Proposed" }))).toContain("bg-warn-soft text-warn");
    expect(html(h(Callout, { tone: "danger", title: "Failed" }))).toContain('role="alert"');
    expect(html(h(Callout, { tone: "warning", title: "Note" }))).not.toContain("role=");
  });

  it("starts a consequence review locked until it is acknowledged", () => {
    const out = html(h(ConsequenceReview, { effects: ["Creates the invoice", "Does not pay workers"], acknowledgment: "I reviewed it", submitLabel: "Finish job" }));
    expect(out).toContain("Creates the invoice");
    expect(out).toContain("Does not pay workers");
    const checkbox = out.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
    expect(checkbox).toContain('required=""');
    expect(checkbox).toContain('name="acknowledged"');
    expect(checkbox).toContain('value="yes"');
    expect(out).toMatch(/<button type="submit" disabled=""/);
  });

  it("keeps loading, empty and unavailable visibly different", () => {
    expect(html(h(Skeleton, {}))).toContain('role="status"');
    expect(html(h(Empty, { title: "Nothing needs review" }))).not.toContain("unavailable");
    const failed = html(h(Unavailable, { area: "Subcontracting" }));
    expect(failed).toContain("Subcontracting is unavailable");
    expect(failed).toContain("Nothing here is shown as zero");
  });
});

describe("UI kit page", () => {
  const original = process.env.VERCEL_ENV;
  afterEach(() => { process.env.VERCEL_ENV = original; });

  it("is hidden on production deploys", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => KitPage()).toThrow("notFound");
  });

  it("renders on previews", () => {
    process.env.VERCEL_ENV = "preview";
    expect(html(KitPage())).toContain("Everyday work UI kit");
  });
});
