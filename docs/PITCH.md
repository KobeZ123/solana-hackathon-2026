# SOLSocial: pitch, talking points, and copy

**Tagline:** Event hosting and community-building, on-chain.
**One-liner:** SOLSocial turns every RSVP into a payment, so hosts know who is really coming, the event is funded before it starts, and the people who show up get rewarded.

> Honest-claims rule for every talking point below: say only what the app does today. Where something is
> a design choice or a limitation, the "Be upfront about" notes say how to put it.

---

## 1. The problem (30 seconds)
Planning a community event is mostly guesswork and chasing people:
- **RSVPs are free, so they're meaningless.** A "yes" on a form costs nothing, and 30-50% of people don't show up.
- **The host fronts the money.** Venue, food, supplies: all paid before anyone commits.
- **Check-in and payouts are manual.** Paper lists, screenshots of tickets passed around, vendors waiting to be paid by Venmo after.
- **Communities don't compound.** Showing up to an event doesn't make it easier to find the next one.

## 2. The idea
Use Solana transactions as the planning tool. One small on-chain payment does four jobs at once:

| Planning pain | What SOLSocial does with a transaction |
|---|---|
| Don't know the real headcount | Joining *is* a payment. Tickets sold = committed guests, live on the host dashboard. |
| Host fronts the cost | Entry fees pool into an on-chain escrow. The event is funded by the people coming. |
| No-shows | A share of the pool (10-50%, set by the host and fixed on-chain) is split among people who actually show up. Showing up pays. |
| Fake or shared tickets, slow door | The ticket is a signed QR that refreshes every 20 seconds. Scanning verifies it and records check-in on-chain, with no wallet popups at the door. |
| Paying vendors | A vendor proposes a sponsorship, the host approves it, a delivery QR is scanned, and the vendor is paid from the pool. No invoices to chase. |
| Finding the next event | Events can be visible only to people you have attended events with. Showing up widens your circle. |

**Why Solana specifically:** the whole thing is many tiny transactions (join, check in, claim, settle). At a fraction of a cent each and about a second to confirm, that is practical. The escrow rules live in a program, so nobody has to trust the host to hold the money fairly.

## 3. Elevator pitch (30 seconds, speakable)
"Event planning runs on guesswork: free RSVPs that mean nothing, hosts paying up front, and a mess at the door. SOLSocial makes the RSVP a small Solana payment. Fees pool into an on-chain escrow, so the event is funded by the people coming and the host knows the real headcount. At the door, a rotating QR code checks you in on-chain. After the event, everyone who showed up splits a share of the pool, so showing up literally pays. And because attendance is on-chain, your next invite comes from people you've actually been in a room with."

## 4. Demo script (2-3 minutes)
1. **Create** (host): "Rooftop Meetup," 0.1 SOL entry, 30% to attendees. *Say:* "The payout split is locked on-chain. I can't change it later."
2. **Join** (two members): the pool balance climbs live, and details unlock after joining. *Say:* "Tickets sold equals committed guests, not maybes."
3. **Door**: member opens the rotating QR, host scans, green check, tx link. Show an old screenshot getting rejected. *Say:* "No paper list, and a screenshot is useless after 20 seconds."
4. **After**: end event, attendees claim their share, host withdraws the budget. *Say:* "Show up, get paid."
5. **Stretch**: a vendor proposes a sponsorship, the host approves it, a delivery QR is scanned, and the vendor is paid from the pool. Then the network page: "attend one more event to unlock N events."

## 5. Talking points by theme
**Planning made easier**
- The RSVP has skin in the game, so the headcount is real.
- The event is funded up front by the pool, so the host isn't fronting cost.
- Check-in, payouts and vendor settlement are automatic and recorded, so there are no spreadsheets and no chasing.

**Community-building**
- Attendance is the currency of the network: the more you show up, the more events you can see.
- Hosts get a reason for people to come back, and members get a reason to meet new people.

