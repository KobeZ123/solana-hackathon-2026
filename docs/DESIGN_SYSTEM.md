# SOLSocial design system: "After Dark" (V2)

Reference mockup: `designs/initial-mockup` (PNG, extensionless). Tokens live in `app/globals.css` and are exposed to
Tailwind as `canvas`, `surface`, `elevated`, `lavender`, `mint` (plus the existing semantic tokens).

## Tokens

| Token    | Hex       | Use                                                    |
| -------- | --------- | ------------------------------------------------------ |
| Canvas   | `#09090B` | App background                                         |
| Surface  | `#17171B` | Cards, panels                                          |
| Elevated | `#232127` | Popovers, hover, raised controls                       |
| Lavender | `#BFA5ED` | Key interactions: primary actions, links, focus        |
| Mint     | `#A5D3B2` | Successful settlement, verified attendance, live state |

Neutrals carry supporting content. In dark mode `--primary` is Lavender, `--ring` is Lavender.

## Principles

- **Typography:** Geist for bold, modern product UI. Instrument Serif sparingly for invitation moments, never for
  technical dashboards (not yet used).
- **Shape:** 12-16px radii for app surfaces; fully rounded primary actions. **Avoid wrapping every individual value in a card.**
  Group related values in one surface separated by hairlines.
- **Color:** Lavender for key interactions, mint for settlement and verified attendance, neutrals for the rest.
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

Done: tokens + Geist, event details page. Remaining screens above still use the previous layout with the new colors.
