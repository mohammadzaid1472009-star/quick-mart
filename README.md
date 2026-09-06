# Quick M@rt v2.0

A dark-mode responsive storefront with a local cart, Razorpay checkout, order lookup, customer support tickets, and an admin dashboard.

## Setup

1. Copy `.env.example` to `.env`.
2. Put Razorpay **TEST** key ID/secret in `.env` while developing.
3. Set a strong admin username/password.
4. Run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Production checklist

- Use HTTPS.
- Use a unique long `ADMIN_PASSWORD` and `RAZORPAY_WEBHOOK_SECRET`.
- Configure Razorpay webhook URL as `/api/razorpay/webhook` and subscribe to captured/paid/failed payment events as appropriate.
- Keep `.env`, `quickmart.db`, and uploaded files out of Git.
- Start with Razorpay TEST mode and verify the complete payment flow before switching to LIVE keys.
- Back up `quickmart.db` regularly.

## Main features

- Responsive homepage and product catalog
- Local cart with quantity controls
- Server-side cart/order validation
- Razorpay order creation and signature + payment API verification
- Webhook signature verification and webhook event idempotency
- Stock reduction only after successful payment
- Customer order lookup using order ID + checkout email
- Automatic support ticket after payment
- Admin dashboard, product editing, order list, ticket replies/status
- Helmet security headers and API/payment rate limiting
- Image upload size/type restrictions
