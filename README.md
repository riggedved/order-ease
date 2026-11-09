# Order Ease

Ordering application for Company A, a Jabalpur FMCG distributor serving ~1,800 kirana retailers.

Order Ease replaces fragmented WhatsApp order taking with a dual-interface platform:
1. **Kirana Retailer Mobile Web App**: A lightweight, mobile-first ordering experience with real-time distributor schemes, live GST calculations, and vernacular message-based order capture (Hinglish/Hindi).
2. **Distributor Order Desk Console**: A high-density single-screen operations dashboard for desk operators to review queues, edit lines with real-time re-quoting, manage credit holds and stock limits, approve orders, and export directly to Tally.

---

## Architecture & Tech Stack

```
                                  [Kirana Retailer / Desk Operator]
                                                  │
                                                  ▼
                                       [Vite + React Frontend]
                                       (Port 3000 / Vercel SPA)
                                                  │
                                   /api/* rewrites (Same-Origin)
                                                  ▼
                                       [FastAPI Backend API]
                                      (Port 8000 / Render Web)
                                                  │
                         ┌────────────────────────┼────────────────────────┐
                         ▼                        ▼                        ▼
                [Pure Scheme Engine]     [Vernacular Capture]     [SQLite / PostgreSQL]
                (backend/app/schemes.py) (backend/app/capture.py)     (orderease.db)
```

- **Backend**: Python 3.14 (tested on 3.14.3), FastAPI, SQLModel, SQLite (development / ephemeral) / PostgreSQL (production), PyJWT, Uvicorn.
- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite. Zero heavy UI component libraries — custom high-performance type system and design tokens.
- **Bundle Size**: Main application bundle is **~89 kB gzipped**, Desk management chunk is **~14 kB gzipped** (well below the 150 kB budget).
- **Test Suite**: 102 automated unit and integration tests with 100% passing status.

---

## Key Features

### 1. Pure Domain Scheme & Pricing Engine
- **Decimals Everywhere**: Money arithmetic uses Python `Decimal` with half-up rounding to the nearest paisa (`0.01`) once per line.
- **Schemes**:
  - *Free Goods*: 1 free case per 10 paid cases on `SKU-BS-075` (Glucose Biscuit 75 g), reducing stock without charge.
  - *Slab Discount*: 3% line discount on 5+ paid cases of `SKU-DT-1KG` (Detergent Powder 1 kg).
  - *Stacking*: Free goods calculated first; slab discount applies only to paid cases. Free goods never trigger slab discounts; slab never applies to biscuits.
  - *Stock Capping*: Capped at available warehouse stock (`paid + free <= stock`), returning explanatory notices (e.g., *"Reduced to 309 cases (stock limit)"*).
  - *Dynamic Nudges*: Real-time cart nudges (*"Add N more for 1 free"*, *"Add N more for 3% off"*).

### 2. Vernacular Order Capture Pipeline
- **Input Flexibility**: Paste or type messy natural-language orders in Hindi or Hinglish (e.g. `bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti`).
- **Pluggable Parsers**:
  - `RuleBasedParser`: Deterministic token/regex matcher supporting Devanagari numerals, packaging terms (`peti`, `carton`, `packet`), size hints (`chhota`, `1 kilo`, `250 wala`), and category guards. Requires no API keys.
  - `LLMParser`: Structured extraction using OpenAI-compatible endpoints (e.g. Groq).
  - `auto`: Attempts LLM parser first and gracefully falls back to rule-based parsing on timeout, HTTP 429, invalid JSON, or invented SKUs.
- **Alias Learning**: When an operator edits a mapped line SKU or confirms an order with vernacular text, an alias is saved per retailer. Subsequent captures for that store match with High confidence automatically.

### 3. Order Desk Single-Screen Console
- **Fixed One-Screen Layout**: Designed for 1280x650, 1366x768, and 1080p desktop viewports without page-level scrollbars.
- **Live Re-Quoting & Concurrency**: Editing line quantities or SKUs immediately updates scheme calculations and credit limit projections. Optimistic concurrency control via `version` prevents overwrite conflicts (`409 Conflict`).
- **Credit Risk Management**: Instant 2x2 credit position display (*Credit Limit*, *Outstanding*, *This Order*, *Projected*). Orders exceeding limit land in `credit_hold`. Desk requires explicit `override_reason` to release and approve credit-hold orders.
- **Tally XML / CSV Export**: Generates clean Tally-compliant XML `<VOUCHER>` entries with entity escaping (`&amp;`) and zero-value free goods lines, as well as CSV formats.

