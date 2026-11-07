# SOLSocial design system: Champagne & Titanium

Reference mockups in `designs/`: `champagne-gold-mockup.png` is the current direction; `initial-mockup.png` is the
earlier purple/mint exploration (superseded: we deliberately avoid a purple, Solana-branded look).
Tokens live in `app/globals.css` and are exposed to Tailwind as `canvas`, `surface`, `elevated`, `titanium`,
`chrome`, `champagne`, `ivory` (plus the existing semantic tokens: `primary`, `muted`, `border`, ...).

## Palette

A titanium-and-champagne hybrid: mostly monochrome, with gold reserved for important interactions and
metallic reflections.

| Token                | Hex       | Use                                                                |
| -------------------- | --------- | ------------------------------------------------------------------ |
| Obsidian (`canvas`)  | `#090A0B` | App background                                                     |
| Graphite (`surface`) | `#191B1E` | Cards, panels                                                      |
| Elevated             | `#24272B` | Popovers, hover, raised controls (derived)                         |
| Titanium             | `#858B90` | Supporting text, icons, hairlines                                  |
| Chrome               | `#DCE0E2` | Borders and grid (at low opacity), secondary emphasis              |
| Champagne            | `#D6B988` | Primary actions, focus ring, key states (live, selected, verified) |
| Ivory                | `#F5F1E8` | Foreground text                                                    |

In dark mode `--primary` and `--ring` are Champagne with near-black text (`#17130B`). The light theme is a
secondary mapping (ivory canvas, a darker gold for contrast); the app defaults to dark.
Functional states keep conventional colors where legibility matters (scan success/failure screens use green/red,
errors use `destructive`).

## Principles

- **Typography:** Geist for the product UI. Instrument Serif (`font-serif`) only for the wordmark and invitation
  moments, never for technical dashboards.
- **Shape:** 12-16px radii for app surfaces; fully rounded primary actions. **Avoid wrapping every individual value in a card.**
  Group related values in one surface separated by hairlines.
- **Color:** Champagne is rare and meaningful. Everything else is Obsidian, Graphite, Titanium, Chrome and Ivory.
- **Metal:** primary buttons use a vertical champagne gradient (`#ECDCB9` to `#D6B988` to `#B99A64`) with a 1px
  inner highlight; surfaces get hairline Chrome borders.
- **Motion:** subtle hover elevation, slow image reveals, a soft QR refresh animation. No constantly animated gradients.

## Screen-by-screen direction

| Screen         | Direction                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing        | Preserve the exact headline, dark grid, existing CTAs and product benefits. Add atmospheric event imagery without sacrificing the bold typography. |
| Events         | Replace generic event boxes with image-led editorial layouts, curated discovery, and filters for your network.                                     |
| Event details  | Builder Breakfast is the reference. Event imagery and the reservation CTA are prominent, with a compact financial breakdown.                       |
| Create         | A guided five-step experience: details, attendance and rewards, vendors, visibility, and publishing.                                               |
| Host dashboard | A refined operations console: attendance, escrow balance, payout breakdown, vendor approvals, recent activity.                                     |
| My tickets     | Collectible-looking event passes with a rotating QR, attendance status and payout history.                                                         |
| Network        | Verified shared attendance, social connections and access to private events.                                                                       |
| Vendor         | An event marketplace: sponsorship proposals, host approvals, delivery confirmation, payment tracking.                                              |

## Status

Done: champagne tokens, Geist + serif wordmark, grid background, favicon, event details page. Remaining screens above keep their previous layouts with the new colors.
