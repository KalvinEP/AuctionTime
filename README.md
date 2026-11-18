# Private Player Auction

Invite-only auction. Friends log in with phone number + PIN, see bids update live, and the total pool is always on screen. Bidding stops automatically at the close time.

## Run it
Needs Node 18 or newer. No packages to install.

    ADMIN_KEY=pick-a-long-secret node server.js

- Bidders open `http://your-server/`
- You open `http://your-server/admin` and enter the ADMIN_KEY

## Set up an auction (in /admin)
1. Paste the 32 player names (one per line).
2. (Optional) Upload your logo under "Logo". It appears on the login page and at the top of the bidding page.
3. Save the list, then add a photo to each lot under "Lot photos" (any phone or camera photo works; it's shrunk automatically).
4. Set the closing time, opening bid and minimum raise.
5. Add bidders as `Name, phone, PIN` (leave the PIN out to get one generated). Use "Copy invite messages" and send each person their link and PIN on WhatsApp.
6. Do a test: tick "Bidding is open", bid from two phones, then use "Clear all bids".
7. Tick "Bidding is open" when you want to start. It stops at the close time whatever the tick box says.
8. After closing, "Download results (CSV)" gives each player's winning bid, the winner, and the total pool.

## What bidders see
- Photo on each lot (tap to enlarge)
- A "You're winning" list of the lots they currently lead, with amounts (becomes "You won" after closing)
- A pop-up when they are outbid

## Rules built in
- Whole-number bids only, at least the minimum raise above the current top bid
- You can't outbid yourself on a player you already lead
- Server enforces the close time (late bids are rejected, no matter what a phone's clock says)
- 10 wrong PIN attempts from one address locks that address out for 10 minutes

## Hosting
Put it on any small host that runs Node and keeps its disk between restarts (a cheap VPS, or Railway/Fly.io with a volume). Use HTTPS (most hosts give it free) so PINs aren't sent in the clear. Some free tiers wipe the disk on restart, which would lose bids, so check that or set DATA_FILE to a path on a persistent volume.

Photos are saved in an `images` folder next to `data.json`, so if `DATA_FILE` points at your persistent volume (e.g. `/data/data.json`) the photos are kept too.

All bid data lives in one file, `data.json`. Back it up after the auction if you want a record.
