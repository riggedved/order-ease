# Order Ease - Agent & System Specification

Company A: Jabalpur Distributor Kirana Ordering Platform.

## Stack & Architecture
- **Backend**: FastAPI, SQLModel, SQLite, PyJWT, pytest.
- **Frontend**: Vite + React + TypeScript + Tailwind (no component library, bundle < 150 KB gzipped).
- **Domain Engine**: Pure Python `schemes.py` using `Decimal` half-up paisa rounding.

---

## Role & Permission Matrix

| Role | Enum Value | Description | Permitted Endpoints & Data Scope | Access Restrictions |
| :--- | :--- | :--- | :--- | :--- |
| **Retailer** | `retailer` | Kirana store owner / merchant | - `POST /auth/otp`<br>- `GET /catalogue`<br>- `POST /cart/quote`<br>- `GET /retailers/{id}` (own store only)<br>- `GET /retailers/{id}/orders` (own orders only)<br>- `POST /orders` (place own orders) | **Strictly isolated** to `retailer_id == current_user.retailer_id`.<br>HTTP 403 on other retailers or any `/desk/*` routes. |
| **Salesman** | `salesman` | Field sales representative visiting kiranas | - `POST /auth/otp`<br>- `GET /catalogue`<br>- `POST /cart/quote`<br>- `GET /retailers/{id}` (assigned stores only)<br>- `POST /orders` (source: `salesman`) | **Strictly isolated** to stores where `retailer.salesman_id == current_user.id`.<br>HTTP 403 on unassigned retailers or `/desk/*` routes. |
| **Order Desk** | `order_desk` | Central distributor order desk operator | - All retailer endpoints across all stores<br>- `GET /desk/orders`<br>- `GET /desk/retailers`<br>- `PATCH /desk/orders/{id}`<br>- `GET /desk/export/tally` | Full operational access across all stores and desk approval routes. |
| **Owner** | `owner` | Distributor business owner | - Complete system oversight across all stores, salesmen, desk routes, and credit overrides | Unrestricted administrative access. |

---

## Core Business Rules
1. **Price per Piece & Case Calculations**:
   - Price is stored per piece in Decimal.
   - Each SKU specifies `units_per_case`, `gst_rate`, and `price_includes_gst`.
   - Case price is calculated as `price_per_piece * units_per_case` rounded half-up to the paisa once per line.
2. **Access Control**:
   - Retailer prices and credit limits are visible only to that retailer, assigned salesman, order desk, and owner.
   - Enforced in FastAPI dependency layer (`check_retailer_access`, `require_role`).
3. **Schemes & Stock Capping**:
   - Free goods: 1 free case per 10 paid cases for `SKU-BS-075` (reduces stock, free of charge).
   - Slab discount: 3% off line value for `SKU-DT-1KG` when paid cases $\ge 5$.
   - Stock capping rule: Total quantity including free goods cannot exceed available stock. For 340 biscuit cases in stock, maximum paid cases is 309 (+ 30 free = 339 cases used), returning `"Reduced to 309 cases (stock limit)"`.
4. **Order State Lifecycle**:
   - `pending` $\to$ `credit_hold` (if total exceeds credit limit) $\to$ `approved` (confirmed by desk or owner).
   - Nothing becomes an order until explicitly confirmed.

