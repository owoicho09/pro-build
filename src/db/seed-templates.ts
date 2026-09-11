// One-off seed for the 3 initial templates (spec: "the current catalogue
// only needs three strong initial templates"). Not wired into any
// automated flow — run manually once with:
//
//   pnpm tsx --env-file=.env.local src/db/seed-templates.ts
//
// Idempotent: upserts by slug, so it's safe to re-run after editing a
// build_prompt below.
//
// thumbnail_url / source_v0_project_id / source_v0_chat_id are left null —
// there is no "golden" reference build yet (each Use Template click
// currently regenerates from build_prompt directly; see
// src/lib/services/templates.ts). Once a golden build exists for each of
// these, set thumbnail_url to its captured screenshot and the source_v0_*
// fields to its ids, so future admin tooling (and a possible fork()-based
// Option B) has something to point at.
// Not importing lib/supabase/admin.ts here: it's guarded with `import
// "server-only"`, which throws when loaded outside Next.js's server
// bundling context (i.e. run directly via tsx, like this script is) — so
// this constructs the same service-role client inline instead.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const TEMPLATES = [
  {
    slug: "luxury-real-estate",
    name: "Meridian Estates",
    tagline: "A clean, modern real estate website for property listings and agents.",
    description:
      "An editorial, magazine-style real estate site built for boutique luxury brokerages — quiet typography, generous whitespace, and a single restrained accent color instead of typical listing-site clutter.",
    category: "Real Estate",
    sortOrder: 1,
    buildPrompt: `Build a luxury real estate website for "Meridian Estates", a boutique high-end property brokerage.

Visual direction: quiet, editorial luxury — like a fine architecture magazine, not a typical real-estate listings site. Base palette is deep charcoal (#1a1a1a) and warm ivory (#f7f5f0), with a single muted brass/gold accent (#a9885c) used sparingly for dividers, active states, and small details only — never as a dominant color. Typography: a refined display serif for headlines and property names, paired with a clean geometric sans-serif for body copy and UI labels; generous letter-spacing on all-caps labels like "FEATURED LISTINGS" and "SCHEDULE A TOUR". Spacing: very generous whitespace and large hero imagery; separate sections with tall vertical padding (120px+ on desktop) so each property feels presented, not crammed. Imagery: large, warm, architectural photography treatment throughout.

Pages:
1. Home — full-bleed hero with a rotating property photo and short tagline; a "Featured Listings" grid of 3 properties (large photography, price and key stats only); an "About Meridian" section with a founder photo and short editorial paragraph; a testimonials section styled as quiet pull-quotes (serif text and a name only, no star ratings or cards); a closing "Schedule a Private Consultation" section with a form.
2. Listings — a filterable grid of properties (filters: price range, bedrooms, location), each a tall image card revealing price, address, and beds/baths on hover.
3. Property Detail — a large image gallery at top, then two columns: description and feature list on the left, a sticky "Request a Private Tour" contact form on the right.
4. About — the brokerage's story and agent bios in a clean grid.
5. Contact — a form (name, email, phone, message) plus office address and hours.

Navigation: transparent header over the hero that becomes solid ivory on scroll; logo left, nav links (Listings, About, Contact) right with an underline-on-hover interaction, and an outlined brass-accent "Schedule a Tour" button.

Forms: minimal inputs with a bottom border only (no boxes), brass focus-state underline, labels above each field, and a clear confirmation message after submit.

Interactions: subtle fade-and-rise on scroll for section content; a gentle image zoom (about 1.03 scale, 400ms ease) on hover for listing cards. Keep all motion slow and deliberate — no bouncy or playful animation.

Mobile: hero text and imagery stack cleanly; the listings grid becomes a single column; the sticky tour-request form on property detail pages moves below the description instead of floating; the header collapses to a logo plus hamburger menu that opens a full-screen ivory nav overlay.`,
  },
  {
    slug: "premium-restaurant",
    name: "Ember & Oak",
    tagline: "A warm, refined website for restaurants, with menu, reservations and more.",
    description:
      "A moody, warm-toned restaurant site with a typographic menu, reservation flow, and chef's story — built for a fine-dining or chef-driven concept rather than a casual eatery template.",
    category: "Restaurant",
    sortOrder: 2,
    buildPrompt: `Build a website for "Ember & Oak", a chef-driven fine-dining restaurant.

Visual direction: warm and moody. Base palette is deep charcoal/near-black (#181512) and a rich burgundy (#3a1418), with a warm amber accent (#d99a3f) used for highlights, active states, and small dividers. Typography: a bold display serif or slab-serif for headings and the restaurant name, paired with a warm, readable sans-serif for body text and menu items. Imagery: large, warm, close-up food and interior photography — moody lighting, not bright/clinical food-blog style photos.

Pages:
1. Home — a full-bleed hero (photo or looping video) with the restaurant name and a one-line philosophy statement; a short "Our Philosophy" blurb; a "Chef's Picks" section highlighting 3–4 signature dishes with photo, name, and short description (no prices here); a prominent "Reserve a Table" call to action.
2. Menu — a categorized menu (Starters, Mains, Desserts, Drinks) styled as an elegant typographic list: dish name, short description, and price, no photos per item, matching fine-dining convention. Category tabs at the top to jump between sections.
3. Reservations — a form with date, time, party size, name, and contact info, plus a short note about private events and large parties.
4. Our Story — chef bio, restaurant history, and a short photo essay of the kitchen/dining room.
5. Private Events — a brief overview of event hosting with a contact prompt.
6. Contact — hours, location, phone, and an embedded map placeholder.

Navigation: a sticky dark header with the restaurant name centered as a wordmark, nav links split left and right of it (Menu, Reservations, Our Story | Private Events, Contact), and a "Reserve" button always visible in the header.

Interactions: a warm amber underline on nav-link hover; menu category tabs show an active-state amber underline; buttons darken slightly on hover with a soft transition (200ms). Forms use warm-toned inputs with clear labels and an amber focus outline.

Mobile: the menu's category tabs become a horizontally scrollable strip; the reservation form stacks to a single column; hours and location collapse into an expandable section on the Contact page; the header collapses to a wordmark plus hamburger menu.`,
  },
  {
    slug: "creative-portfolio-agency",
    name: "Foundry Studio",
    tagline: "A bold, minimal portfolio for creatives, agencies and freelancers.",
    description:
      "A confident, high-contrast portfolio/agency site built around oversized typography and a case-study-driven project index — for a design or creative studio, not a generic personal résumé site.",
    category: "Portfolio",
    sortOrder: 3,
    buildPrompt: `Build a portfolio/agency website for "Foundry Studio", a creative design studio.

Visual direction: bold and high-contrast. Base palette is near-black (#0d0d0d) and near-white (#f5f5f5), with a single saturated accent color (electric lime, #d4ff4f) used for links, highlights, and small interactive details. Typography: oversized, tightly-tracked display type for headlines (large enough to dominate the viewport on key sections), paired with a clean, neutral sans-serif for body copy and captions. Layout: strong grid structure, generous negative space between sections, and confident, editorial project presentation rather than dense portfolio-grid clutter.

Pages:
1. Home — a huge opening headline statement (e.g. the studio's positioning line), followed by a project showcase grid (4–6 projects, each a large image with the project name and category revealed on hover), a short "Capabilities" list (Brand, Product, Web, Motion — as a clean typographic list, not icon cards), a row of client logos, and a closing call-to-action to start a project.
2. Work — a full index of case studies as a grid, each item revealing its name and category on hover (or tap on mobile).
3. Case Study detail — a large hero image, then Problem / Approach / Outcome sections in sequence, an image gallery of the work, and a "Next Project" link at the bottom.
4. Studio — a team grid (photo, name, role) and a short philosophy statement.
5. Contact — a simple form (name, email, message) plus social links.

Navigation: a minimal fixed header with the studio wordmark on the left and a single "Menu" toggle on the right that opens a full-screen overlay navigation with large link type and small project thumbnails next to each link.

Interactions: hovering a project thumbnail on Home/Work reveals its name and category with a quick fade (150–200ms); buttons and key links invert color (background/foreground swap) on hover rather than just changing opacity, reinforcing the high-contrast identity.

Mobile: the full-screen overlay nav becomes a simpler stacked list (thumbnails hidden); the project grid becomes a single column, with a tap on a project revealing its name/category the same way hover does on desktop; oversized headline type scales down but stays bold and tightly tracked, never shrinking to a generic mobile size.`,
  },
];

async function main() {
  const supabase = createAdminClient();

  for (const template of TEMPLATES) {
    const { error } = await supabase.from("templates").upsert(
      {
        slug: template.slug,
        name: template.name,
        tagline: template.tagline,
        description: template.description,
        category: template.category,
        sort_order: template.sortOrder,
        build_prompt: template.buildPrompt,
        is_published: true,
      },
      { onConflict: "slug" },
    );

    if (error) {
      console.error(`Failed to seed template "${template.slug}":`, error);
      process.exitCode = 1;
      continue;
    }
    console.log(`Seeded template "${template.slug}"`);
  }
}

main();
