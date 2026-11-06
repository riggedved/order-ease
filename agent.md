Project: ordering app for Company A, a Jabalpur distributor with kirana
retailers. Roles: retailer, order_desk. Mock OTP 123456, JWT.
Stack: FastAPI, SQLModel, SQLite, pytest. Frontend: Vite + React + TypeScript
+ Tailwind, no component library, bundle under 150 KB gzipped.
Monorepo: /backend, /web.

Rules:
- Price is stored per piece. Each SKU has units_per_case, gst_rate,
  price_includes_gst. Show case price as "₹777.60 / case (₹8.10 × 96)"
  and always label incl./excl. GST.
- Retailer prices and credit are visible only to that retailer and the desk.
  Enforce this in FastAPI dependencies, not just the UI.
- Frontend gets all totals from POST /cart/quote. It never calculates
  schemes itself.
- Nothing becomes an order until a person confirms it.
- Design: minimal, white space, one accent colour, system fonts, large
  product images (lazy-loaded), 48px tap targets, nothing decorative.
- Hindi/English via a small {en, hi} dictionary.
- Mock payments, WhatsApp and Tally. Never claim the Tally export is validated.

API contract:
POST /auth/otp | GET /catalogue | POST /cart/quote | POST /orders
POST /capture | GET /desk/orders | PATCH /desk/orders/{id}
GET /desk/export/tally?format=xml|csv