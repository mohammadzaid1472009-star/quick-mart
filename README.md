# Quick M@rt — Global Marketplace Upgrade

## Included
- Username + email + password registration/login. No Google/Gmail verification is required; an address such as `zaid@bro.com` is accepted.
- Username is saved with every order and is shown in the ticket/chat.
- Discord-inspired ticket chat UI with customer/staff message bubbles, status and payment area.
- Admin can add, edit and delete products, including price, stock, description and image.
- Country selector with automatic browser-country guess and manual override.
- Local-currency price display across the storefront and ticket. The included exchange table is a simple client-side rate table; update rates periodically for production billing.
- Multi-language interface with a broad set of common world languages and an expandable translation structure.
- Existing manual QR payment flow remains intact.

## Render
Build Command:
`npm install`

Start Command:
`node server.js`

Environment variables:
`ADMIN_USER=your-admin-username`
`ADMIN_PASSWORD=your-strong-password`
`DISCORD_WEBHOOK_URL=optional`

## Important production note
The storefront currency conversion is for display and ticket presentation. The current manual QR/UPI payment flow remains based on your existing INR price. If you want true multi-currency card checkout, that requires a payment provider/account configured for the target currencies and should be implemented separately.
