import { z } from "zod";
import { addressFields, requireTownAndZip } from "@/lib/intake/schema";
import { toE164 } from "@/lib/phone";

export const STAGES = ["new", "contacted", "appointment", "proposal_sent", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  contacted: "Contacted",
  appointment: "Appointment set",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export const NEEDS = ["replacement", "repair", "inspection", "gutters", "storm", "other"] as const;
export type Need = (typeof NEEDS)[number];

export const NEED_LABEL: Record<Need, string> = {
  replacement: "Roof replacement",
  repair: "Leak or repair",
  inspection: "Inspection / estimate",
  gutters: "Gutters",
  storm: "Storm damage",
  other: "Something else",
};

export const SOURCE_LABEL: Record<string, string> = {
  link: "Request link",
  phone: "Phone call",
  text: "Text",
  office: "Entered by office",
  referral: "Referral",
};

/**
 * Shown next to the checkbox and stored with the lead word for word, so the
 * record shows exactly what the homeowner agreed to. It names who will text,
 * what about, frequency, rates, STOP and HELP, and points to the Terms and
 * Privacy Policy, which is what carriers' A2P 10DLC reviewers look for. It
 * also covers follow-ups (feedback and referral texts), which are closer to
 * marketing than to the job itself. Not legal advice.
 */
export const CONSENT_BODY =
  "I agree that American Prime Construction (Authority Roofing) may call and text me at this number about my request and job, and with follow-ups such as feedback requests and referral offers, including by automated technology. Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.";
/** The last sentence; the form links its two names. */
export const CONSENT_POLICIES = "See our Terms of Use and Privacy Policy.";
export const CONTACT_CONSENT = `${CONSENT_BODY} ${CONSENT_POLICIES}`;

/** Homeowner photos on the public form. */
export const MAX_PHOTOS = 4;
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const phone = z.string().transform((v, ctx) => {
  const e164 = toE164(v);
  if (!e164) {
    ctx.addIssue({ code: "custom", message: "Enter a 10-digit phone number." });
    return z.NEVER;
  }
  return e164;
});

const email = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.email().optional());

export const leadRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone,
    email,
    ...addressFields,
    need: z.enum(NEEDS).catch("other"),
    notes: optionalText(2000),
    consent: z.literal("on").optional(),
    // Bot checks: a hidden field people never fill, and a signed render time.
    website: z.string().max(0).optional(),
    formToken: z.string().max(200),
  })
  .strict()
  .superRefine(requireTownAndZip);

export type LeadRequestInput = z.infer<typeof leadRequestSchema>;

/** Office entry: phone or email, address optional (a caller may not give one yet). */
export const officeLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().optional().transform((v) => (v ? v : undefined)).pipe(phone.optional()),
    email,
    address: optionalText(300),
    need: z.enum(NEEDS).catch("other"),
    notes: optionalText(2000),
    source: z.enum(["phone", "text", "office", "referral"]).catch("office"),
  })
  .refine((v) => v.phone || v.email, { message: "Enter a phone number or an email.", path: ["phone"] });

/** Days a lead has sat in its stage, for the board. */
export function daysInStage(stageChangedAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / 86_400_000));
}

/** A lead needs a nudge: new and untouched for a day, or a proposal unanswered for a week. */
export function needsAttention(stage: Stage, stageChangedAt: string, now: Date = new Date()): boolean {
  const days = daysInStage(stageChangedAt, now);
  return (stage === "new" && days >= 1) || (stage === "proposal_sent" && days >= 7);
}

/** Won ÷ (won + lost), as a whole percent; null until something has closed. */
export function winRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : Math.round((won / (won + lost)) * 100);
}
