import { z } from "zod";
import { toE164 } from "@/lib/phone";

/** Seconds a human needs, at minimum, to fill the form. Faster is a bot. */
export const MIN_FILL_SECONDS = 4;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

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
    address: z.string().trim().min(5).max(300),
    area: optionalText(120),
    lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
    lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
    placeId: optionalText(300),
    requestedDate: z.iso.date(),
    sizeYards: z.coerce.number().int().positive().max(60).optional().catch(undefined),
    notes: optionalText(1000),
    // Bot checks: a hidden field people never fill, and a signed render time.
    website: z.string().max(0).optional(),
    formToken: z.string().max(200),
  })
  .strict();

export type RentalRequestInput = z.infer<typeof rentalRequestSchema>;

export function isTooFast(renderedAt: number, now = Date.now()): boolean {
  return now - renderedAt < MIN_FILL_SECONDS * 1000;
}
