import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/site/config";

/**
 * "See our Terms of Use and Privacy Policy." with both linked, for every
 * form that collects a phone number. The words match CONSENT_POLICIES.
 * Opens in a new tab so a half-filled form isn't lost.
 */
export function PolicyLinks() {
  return (
    <>
      See our{" "}
      <Link href={`${LEGAL_PATHS.terms}#texts`} target="_blank" className="underline">Terms of Use</Link> and{" "}
      <Link href={LEGAL_PATHS.privacy} target="_blank" className="underline">Privacy Policy</Link>.
    </>
  );
}
