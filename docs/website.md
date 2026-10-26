# Public website

One Next.js app serves the operations system and the public site. The site is three brands
from the 2Stack branding kit (Oct 2026), all under `app/(site)/`:

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
GAF systems from the price list, and the Atlantic City area (the existing page and the Atlantic
City yard). Copy rules: no reviews, star ratings, customer counts, years in business, insurance
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
- Real job photos for `/roofing`; a Google Business Profile for reviews.
- Whether the roofing brand on proposals should read "AP Roofing & Gutters" instead of
  "American Prime Construction" (one field in Settings).
- An "American Prime GC" with Google reviews already exists online; worth checking before
  choosing a domain or profile name.
