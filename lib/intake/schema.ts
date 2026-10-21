import { z } from "zod";
import { isPlaceId } from "@/lib/integrations/places";
import { toE164 } from "@/lib/phone";

/** Seconds a human needs, at minimum, to fill the form. Faster is a bot. */
export const MIN_FILL_SECONDS = 4;

/** How long a rendered form may keep calling the address search. */
export const FORM_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/**
 * The address part of both public forms (see app/_components/address-field.tsx).
 *
 * Picked from the dropdown: `placeId` is set and `address` is the text the
 * person saw. The server looks the place up again, so neither is trusted.
 *
 * Typed by hand ("not listed?"): no `placeId`; `address` is the street line,
 * and town and ZIP are required so the geocoder can't wander into another ZIP.
 */
export const addressFields = {
  placeId: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v && isPlaceId(v) ? v : undefined)),
  address: z.string().trim().min(3).max(300),
  town: optionalText(120),
  zip: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(
      z
        .string()
        .regex(/^\d{5}(-\d{4})?$/)
        .transform((v) => v.slice(0, 5))
        .optional(),
    ),
};

export type AddressInput = { placeId?: string; address: string; town?: string; zip?: string };

/** A hand-typed address needs its town and ZIP; a picked one doesn't. */
export function requireTownAndZip(value: AddressInput, ctx: z.RefinementCtx) {
  if (value.placeId) return;
  if (!value.town) ctx.addIssue({ code: "custom", path: ["town"], message: "Enter the town." });
  if (!value.zip) ctx.addIssue({ code: "custom", path: ["zip"], message: "Enter the 5-digit ZIP." });
}

export const rentalRequestSchema = z
  .object({
    contactName: z.string().trim().min(2).max(120),
    companyName: optionalText(160),
    phone: z.string().transform((v, ctx) => {
      const e164 = toE164(v);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: "Enter a 10-digit phone number." });
        return z.NEVER;
      }
      return e164;
    }),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.email().optional()),
    ...addressFields,
    requestedDate: z.iso.date(),
    sizeYards: z.coerce.number().int().positive().max(60).optional().catch(undefined),
    notes: optionalText(1000),
    // Bot checks: a hidden field people never fill, and a signed render time.
    website: z.string().max(0).optional(),
    formToken: z.string().max(200),
  })
  .strict()
  .superRefine(requireTownAndZip);

export type RentalRequestInput = z.infer<typeof rentalRequestSchema>;

export function isTooFast(renderedAt: number, now = Date.now()): boolean {
  return now - renderedAt < MIN_FILL_SECONDS * 1000;
}