---

## Quick Start (Local Development)

### Prerequisites
- **Python**: 3.14 (tested on 3.14.3, pinned via `.python-version`)
- **Node.js**: ^20.19.0 or >=22.12.0 (tested on Node 24 and npm 11)

### 1. Backend Setup
From the repository root:

```bash
# Windows PowerShell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

- **API Server**: `http://127.0.0.1:8000`
- **Swagger Documentation**: `http://127.0.0.1:8000/docs`
- **Health Check**: `http://127.0.0.1:8000/health`

### 2. Frontend Setup
In a separate terminal:

```bash
cd web
npm install
npm run dev
```

- **Web App**: `http://localhost:3000` (Vite dev server proxies `/api/*` to backend `http://127.0.0.1:8000`).

### 3. Running the Tests
From repository root with virtual environment activated:

```bash
pytest -v
```

All 102 automated tests will execute against an isolated test database.

---

## Demo Accounts

All accounts use the mock OTP: **`123456`**.

| Phone | Role | Name & Business | Review Highlights |
| :--- | :--- | :--- | :--- |
| **`9826011111`** | `retailer` | Ramesh Gupta<br>*(Gupta Kirana Store)* | Standard retailer with ₹75,000 available credit. Review mobile catalogue, scheme tags, live cart quote, Hinglish text capture, and order placement. |
| **`9826022222`** | `retailer` | Suresh Sharma<br>*(Sharma Provision Store)* | **Credit Hold Demo (Near-Limit)**: Only ₹3,500 available credit. Placing an order over ₹3,500 automatically flags order as `credit_hold`. |
| **`9826000001`** | `order_desk` | Desk Officer<br>*(Company A Order Desk)* | **Order Desk Console**: Split queue (All, Pending, Credit Hold, Approved), live line editing, credit position 2x2 grid, approval, override approval, and Tally export. |

> [!NOTE]
> The salesman and owner roles exist in the data model and API authorization and are covered by the test suite (test_auth_and_roles.py), but are not seeded in the demo database and have no screens. Logging in with other numbers returns 'Phone number not registered'.

---

## Environment Variables

Configure in a root `.env` file (see `.env.example`):

| Variable | Purpose | Default | Example |
| :--- | :--- | :--- | :--- |
| `ENV` | Set to `production` in deployment to enforce secret validation. | `development` | `production` |
| `JWT_SECRET` | Secret key for signing HS256 access tokens. Required in production. | Development key | `your-secure-32-byte-secret` |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins for direct CORS. | Empty (same-origin) | `https://your-app.vercel.app` |
| `CAPTURE_PARSER` | Parser mode: `rule` (default), `llm`, or `auto`. | `rule` | `auto` |
| `LLM_API_KEY` | API key for OpenAI-compatible LLM endpoint (Groq / OpenAI). | Empty | `gsk_placeholder_api_key_here` |
| `DATABASE_URL` | SQLAlchemy connection URL. Defaults to SQLite. | `sqlite:///./orderease.db` | `sqlite:///./orderease.db` |

---

## Deployment (Render & Vercel)

The repository is configured for zero-friction cloud deployment:

- **Backend (Render Web Service)**:
  - Root Directory: `.`
  - Build Command: `pip install -r backend/requirements.txt`
  - Start Command: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
  - Health Check: `/health`
  - Python Version: `3.14` (tested on 3.14.3, pinned via `.python-version`)
- **Frontend (Vercel SPA)**:
  - Root Directory: `web`
  - Build Command: `npm run build`
  - Output Directory: `dist`
  - Rewrite Gateway: `web/vercel.json` rewrites `/api/:path*` to `https://YOUR-SERVICE.onrender.com/:path*` to eliminate CORS configuration.

For complete, step-by-step deployment instructions, operational scripts, and known limitations, refer to [deployment.md](deployment.md).

---

## License

Internal proprietary software for Company A Jabalpur operations.
