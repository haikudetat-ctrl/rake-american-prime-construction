import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";

const OFFICE = [
  { href: "/office/customers", label: "Customers", detail: "Billing contacts, emails and payment terms" },
  { href: "/office/numbers", label: "Reporting", detail: "This week's work, cash and balances" },
  { href: "/office/settings", label: "Settings", detail: "Prices, customer links, team and business names" },
];

const VIEWS = [
  { href: "/driver", label: "Driver view", detail: "Today's run, as a driver sees it" },
  { href: "/crew", label: "Crew view", detail: "Roofing jobs, as the crew sees them" },
];

/** More (phone tab): everything that is not daily work, plus the account. */
export default async function MorePage() {
  const member = await requireStaff();
  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow">More</p>
        <h1 className="page-title">Office tools</h1>
      </header>
      <section aria-labelledby="more-office" className="space-y-2.5">
        <h2 id="more-office" className="text-base">Office</h2>
        <WorkList label="Office">
          {OFFICE.map((i) => <WorkRow key={i.href} {...i} title={i.label} />)}
        </WorkList>
      </section>
      <section aria-labelledby="more-views" className="space-y-2.5">
        <h2 id="more-views" className="text-base">Field views</h2>
        <WorkList label="Field views">
          {VIEWS.map((i) => <WorkRow key={i.href} {...i} title={i.label} />)}
        </WorkList>
      </section>
      <section aria-labelledby="more-account" className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-border/60 bg-surface p-4 sm:px-[18px]">
        <div>
          <h2 id="more-account" className="sr-only">Account</h2>
          <p className="font-semibold break-words">{member.name}</p>
          <p className="text-sm text-muted">{member.role === "owner" ? "Owner" : "Office"}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="btn-secondary">Sign out</button>
        </form>
      </section>
    </>
  );
}
