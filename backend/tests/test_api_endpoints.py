"""Unit tests for FastAPI endpoints: catalogue, cart quote, orders, and desk management."""

from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from backend.app.models import SKU, Retailer, Order, OrderStatus, OrderSource, Role


def login_as(client: TestClient, phone: str, otp: str = "123456") -> str:
    """Helper to authenticate and retrieve access token."""
    response = client.post("/auth/otp", json={"phone": phone, "otp": otp})
    assert response.status_code == 200
    return response.json()["access_token"]


class TestCatalogueEndpoint:
    """Tests for GET /catalogue?retailer_id="""

    def test_catalogue_returns_pydantic_typed_skus_and_never_exact_stock(self, client: TestClient):
        """Never return exact stock numbers to retailers; return in_stock | low | out."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/catalogue?retailer_id=1", headers=headers)
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 3

        # Check fields and stock status
        for item in items:
            assert "name" in item
            assert "price_per_piece" in item
            assert "case_price" in item
            assert "units_per_case" in item
            assert "price_includes_gst" in item
            assert "gst_rate" in item
            assert "stock_status" in item
            assert item["stock_status"] in ["in_stock", "low", "out"]
            # Exact stock number must NEVER be exposed
            assert "stock_cases" not in item
            assert "stock" not in item

        # Verify tea has status 'out'
        tea = next(i for i in items if i["code"] == "SKU-TE-250")
        assert tea["stock_status"] == "out"

        # Verify biscuit has status 'in_stock'
        biscuit = next(i for i in items if i["code"] == "SKU-BS-075")
        assert biscuit["stock_status"] == "in_stock"
        assert biscuit["scheme_label"] == "Buy 10 get 1 free"

    def test_catalogue_enforces_retailer_access(self, client: TestClient):
        """Retailer 1 requesting Retailer 2 catalogue returns 403."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/catalogue?retailer_id=2", headers=headers)
        assert response.status_code == 403