**Why it needs a chain (the question judges will ask)**
- A rules-enforcing escrow nobody has to trust (host can't change the split; attendees claim their own share).
- Cheap enough per action that micro-payouts and per-person check-ins make sense.
- Attendance as portable, verifiable proof of presence that other apps could use later.

**Technical credibility (one breath)**
- Anchor program with 110 passing tests, a localnet end-to-end run on a live validator that passes, generated typed client, Next.js app with wallet sign-in, and ephemeral gate/ticket keys so check-in needs no wallet popups.

## 6. Likely questions and answers
- **"Couldn't a host cheat?"** One real limitation: a host could check in wallets they control and collect the attendee share. The split and fee are public and fixed, and members see them before paying. A host stake or reputation system is the natural next step. Say this plainly before they ask.
- **"Is attendance private?"** No. On-chain data is public. What we gate is the event *details* and the *feed*. Position it as proof of presence rather than a privacy product.
- **"Why not Stripe + a ticketing app?"** Existing tools don't pay people for showing up, can't enforce the payout rules without trusting the platform, and can't give a portable record of attendance.
- **"Do users need crypto knowledge?"** They need a Phantom wallet and a little devnet SOL for now. Embedded wallets (email/Google sign-in) are the planned path for mainstream users.
- **"What did you build this weekend?"** The full loop: create, join, QR check-in, payout, plus vendor sponsorships and network-based discovery.

## 7. Track fit
- **DeFi (primary):** pooled escrow with programmatic payouts, a new way to move value among a group.
- **Top 3 Overall:** Solana is used for what it's good at (cheap, fast, enforced rules, on-chain ownership), not bolted on.
- **Best Beginner Hack:** only if the team is more than 50% first-time hackers.

## 8. Copy deck for the app

**Brand:** SOLSocial · *Event hosting and community-building, on-chain.*

**Home hero**
- Headline: *Host events people actually show up to.*
- Subhead: *Guests join with a small Solana payment. Fees fund the event, and everyone who shows up shares the pool.*
- Primary button: **Host an event** · Secondary: **Browse events**

**How it works (three steps)**
1. **Join with a payment.** *Your RSVP is a small SOL entry fee, so hosts know who is really coming.*
2. **Show your pass.** *Your QR refreshes every 20 seconds. Scan at the door to check in on-chain.*
3. **Get paid for showing up.** *After the event, attendees split a share of the pool.*

**Create event**
- Page title: *Host an event*
- Entry fee helper: *Everyone pays this to join. It goes into the event pool.*
- Payout helper: *The share of the pool split among guests who show up. Locked once you create the event.*
- Button: **Create event**

**Event page**
- Join button: **Join for 0.1 SOL**
- Pool label: *Event pool*; subtext: *Funds the event and pays guests who show up.*
- Details gate: *Join to see the location and details.*
- Sold out: *This event is full.*

**Ticket page**
- Title: *Your pass*
- Helper: *Show this at the door. It refreshes every 20 seconds, so screenshots won't work.*
- Checked in: *You're in. Enjoy the event!*
- Recovery: *Lost your pass on this device? Recover it with one wallet approval.*

**Scanner (host)**
- Title: *Door check-in*
- Setup helper: *Authorize a check-in key once, then scan guests without wallet popups.*
- Success: *Checked in* · Reject states: *Pass expired · Not a valid pass · Already checked in · Not on the guest list*

**Host dashboard**
- Labels: *Guests joined · Checked in · Event pool · Paid to guests · Your budget*
- End event confirm: *This closes check-in and locks in payouts. Guests who checked in can then claim their share.*
- Withdraw: **Withdraw event budget**

**Claim**
- Claimable: *You showed up. Claim your share: 0.0xx SOL.* Button: **Claim**
- Not checked in: *You didn't check in to this event, so there's no payout.*

**Vendors**
- Page: *Sponsor and supply events.* Helper: *Propose what you'll provide and your price. Get paid from the event pool once delivery is confirmed.*
- Host inbox: *Sponsorship requests* · **Approve** / **Decline**

**Network**
- Title: *Your community*
- Nudge: *Attend 1 more event to unlock 3 more.*
- Badge on cards: *From your network · via Rooftop Meetup*

**Empty and error states**
- No events: *No events yet. Be the first to host one.*
- Wrong network: *Switch your wallet to Devnet to use SOLSocial.*
- Low balance: *Not enough SOL. On devnet you can get free test SOL from the faucet.*

---

## 9. What changed vs. the original framing
The first framing was "entry fees fund the event and attendees get airdrops." The marketing emphasis now is **planning**: the payment is a commitment device (real headcount), a funding mechanism (pool) and an automation layer (check-in, payout, vendor settlement), with community growth as the long-term payoff.
