import { describe, expect, it } from "vitest";
import {
  aftercareWarrantyEmail,
  aftercareWarrantySms,
  feedbackFollowupSms,
  feedbackRequestSms,
  referralEarnedSms,
  referralInviteSms,
  referralPaidSms,
  rewardOwedSms,
} from "@/lib/outbox/messages";

const brand = { name: "American Prime Construction", phone: "+16095550000" };

describe("aftercare messages", () => {
  it("sends the warranty with the signed agreement link", () => {
    expect(aftercareWarrantySms({ name: "Pat Homeowner", system: "GAF Timberline HDZ", link: "https://app/p/t" }, brand))
      .toBe("American Prime Construction: thank you, Pat! Your new GAF Timberline HDZ roof is done. Your warranty and signed agreement: https://app/p/t Reply STOP to opt out.");
    const email = aftercareWarrantyEmail({ name: "Pat Homeowner", system: "GAF Timberline HDZ", warranty: "Lifetime limited" }, brand);
    expect(email.text).toContain("Warranty:\nLifetime limited");
    expect(email.text).not.toContain("\n\n\n");
  });

  it("asks how we did, then invites referrals with the reward", () => {
    expect(feedbackRequestSms({ name: "Pat", link: "https://app/f/x" }, brand))
      .toBe("American Prime Construction: hi Pat, how did we do on your roof? One tap to tell us: https://app/f/x");
    expect(referralInviteSms({ name: "Pat", link: "https://app/r/ABCD2345", rewardCents: 15000 }, brand))
      .toContain("you get $150.00: https://app/r/ABCD2345");
  });

  it("thanks the referrer when earned and when paid", () => {
    expect(referralEarnedSms({ name: "Pat", friend: "Sam Lee", rewardCents: 10000 }, brand))
      .toBe("American Prime Construction: Pat, Sam's new roof is done, so you've earned $100.00. We'll send it shortly. Thank you!");
    expect(referralPaidSms({ name: "Pat", friend: "Sam Lee", rewardCents: 10000, method: "gift_card" }, brand))
      .toBe("American Prime Construction: your $100.00 referral reward was sent as a gift card. Thanks for sending Sam our way!");
  });

  it("alerts the owner", () => {
    expect(feedbackFollowupSms({ name: "Pat", rating: "poor", comment: "Nails in the driveway", jobId: "J1" }, "https://app"))
      .toBe('Pat rated their roof job "poor": "Nails in the driveway". Call them back: https://app/office/jobs/J1');
    expect(rewardOwedSms({ referrer: "Pat", friend: "Sam", rewardCents: 10000 }, "https://app"))
      .toBe("Referral reward owed: $100.00 to Pat (Sam paid in full). https://app/office/referrals");
  });
});