class TestCartQuoteEndpoint:
    """Tests for POST /cart/quote."""

    def test_quote_matches_engine_sample_lines_payable_7948_before_gst(self, client: TestClient):
        """quote matches the engine for the 3 sample lines (payable 7,948 before GST).

        Sample lines:
        1. Glucose biscuit 75g (SKU-BS-075): 5 cases -> 5 * 777.60 = 3,888.00 (ex-GST)
        2. Detergent powder 1kg (SKU-DT-1KG): 2 cases -> 2 * 2,030.00 = 4,060.00 (ex-GST)
        3. Tea leaf 250g (SKU-TE-250): 1 case (stock 0) -> blocked, 0.00
        Subtotal before GST: 3,888.00 + 4,060.00 = 7,948.00.
        GST: 5% on 3,888 = 194.40; 18% on 4,060 = 730.80 -> total GST = 925.20.
        Payable after GST: 7,948.00 + 925.20 = 8,873.20.
        """
        token = login_as(client, phone="9826011111")
        headers = {"Authorization": f"Bearer {token}"}

        payload = {
            "retailer_id": 1,
            "lines": [
                {"sku_code": "SKU-BS-075", "qty_cases": 5},
                {"sku_code": "SKU-DT-1KG", "qty_cases": 2},
                {"sku_code": "SKU-TE-250", "qty_cases": 1},
            ],
        }
        response = client.post("/cart/quote", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()

        # Payable 7,948 before GST
        assert float(data["subtotal"]) == pytest.approx(7948.00)
        assert float(data["gst_amount"]) == pytest.approx(925.20)
        assert float(data["payable"]) == pytest.approx(8873.20)

        # Lines checks
        assert len(data["lines"]) == 3

        # Biscuit line
        biscuit_line = data["lines"][0]
        assert biscuit_line["sku_code"] == "SKU-BS-075"
        assert biscuit_line["charged_cases"] == 5
        assert biscuit_line["free_cases"] == 0
        assert float(biscuit_line["line_total"]) == pytest.approx(3888.00)
        assert any("add 5 more" in n.lower() for n in biscuit_line["nudges"])

        # Detergent line
        det_line = data["lines"][1]
        assert det_line["sku_code"] == "SKU-DT-1KG"
        assert det_line["charged_cases"] == 2
        assert float(det_line["line_total"]) == pytest.approx(4060.00)
        assert any("add 3 more" in n.lower() for n in det_line["nudges"])

        # Tea line (blocked for stock)
        tea_line = data["lines"][2]
        assert tea_line["sku_code"] == "SKU-TE-250"
        assert tea_line["is_blocked"] is True
        assert tea_line["charged_cases"] == 0
        assert float(tea_line["line_total"]) == 0.0
        assert len(tea_line["warnings"]) > 0
        assert "out of stock" in tea_line["warnings"][0].lower()


class TestOrdersLifecycle:
    """Tests for POST /orders, credit hold, idempotency, and server re-quoting."""

    def test_credit_hold_triggers_for_near_limit_retailer(self, client: TestClient):
        """credit hold triggers for the near-limit retailer.

        Retailer 2 (Sharma Provision Store):
        credit_limit = 80,000.00, outstanding = 76,500.00 (available = 3,500.00).
        Order with 5 biscuit + 2 detergent = payable 8,873.20.
        76,500 + 8,873.20 = 85,373.20 > 80,000 -> credit_hold!
        """
        token = login_as(client, phone="9826022222")  # Retailer 2
        headers = {"Authorization": f"Bearer {token}"}

        payload = {
            "retailer_id": 2,
            "lines": [
                {"sku_code": "SKU-BS-075", "qty_cases": 5},
                {"sku_code": "SKU-DT-1KG", "qty_cases": 2},
            ],
            "client_request_id": "req-sharma-order-1",
        }
        response = client.post("/orders", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "credit_hold"
        assert float(data["total"]) == pytest.approx(8873.20)

    def test_order_pending_for_retailer_with_sufficient_credit(self, client: TestClient):
        """Retailer 1 with 100,000 limit and 25,000 outstanding gets status=pending."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        payload = {
            "retailer_id": 1,
            "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 5}],
            "client_request_id": "req-gupta-order-1",
        }
        response = client.post("/orders", json=payload, headers=headers)
        assert response.status_code == 200
        assert response.json()["status"] == "pending"

    def test_duplicate_client_request_id_returns_same_order(self, client: TestClient):
        """duplicate client_request_id returns the same order."""
        token = login_as(client, phone="9826011111")
        headers = {"Authorization": f"Bearer {token}"}

        payload = {
            "retailer_id": 1,
            "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 5}],
            "client_request_id": "idempotent-key-abc",
        }
        # First attempt
        res1 = client.post("/orders", json=payload, headers=headers)
        assert res1.status_code == 200
        order_1_id = res1.json()["id"]

        # Duplicate attempt with identical client_request_id
        res2 = client.post("/orders", json=payload, headers=headers)
        assert res2.status_code == 200
        order_2_id = res2.json()["id"]

        # Must return the same order without creating another
        assert order_1_id == order_2_id

    def test_order_totals_ignore_client_sent_totals(self, client: TestClient):
        """order totals ignore client-sent totals."""
        token = login_as(client, phone="9826011111")
        headers = {"Authorization": f"Bearer {token}"}

        # Client attempts to cheat by providing total=1.00
        payload = {
            "retailer_id": 1,
            "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 10}],
            "client_request_id": "cheat-attempt-1",
            "total": 1.00,
        }
        response = client.post("/orders", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        # 10 cases * 777.60 = 7,776.00 + 5% GST (388.80) = 8,164.80
        assert float(data["total"]) == pytest.approx(8164.80)
        assert float(data["total"]) != 1.00


class TestDeskEndpointsAndPermissions:
    """Tests for /desk/orders, PATCH /desk/orders/{id}, and GET /retailers."""

    def test_retailer_calling_patch_returns_403(self, client: TestClient):
        """retailer calling PATCH returns 403."""
        token = login_as(client, phone="9826011111")  # Retailer
        headers = {"Authorization": f"Bearer {token}"}

        response = client.patch(
            "/desk/orders/1",
            json={"status": "approved"},
            headers=headers,
        )
        assert response.status_code == 403

    def test_desk_orders_list_with_age_and_filter(self, client: TestClient):
        """Desk operator lists orders with retailer name, total, status, source, age."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        response = client.get("/desk/orders", headers=headers)
        assert response.status_code == 200
        orders = response.json()
        assert len(orders) >= 1
        first = orders[0]
        assert "retailer" in first
        assert "total" in first
        assert "status" in first
        assert "source" in first
        assert "age" in first

    def test_desk_order_detail_credit_position(self, client: TestClient):
        """Desk gets order detail including credit position."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Order 2 in seed is for Sharma (near limit)
        response = client.get("/desk/orders/2", headers=headers)
        assert response.status_code == 200
        detail = response.json()
        assert detail["id"] == 2
        credit_pos = detail["credit_position"]
        assert "credit_limit" in credit_pos
        assert "outstanding" in credit_pos
        assert "projected_outstanding" in credit_pos
        assert "is_over_limit" in credit_pos

    def test_approving_credit_hold_requires_explicit_override_flag_and_reason(self, client: TestClient):
        """Approving a credit_hold order requires override_flag and override_reason."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Try approving without override flag or reason -> 400
        bad_patch = client.patch(
            "/desk/orders/2",
            json={"status": "approved"},
            headers=headers,
        )
        assert bad_patch.status_code == 400
        assert "override" in bad_patch.json()["detail"].lower()

        # Approve with override flag and reason -> 200
        good_patch = client.patch(
            "/desk/orders/2",
            json={
                "status": "approved",
                "override_flag": True,
                "override_reason": "Merchant promised payment by cheque tomorrow",
            },
            headers=headers,
        )
        assert good_patch.status_code == 200
        assert good_patch.json()["status"] == "approved"
        assert good_patch.json()["override_flag"] is True
        assert good_patch.json()["override_reason"] == "Merchant promised payment by cheque tomorrow"

    def test_stock_reduced_only_when_desk_approves(self, client: TestClient, session):
        """Reduce stock only when the desk approves."""
        # 1. Place a pending order for 10 cases of biscuit (1 free -> 11 total stock)
        ret_token = login_as(client, phone="9826011111")
        headers_ret = {"Authorization": f"Bearer {ret_token}"}

        sku_before = session.exec(select(SKU).where(SKU.code == "SKU-BS-075")).first()
        stock_initial = sku_before.stock_cases

        order_res = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 10}],
                "client_request_id": "stock-check-req-1",
            },
            headers=headers_ret,
        )
        order_id = order_res.json()["id"]

        # Stock must NOT be reduced while pending
        session.expire_all()
        sku_pending = session.exec(select(SKU).where(SKU.code == "SKU-BS-075")).first()
        assert sku_pending.stock_cases == stock_initial

        # 2. Desk approves order
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        patch_res = client.patch(
            f"/desk/orders/{order_id}",
            json={"status": "approved"},
            headers=headers_desk,
        )
        assert patch_res.status_code == 200

        # Now stock must be reduced by 11 cases (10 charged + 1 free)
        session.expire_all()
        sku_approved = session.exec(select(SKU).where(SKU.code == "SKU-BS-075")).first()
        assert sku_approved.stock_cases == stock_initial - 11

    def test_get_retailers_desk_and_owner_only(self, client: TestClient):
        """GET /retailers returns id and name for all retailers, restricted to desk and owner."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        res = client.get("/retailers", headers=headers_desk)
        assert res.status_code == 200
        retailers = res.json()
        assert len(retailers) >= 4
        for r in retailers:
            assert "id" in r
            assert "name" in r

        # Owner also allowed
        owner_token = login_as(client, phone="9826000003")
        headers_owner = {"Authorization": f"Bearer {owner_token}"}
        owner_res = client.get("/retailers", headers=headers_owner)
        assert owner_res.status_code == 200

        # Retailer forbidden -> 403
        ret_token = login_as(client, phone="9826011111")
        headers_ret = {"Authorization": f"Bearer {ret_token}"}
        ret_res = client.get("/retailers", headers=headers_ret)
        assert ret_res.status_code == 403

        # Salesman forbidden -> 403
        sm_token = login_as(client, phone="9826000002")
        headers_sm = {"Authorization": f"Bearer {sm_token}"}
        sm_res = client.get("/retailers", headers=headers_sm)
        assert sm_res.status_code == 403

