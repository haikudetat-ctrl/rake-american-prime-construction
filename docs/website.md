# Public website

One Next.js app serves the operations system and the public site. The site contains three brands under `app/(site)/`. The November 2026 first pass uses the supplied
American Prime logo and red-orange #EF3C23, Bebas Neue headings, light serif introductions,
and a shared light theme across all four public pages. The parent homepage gives roofing and
dumpsters equal emphasis. See `docs/design/2026-11-04-brand-first-pass.md` and
`docs/design/image-sources.md` for the brief and asset provenance:

| Path | Brand | Who it's for | Main action |
| --- | --- | --- | --- |
| `/` | American Prime Construction | Anyone: picks a business | Links to the two below |
| `/roofing` | AP Roofing & Gutters | Homeowners | `/roof/roof` (Roofing Leads) |
| `/roofing/contractors` | AP Roofing & Gutters | Roofing contractors (labor-only crews) | Phone, text or email from Settings |
| `/dumpsters` | DropWise Dumpsters | Homeowners and contractors | `/request/dumpster` (Dumpster Requests) |

Every call to action goes to an existing Rake request link, so a website lead lands in the
same queue as every other lead. The estimate form takes `?need=` (`replacement`, `repair`,
`inspection`, `gutters`, `storm`, `other`) so each service row opens it preselected.

## What comes from Rake, and when it updates

`lib/site/content.ts` reads, once an hour or right after an edit in the office:

- **Phone and email** per brand (Settings → business name cards). Until they're filled in,
  no number appears anywhere, and the contractors page falls back to the estimate form.
- **Roofing systems and add-ons** from the active price list (Pricing). The proposal sheet on
  `/roofing` names them.
- **Past-job photos** (Settings → roofing page photos). A "Recent roofs" section appears on
  `/roofing` once there is at least one.

Saving any of these calls `revalidateTag("site-content")`. Without database credentials (a
local build) the pages still build, with those parts left out.

## Claims on the pages

Only what the business has confirmed: NJ HIC #13VH13312300, the 10-year workmanship warranty,
GAF systems from the price list, and the owner-confirmed Hamilton Township (Mercer County) to Atlantic City corridor,
extending approximately 50 miles north and south of that line. Availability is confirmed by address. Copy rules: no reviews, star ratings, customer counts, years in business, insurance
or town lists until Andre provides them.

## Search and sharing

- Each page sets its title, description, canonical URL and `index, follow`. Everything else
  stays `noindex` from the root layout, and `app/robots.ts` keeps crawlers out of staff
  screens and tokenized customer links.
- `app/sitemap.ts` lists the four pages. JSON-LD: Organization (`/`), RoofingContractor
  (`/roofing`), Service (`/roofing/contractors`), LocalBusiness (`/dumpsters`).
- Share images are `opengraph-image.png` files in each segment, made from the kit's logos.
- Vercel Web Analytics (`app/_components/site-analytics.tsx`) counts public pages and the
  request forms, never `/office`, `/driver`, `/crew`, `/login` or token links (`/p`, `/f`, `/r`).
  Turn it on in the Vercel project (Analytics tab) for data to show up.

## Domains

`APP_URL` is the main site's address (also used in texts and proposal links). A brand can get
its own domain later without code changes:

1. Add the domain to the Vercel project.
2. Set `DROPWISE_SITE_URL` (or `ROOFING_SITE_URL`) to `https://that-domain`.
3. Redeploy. The proxy serves the brand page at that domain's root (`/contractors` too, for
   roofing), and canonical URLs move there. Request links work on every domain.

## Open items before launch

- Phone and email for each brand in Settings (the setup sheet's "Phones and hours").
- The domain Andre already owns and its current host (setup sheet, "Website, email, and
  Google"), so the old site can be redirected rather than broken.
- Real job photos for `/roofing` (introductory stock photography is in place); a Google Business Profile for reviews.
- Whether the roofing brand on proposals should read "AP Roofing & Gutters" instead of
  "American Prime Construction" (one field in Settings).
- An "American Prime GC" with Google reviews already exists online; worth checking before
  choosing a domain or profile name.

## Public estimate forms (November 2026)

The roofing, dumpster, and roofing referral forms share a branded two-stage intake layout:
project details first, then contact details and send. Panels stay mounted to preserve typed
addresses, notes, photos, and optional roofing text consent when navigating Back or receiving
server validation errors. Native constraints and phone checks run before moving forward;
server validation remains authoritative. A server rejection moves focus to the affected step.
Transport failures remain in the form so the person can retry without losing entries.

Optional notes/photos are collapsed. Roofing has explicit photo-count/type checks before
compression; no photos are silently discarded. Dumpster size links pass `?size=10`, `15`, or
`20`, and the request page ignores other values. An unknown size remains a supported choice.
Dates are preferences, not bookings. Success screens explain the follow-up process.

No new packages, database changes, request slugs, consent wording, or lead routing changes.
No draft lead data is stored in browser storage.
