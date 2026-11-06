# Order Ease: agent rules

Ordering app for Company A, a Jabalpur distributor serving ~1,800 kirana retailers.
Core slice only: catalogue, cart, order, text AI capture, order desk, Tally export.

## Stack
- Monorepo: `/backend` (FastAPI, SQLModel, SQLite, PyJWT, pytest), `/web` (Vite, React, TypeScript, Tailwind).
- Frontend: no component library, bundle under 150 KB gzipped.
- Python 3.14. Dependencies in `backend/requirements.txt`.
- Run from repo root:
  - Tests: `pytest -v`
  - API: `uvicorn backend.app.main:app --reload` (docs at /docs)

## Working rules
- Small steps. After each, run `pytest -v` and paste the RAW terminal output. Never retype or summarise it.
- Tests use a temp DB (`tmp_path`), never the dev DB.
- Expected values in tests are hardcoded literals, never computed with engine logic.
- Do not change existing scheme tests to make them pass. Fix the code.
- Do not add dependencies or UI libraries without asking.
- Scope limits: no payments in the app, no delivery tracking, no GST e-invoicing, no real WhatsApp/Tally calls. Mock them.
- Use generic product names only. No real brands.
- Never claim the Tally export is validated.

## Roles
| Role | Can do | Cannot |
|---|---|---|
| retailer | Own catalogue, quote, orders, capture | Other retailers' data, `/desk/*`, source `desk_capture` |
| salesman | Same, for assigned retailers (`retailer.salesman_id == user.id`) | Unassigned retailers, `/desk/*` |
| order_desk | All retailers, `/desk/*`, edit/approve/override, capture for any retailer, Tally export | |
| owner | Same as desk, plus credit overrides | No screens yet |

Authorization lives in FastAPI dependencies (`require_role`, `check_retailer_access`), not the UI.
Retailer prices, credit and outstanding are visible only to that retailer, their salesman, desk and owner.
Build screens for retailer and order_desk only. Salesman and owner are data-model only for now.

## Data model
- `SKU`: code, name, price_per_piece (Decimal), units_per_case, gst_rate, price_includes_gst, stock_cases, scheme_type, scheme_params, image_url.
- `Retailer`: credit_limit, outstanding, nullable salesman_id.
- `Order`: status (pending | credit_hold | approved), source (retailer_app | retailer_capture | desk_capture | salesman), placed_by_user_id, client_request_id.
- `OrderLine`: charged_cases, free_cases, price_per_case, discount_amount, line_total, nullable original_words.
- `Alias`: retailer_id, original_words, sku_code (per retailer, learned from desk corrections).
- Seed SKUs, codes exact: `SKU-BS-075` (biscuit 75 g, 96/case, 8.10/pc, 340 cases), `SKU-DT-1KG` (detergent 1 kg, 20/case, 101.50/pc, 85 cases), `SKU-TE-250` (tea 250 g, 40/case, 118.00/pc, 0 stock). Decoys: `SKU-BS-150`, `SKU-DT-500`, `SKU-TE-100`.

## Pricing and schemes
- Price is stored per piece. Case price = price_per_piece x units_per_case, rounded half-up to the paisa, once per line. Money is `Decimal`, never float.
- Display "₹777.60 / case (₹8.10 × 96)" and always label incl. or excl. GST.
- If price_includes_gst is false, show subtotal, gst_amount and payable separately.
- The frontend never calculates prices, schemes or tax. All totals come from `POST /cart/quote`.
- `backend/app/schemes.py` is pure Python. It must not import FastAPI, SQLModel or the DB.
- Biscuit: free = floor(paid / 10), same SKU, not charged, reduces stock.
- Detergent: 3% off line value when paid cases >= 5.
- Stacking: free goods first, then the discount on paid cases. Free goods never count toward the slab. The slab never applies to biscuit.
- Stock cap: paid + free <= stock. Biscuit with 340 in stock: 309 paid + 30 free = 339 used, message "Reduced to 309 cases (stock limit)".
- Out-of-stock lines stay in the response with a warning, are excluded from totals.
- Nudges: "add N more for 1 free", "add N more for 3% off".
- Reference check: biscuit 5 + detergent 2 + tea 1 gives payable 7948.00 before GST (3888 + 4060, tea excluded).

## Orders
- `POST /orders` re-quotes on the server and ignores client totals.
- If outstanding + payable > credit_limit, status is `credit_hold`, else `pending`.
- `client_request_id` is idempotent: the same ID returns the same order.
- Stock is reduced only on desk/owner approval, and approval re-checks stock including free cases (refuse if it would go negative).
- Approving a `credit_hold` order needs `override_flag=true` and a non-empty `override_reason`, both stored.
- Retailers may only send source `retailer_app` or `retailer_capture`, and only for themselves.

## AI capture
- `POST /capture` parses text and returns lines plus a preview quote. It creates NO order. Only a capture log is saved.
- Each line: original_words, sku_code (nullable), qty, unit (case | piece | unknown), confidence (high | medium | low), up to 2 alternative SKUs, flags (out_of_stock, needs_unit, no_match).
- Unknown unit means ask, never guess. Never invent items. Out-of-stock lines are flagged, not dropped.
- Matching order: retailer's Alias (high), keyword plus past orders, ambiguous between sizes (medium), otherwise low.
- The person confirms through `POST /orders`. Desk corrections to a captured line save an Alias for that retailer.
- Parser is pluggable: `RuleBasedParser` is the default, `LLMParser` is an optional stub.
- Retailer capture is forced to their own retailer_id. Desk and owner may pass any.

## API
Built: `POST /auth/otp`, `GET /catalogue`, `POST /cart/quote`, `POST /orders`, `GET /orders/mine`, `GET /retailers` (desk/owner), `GET /desk/orders`, `GET /desk/orders/{id}`, `PATCH /desk/orders/{id}`.
Planned: `POST /capture`, `GET /desk/export/tally?format=xml|csv`.
Later: `GET /retailers/{id}`, `GET /retailers/{id}/orders`.
Auth: mock OTP `123456`, JWT with user_id, role, retailer_id. Wrong OTP gives 401.
Catalogue never returns exact stock numbers to retailers, only in_stock, low (10 or fewer) or out.

## Design
- Minimal: white space, one accent colour, system fonts, nothing without a purpose.
- Large lazy-loaded product images, 48px minimum tap targets, 360px width first, first load under 3 s on slow 3G.
- Retailer side is spacious. The order desk is dense and fast, because six people use it all day.
- Hindi and English through a small `{en, hi}` dictionary (about 40 strings).