import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DropAction } from "@/app/driver/stop-actions";
import { messages } from "@/lib/i18n";

describe("driver photo button", () => {
  it("asks for the photo in the driver's language, not the browser's", () => {
    const html = renderToStaticMarkup(createElement(DropAction, { stopId: "s", date: "2026-11-11", cans: [], t: messages("es") }));
    expect(html).toContain("Tomar foto");
    expect(html).toContain("Foto de dónde quedó");
  });

  it("keeps the first photo required and both on the camera", () => {
    const html = renderToStaticMarkup(createElement(DropAction, { stopId: "s", date: "2026-11-11", cans: [], t: messages("en") }));
    const inputs = html.match(/<input[^>]*type="file"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('required=""');
    expect(inputs[1]).not.toContain("required");
    expect(inputs.every((i) => i.includes('capture="environment"'))).toBe(true);
  });
});
