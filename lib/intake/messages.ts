/**
 * What the public request forms tell a person when the server turns a
 * submission down. Shared by the dumpster, roofing and referral forms; safe to
 * import in the browser.
 */

export type IntakeError = "invalid" | "rate_limited" | "past_date" | "failed";

/** Returned by a public form's server action instead of redirecting, so the form keeps what was typed. */
export type IntakeFailure = { error: IntakeError; fields?: string[] };

const FIELD_LABELS: Record<string, string> = {
  contactName: "your name",
  name: "your name",
  companyName: "company",
  phone: "mobile phone",
  email: "email",
  address: "address",
  town: "town",
  zip: "ZIP",
  requestedDate: "drop-off date",
  sizeYards: "size",
  notes: "notes",
  need: "what you need",
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function intakeErrorText(failure: IntakeFailure): string {
  switch (failure.error) {
    case "rate_limited":
      return "We've received several requests from you already. Call or text us instead.";
    case "past_date":
      return "Pick today or a later date.";
    case "failed":
      return "Something went wrong on our end. Please call or text us.";
    case "invalid": {
      const labels = [...new Set((failure.fields ?? []).map((f) => FIELD_LABELS[f]).filter(Boolean))];
      return labels.length
        ? `Check ${joinWords(labels)}, then send again.`
        : "Something in the form didn't go through. Check it and send again.";
    }
  }
}
