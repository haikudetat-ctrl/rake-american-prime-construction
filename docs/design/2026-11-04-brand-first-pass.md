# American Prime public website first pass

Based on the owner's 18 answers: redesign all four public pages, with American Prime as parent and equal emphasis on roofing and dumpsters. Homeowners are the primary audience. Direction: polished, modern, reliable, and warm rather than SaaS.

Use the supplied Drive American Prime logo, red-orange #EF3C23, charcoal, white and a soft neutral surface. Keep the existing AP Roofing and DropWise marks. They contain their original orange, which differs slightly from the supplied parent logo; no automated raster recoloring was applied. Large Bebas Neue headings and Cormorant Garamond introductory text follow the owner's preferred pairing; Inter body type reuses the root layout. The hierarchy references 2-stack.com, with clear scale differences and a prominent action.

Chosen implementation: native CSS modules and server components in the existing Next.js app. No added packages. A heavyweight component kit or animation library would add unnecessary weight for this scope. Motion is limited to hover feedback and FAQ state; reduced-motion preferences are respected. Native details elements provide FAQs and mobile menus.

Fuller homepage: equal service choices, company story, process, service area, contractor route, FAQs, closing actions. Roofing: stock-photo introduction, services, process, proposal explanation, verified warranty facts, actual job gallery when populated, service area and FAQs. Contractors retain contact/rate paths. Dumpsters retain 10/15/20-yard choices and request workflow, with the same shared chrome and visual system.

Hamilton means Hamilton Township near Trenton, Mercer County, as confirmed by the owner. Public copy describes the corridor to Atlantic City and approximately 50 miles north and south. Exact service availability is confirmed by address; no geographic guarantee or fabricated map boundary.

Only existing approved credentials: NJ HIC 13VH13312300, GAF systems, 10-year workmanship warranty. Preserve dynamic contact/catalog/job-photo data and existing request endpoints. Stock photography is introductory, never labeled completed work. No reviews, invented project photos, ratings, or unsupported claims.

Branch created from deployed production commit d49b8c8f14745ee2d5d7099f7b5f15760a83dbf4. Production deployment is separate from this branch work.
