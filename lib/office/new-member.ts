import { toE164 } from "@/lib/phone";

/**
 * Roles an owner can give a new team member in Settings, in the order the
 * form lists them. Drivers and crew sign in with a texted code, so they need a
 * mobile; owners and office sign in by email.
 */
export const ADDABLE_ROLES = ["driver", "crew", "office", "owner"] as const;
export type AddableRole = (typeof ADDABLE_ROLES)[number];

export function isAddableRole(value: string): value is AddableRole {
  return (ADDABLE_ROLES as readonly string[]).includes(value);
}

export function signsInByPhone(role: AddableRole): boolean {
  return role === "driver" || role === "crew";
}

/** What's wrong with a new team member's details, or null when they can be added. */
export function newMemberProblem(input: { role: string; email: string | null; phone: string | null }): string | null {
  const { role, email, phone } = input;
  if (!isAddableRole(role)) return "Pick a role.";
  const e164 = phone ? toE164(phone) : null;
  if (phone && !e164) return "That phone number isn't a 10-digit US number.";
  if (signsInByPhone(role) && !e164) {
    return `${role === "crew" ? "Crew" : "Drivers"} sign in by phone; add their mobile number.`;
  }
  if (!signsInByPhone(role) && !email) return "Office and owners sign in by email; add their email.";
  return null;
}
