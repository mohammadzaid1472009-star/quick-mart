# Quick M@rt — Manual QR Payment + Ticket System

Razorpay has been removed from the payment flow.

Flow:
1. Customer clicks Order Now.
2. A ticket is created immediately.
3. Admin sees the new ticket in Admin Dashboard.
4. Admin can send messages and apply a discount.
5. Admin uploads one payment QR in the Admin Dashboard.
6. Customer sees the final amount + QR inside the ticket.
7. Customer pays by UPI and uploads a payment screenshot.
8. Admin verifies it and clicks “Payment Received / Complete”.
9. Stock is reduced only after admin marks payment received.

Render:
- Build Command: npm install
- Start Command: node server.js
- Add environment variables:
  ADMIN_USER=your-admin-username
  ADMIN_PASSWORD=your-strong-password
  DISCORD_WEBHOOK_URL=optional
