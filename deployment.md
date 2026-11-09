# Order Ease: Deployment & Operation Guide

Ordering application for Company A, a Jabalpur FMCG distributor serving ~1,800 kirana retailers.
Core slice: catalogue, cart, scheme engine, text AI capture, order desk management, and Tally export.

---

## Live Application

- **Frontend (Web App)**: [https://order-ease-vexy1.vercel.app](https://order-ease-vexy1.vercel.app)
- **Backend (API)**: [https://order-ease-15f8.onrender.com](https://order-ease-15f8.onrender.com)
  - **Interactive API Documentation (Swagger)**: [https://order-ease-15f8.onrender.com/docs](https://order-ease-15f8.onrender.com/docs)
  - **Health Check**: [https://order-ease-15f8.onrender.com/health](https://order-ease-15f8.onrender.com/health)

---

## Live Demo Notes

> [!IMPORTANT]
> - **Free Instance Spin-Down**: The backend runs on a Render free web service. If the instance has been idle for more than 15 minutes, it spins down. The first request may take up to 50–60 seconds to wake up. If slow initially, please wait a minute and retry.
> - **Ephemeral Database**: The database is temporary. SQLite (`orderease.db`) runs on ephemeral storage; orders reset whenever the server restarts, and seed demo data is automatically recreated on startup.
> - **Vernacular Capture Privacy**: With `CAPTURE_PARSER=auto`, pasted message text is sent to the LLM provider (e.g. Groq) and falls back to the local deterministic rule parser on any failure; with `CAPTURE_PARSER=rule`, all parsing is local and nothing leaves the server.
> - **Mock Tally Export**: The structure follows Tally's XML import format but has not been validated against a real Tally installation.

---

## 1. Run Locally (Step-by-Step)

### Prerequisites

| Tool | Required Version | Tested Version | Notes |
| :--- | :--- | :--- | :--- |
| **Python** | 3.14 | 3.14.3 | Pinned via `.python-version` |
| **Node.js** | ^20.19.0 or >=22.12.0 | 24.18.1 | Required by Vite (engines in `web/node_modules/vite/package.json`) |
| **npm** | 9.0+ | 11.16.0 | Node package manager |
| **Git** | Any modern version | 2.x | Version control |

---

### Step-by-Step Setup: Windows PowerShell

1. **Clone the repository**:
   ```powershell
   git clone https://github.com/riggedved/order-ease.git
   cd order-ease
   ```

2. **(Optional) Configure environment variables**:
   ```powershell
   Copy-Item .env.example .env
   ```
   *(Optional: the application runs out of the box without a `.env` file, defaulting to `rule` parser mode with zero API keys required).*

3. **Create and activate the Python virtual environment**:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   *(If script execution is restricted, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`)*

4. **Install backend dependencies**:
   ```powershell
   pip install -r backend/requirements.txt
   ```

5. **Start the backend API** (execute from repo root):
   ```powershell
   uvicorn backend.app.main:app --reload
   ```
   - API Server runs at: `http://127.0.0.1:8000`
   - Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`
   - Health check: `http://127.0.0.1:8000/health`

6. **Install frontend dependencies & start web app** (in a separate terminal):
   ```powershell
   cd web
   npm install
   npm run dev
   ```
   - Web application runs at: `http://localhost:3000`
   - Vite automatically proxies `/api/*` to `http://127.0.0.1:8000`.

---

### Step-by-Step Setup: macOS / Linux

1. **Clone the repository**:
   ```bash
   git clone https://github.com/riggedved/order-ease.git
   cd order-ease
   ```

2. **(Optional) Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   *(Optional: the application runs out of the box without a `.env` file, defaulting to `rule` parser mode with zero API keys required).*

3. **Create and activate the Python virtual environment**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

4. **Install backend dependencies**:
   ```bash
   pip install -r backend/requirements.txt
   ```

5. **Start the backend API** (execute from repo root):
   ```bash
   uvicorn backend.app.main:app --reload
   ```
   - API Server runs at: `http://127.0.0.1:8000`
   - Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`

6. **Install frontend dependencies & start web app** (in a separate terminal):
   ```bash
   cd web
   npm install
   npm run dev
   ```
   - Web application runs at: `http://localhost:3000`

---

### Running Tests

Execute from the repository root with the virtual environment activated:
```bash
pytest -v
```
All 102 tests run against an isolated SQLite test database and verify:
- Catalogue rules and stock visibility
- Cart pricing and scheme calculations (free goods, slab discount, stacking, stock caps, paisa rounding)
- Orders lifecycle (credit holds, limit deduction, cancellation)
- Role-based authorization (retailer, salesman, order_desk, owner)
- Vernacular order capture (rule-based, LLM fallback, Devanagari numerals, category guards, alias learning)
- Tally XML and CSV export formatting
- Health endpoint and production secret enforcement

---

### How to Reset the Database

The application uses an SQLite database (`orderease.db`) located at the repository root.

**Windows PowerShell**:
```powershell
Remove-Item .\orderease.db -ErrorAction SilentlyContinue
```

**macOS / Linux**:
```bash
rm -f orderease.db
```

Upon the next API startup (or first request), `init_db()` automatically:
- Creates all database tables (`skus`, `users`, `retailers`, `orders`, `order_lines`, `aliases`, `capture_logs`).
- Seeds the initial catalogue (6 SKUs including decoys and schemes).
- Seeds staff users, retailers, initial orders, and vernacular aliases.

---

## 2. How It Is Deployed

The live system is deployed across **Vercel** (frontend SPA) and **Render** (backend API).

### Real Setup

1. **Frontend (Vercel)**:
   - **Repository Root**: `https://github.com/riggedved/order-ease.git`
   - **Root Directory**: `web`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
   - **Single-Origin Gateway (`web/vercel.json`)**:
     Vercel rewrites all `/api/*` traffic directly to Render, allowing the frontend to make same-origin requests without cross-origin configuration:
     ```json
     {
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://order-ease-15f8.onrender.com/:path*"
         },
         {
           "source": "/(.*)",
           "destination": "/index.html"
         }
       ]
     }
     ```

2. **Backend (Render)**:
   - **Service Type**: Free Web Service
   - **Environment**: Python 3.14 (tested on 3.14.3, pinned via `.python-version`)
   - **Root Directory**: `.`
   - **Build Command**:
     ```bash
     pip install -r backend/requirements.txt
     ```
   - **Start Command**:
     ```bash
     uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
     ```
   - **Health Check Path**: `/health` (returns `{"status": "ok"}`)

---

### How This Would Scale

For a high-volume production deployment:
1. **Containerized Services**: Package the FastAPI backend as a Docker container deployed to AWS ECS (Fargate) or GCP Cloud Run with auto-scaling instances.
2. **Persistent Database**: Set `DATABASE_URL` and re-run the test suite against PostgreSQL.
3. **Edge Asset Delivery**: Maintain frontend assets on AWS S3 with CloudFront CDN or Vercel Edge Network.
4. **Queue Workers & Caching**: Offload heavy LLM parsing and Tally report generation to background Celery/Redis workers.

---

## 3. Environment Variables

The table below lists the active environment variables and where each is configured:

| Variable | Where It Is Set | Purpose & Details |
| :--- | :--- | :--- |
| **`ENV`** | Render Dashboard / Local `.env` | Environment identifier (`production` or `development`). When set to `production`, `JWT_SECRET` must be set or startup fails. |
| **`JWT_SECRET`** | Render Dashboard / Local `.env` | Secret key used for signing and verifying HS256 JWT access tokens. Mandatory in production mode. |
| **`CAPTURE_PARSER`** | Render Dashboard / Local `.env` | Parser selection for order capture: `rule` (deterministic rule-based, no API key), `llm` (LLM-only), or `auto` (LLM with rule fallback). |
| **`LLM_API_KEY`** | Render Dashboard / Local `.env` | API key for OpenAI-compatible endpoint (e.g. Groq / OpenAI). Used when `CAPTURE_PARSER=auto` or `llm`. |
| **`ALLOWED_ORIGINS`** | Local `.env` (Optional fallback) | Comma-separated list of allowed CORS origins for direct browser API calls. In production, Vercel rewrites handle requests as same-origin. |
| **`DATABASE_URL`** | Local `.env` (Optional override) | SQLAlchemy connection string (`backend/app/db.py`). Defaults to `sqlite:///./orderease.db`. |

---

## 4. Demo Logins for Reviewers

All demo accounts use the standard mock OTP: **`123456`**.

| Phone | Role | Name & Business | What to Review / Test |
| :--- | :--- | :--- | :--- |
| **`9826011111`** | `retailer` | Ramesh Gupta<br>*(Gupta Kirana Store)* | **Primary Retailer Flow**: Credit limit ₹1,00,000 with ₹25,000 outstanding (₹75,000 available). Review mobile catalogue, scheme badges ("1 free / 10 cases", "3% off on 5+ cases"), live cart quote, Hinglish text capture, and standard order placement. |
| **`9826022222`** | `retailer` | Suresh Sharma<br>*(Sharma Provision Store)* | **Credit Hold Demo (Near-Limit)**: Credit limit ₹80,000 with ₹76,500 outstanding (only ₹3,500 available credit). Profile indicates "Credit low". Placing an order exceeding ₹3,500 triggers `credit_hold` status instead of `pending`. |
| **`9826000001`** | `order_desk` | Desk Officer<br>*(Company A Order Desk)* | **Order Desk Console**: High-density single-screen management UI. Review Queue tabs (All, Pending, Credit Hold, Approved), live search & date filtering, Order Detail pane, line editing with real-time re-quoting, credit position 2x2 grid, standard approval, override approval for credit holds, desk vernacular capture for any retailer, and Tally export. |

> [!NOTE]
> The salesman and owner roles exist in the data model and API authorization and are covered by the test suite (test_auth_and_roles.py), but are not seeded in the demo database and have no screens. Logging in with other numbers returns 'Phone number not registered'.

---

## 5. Six-Step End-to-End Demo Script

This script can be executed directly on the live deployment ([https://order-ease-vexy1.vercel.app](https://order-ease-vexy1.vercel.app)) or locally (`http://localhost:3000`).

### Step 1: Retailer logs in and views catalogue & schemes
1. Open [https://order-ease-vexy1.vercel.app](https://order-ease-vexy1.vercel.app).
2. Log in with phone **`9826011111`** and OTP **`123456`**.
3. View the catalogue:
   - Notice scheme tags: *"Buy 10 get 1 free"* on **Glucose biscuit 75 g**, *"3% off on 5+ cases"* on **Detergent powder 1 kg**.
   - Notice stock tags: **Tea leaf 250 g** shows *"Out of stock"*.

### Step 2: Retailer captures order via Hinglish message
1. Tap the **"Order by message"** tab or capture button.
2. In the text box, paste the sample vernacular order (or tap the **"Try this example"** link under the box):
   ```text
   bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti
   ```
3. Tap **"Read message"**.

### Step 3: Review parsed lines and add to cart
1. Inspect the parsed lines:
   - Line 1: `SKU-BS-075` (Glucose biscuit 75 g), 5 cases, Medium confidence ("Please check") with **Glucose biscuit 150 g** offered as an alternative candidate.
   - Line 2: `SKU-DT-1KG` (Detergent powder 1 kg), 2 cases, High confidence.
   - Line 3: `SKU-TE-250` (Tea leaf 250 g), 1 case, Out of stock (strikethrough line, excluded from totals).
2. Note the preview amounts: **subtotal ₹7,948.00**, **GST ₹925.20**, **total ₹8,873.20** including GST (1 line excluded).
3. Tap **"Add to cart"**.

### Step 4: Review cart nudges and place order
1. Navigate to Cart.
2. Note the automated scheme nudges:
   - *"Add 5 more cases for 1 free case"* (on biscuit).
   - *"Add 3 more cases for 3% off"* (on detergent).
3. Tap **"Place Order"**.
4. Order is confirmed with status `pending`. Retailer outstanding balance updates immediately on profile.

### Step 5: Desk reviews, corrects a line (alias learned), and approves
1. Switch to Order Desk: Log out or open an incognito window at [https://order-ease-vexy1.vercel.app](https://order-ease-vexy1.vercel.app).
2. Log in with phone **`9826000001`** and OTP **`123456`**.
3. Select the new pending order in the **Orders** queue.
4. Review the Order Detail pane:
   - Check the **Credit Position** (2x2 grid showing Credit limit, Outstanding, This order, Projected).
   - Edit a line quantity (e.g., change biscuit from 5 to 10 cases). Notice how the scheme engine automatically awards 1 free case and updates the total in real time.
   - If correcting a SKU, the system automatically learns the vernacular mapping into `aliases` for Gupta Kirana Store.
5. Click **"Approve"**.
   - Order status changes to `approved`.
   - Warehouse stock is decremented.

### Step 6: Export approved orders to Tally
1. Click the **"Export"** tab in the left sidebar.
2. Filter by date range (today's date).
3. The approved order is listed.
4. Select format: **Tally XML** (or CSV).
5. Click **"Download"**.
6. Inspect the downloaded file:
   - XML structure contains standard Tally `<VOUCHER>` elements with proper entity escaping (`&amp;`).
   - Free goods entries are exported with `<AMOUNT>0.00</AMOUNT>`.
   - Exported orders are marked with `exported_at` timestamp.

---

## 6. Known Limits

1. **Mock Tally Export**: The structure follows Tally's XML import format but has not been validated against a real Tally installation.
2. **Photo & Voice Capture**: Photo/camera capture (OCR) and voice note capture (audio speech-to-text) are not implemented; order capture operates on pasted or typed text messages.
3. **Salesman Offline Mode**: Dedicated salesman field screens and offline SQLite sync are not built (salesman role is implemented at the data-model and API authorization level).
4. **Owner Dashboard**: Dedicated executive analytics screens are not built (owner role is implemented at the data-model and API authorization level).
5. **Mocked OTP**: Phone authentication uses a fixed development OTP (`123456`) without live SMS gateway delivery.
