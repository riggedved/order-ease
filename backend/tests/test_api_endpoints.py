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

    def test_gst_only_calculated_on_items_exclusive_of_gst(self, client: TestClient):
        """GST is only calculated on items where price_includes_gst is False."""
        token = login_as(client, phone="9826011111")
        headers = {"Authorization": f"Bearer {token}"}

        # SKU-BS-075: price_includes_gst=False, case_price=777.60, gst_rate=0.05
        # SKU-BS-150: price_includes_gst=True, case_price=720.00, gst_rate=0.05
        payload = {
            "retailer_id": 1,
            "lines": [
                {"sku_code": "SKU-BS-075", "qty_cases": 1},
                {"sku_code": "SKU-BS-150", "qty_cases": 1},
            ],
        }
        res = client.post("/cart/quote", json=payload, headers=headers)
        assert res.status_code == 200
        data = res.json()

        # SKU-BS-075 (exclusive): line_subtotal = 777.60, gst = 38.88
        # SKU-BS-150 (inclusive): line_subtotal = 720.00, gst = 0.00
        assert float(data["subtotal"]) == pytest.approx(1497.60)
        assert float(data["gst_amount"]) == pytest.approx(38.88)
        assert float(data["payable"]) == pytest.approx(1536.48)
        assert float(data["lines"][0]["gst_amount"]) == pytest.approx(38.88)
        assert float(data["lines"][1]["gst_amount"]) == pytest.approx(0.00)


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

    def test_order_within_credit_limit_decreases_available_limit_by_order_value(self, client: TestClient):
        """Orders within credit limit are placed normally (pending) and decrease available limit by order value."""
        token = login_as(client, phone="9826011111")  # Retailer 1 (Gupta: limit=100,000, initial outstanding=25,000)
        headers = {"Authorization": f"Bearer {token}"}

        # Check initial credit state: available = 75,000.00
        me_before = client.get("/me", headers=headers).json()
        assert float(me_before["credit_limit"]) == pytest.approx(100000.00)
        assert float(me_before["outstanding"]) == pytest.approx(25000.00)
        assert float(me_before["available_credit"]) == pytest.approx(75000.00)

        # Place order for 10 cases of biscuit = 8,164.80 incl GST
        payload = {
            "retailer_id": 1,
            "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 10}],
            "client_request_id": "req-gupta-limit-decrease-1",
        }
        res = client.post("/orders", json=payload, headers=headers)
        assert res.status_code == 200
        order_data = res.json()
        assert order_data["status"] == "pending"
        order_total = float(order_data["total"])
        assert order_total == pytest.approx(8164.80)

        # Verify limit decreased via /me
        me_after = client.get("/me", headers=headers).json()
        assert float(me_after["outstanding"]) == pytest.approx(25000.00 + order_total)
        assert float(me_after["available_credit"]) == pytest.approx(75000.00 - order_total)

        # Verify limit decreased via /retailers/1
        ret_res = client.get("/retailers/1", headers=headers).json()
        assert float(ret_res["outstanding"]) == pytest.approx(25000.00 + order_total)
        available = float(ret_res["credit_limit"]) - float(ret_res["outstanding"])
        assert available == pytest.approx(75000.00 - order_total)

    def test_cancel_pending_order_restores_credit_limit(self, client: TestClient):
        """Cancelling a pending order marks status as cancelled and restores the credit limit."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Place order
        res = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 10}],
                "client_request_id": "req-gupta-cancel-test-1",
            },
            headers=headers,
        )
        assert res.status_code == 200
        order_id = res.json()["id"]
        order_total = float(res.json()["total"])

        # Check outstanding increased
        me_after_place = client.get("/me", headers=headers).json()
        assert float(me_after_place["outstanding"]) == pytest.approx(25000.00 + order_total)

        # 2. Cancel order
        cancel_res = client.post(f"/orders/{order_id}/cancel", headers=headers)
        assert cancel_res.status_code == 200
        cancelled_data = cancel_res.json()
        assert cancelled_data["status"] == "cancelled"

        # 3. Check outstanding restored to 25,000
        me_after_cancel = client.get("/me", headers=headers).json()
        assert float(me_after_cancel["outstanding"]) == pytest.approx(25000.00)
        assert float(me_after_cancel["available_credit"]) == pytest.approx(75000.00)

    def test_cancel_credit_hold_order(self, client: TestClient):
        """Cancelling a credit_hold order marks status as cancelled without changing outstanding."""
        token = login_as(client, phone="9826022222")  # Retailer 2 (Sharma)
        headers = {"Authorization": f"Bearer {token}"}

        # Seeded order 2 is credit_hold for Sharma
        cancel_res = client.post("/orders/2/cancel", headers=headers)
        assert cancel_res.status_code == 200
        assert cancel_res.json()["status"] == "cancelled"

        # Sharma's outstanding remains 76,500.00
        me_res = client.get("/me", headers=headers).json()
        assert float(me_res["outstanding"]) == pytest.approx(76500.00)

    def test_cancel_approved_order_fails(self, client: TestClient):
        """Cannot cancel an approved order."""
        token = login_as(client, phone="9826011111")  # Retailer 1 (Gupta owns seeded order 1)
        headers = {"Authorization": f"Bearer {token}"}

        # Seeded order 1 is approved
        res = client.post("/orders/1/cancel", headers=headers)
        assert res.status_code == 400
        assert "Cannot cancel" in res.json()["detail"]

    def test_cancel_other_retailer_order_forbidden(self, client: TestClient):
        """Retailer cannot cancel another retailer's order."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        # Order 2 belongs to Retailer 2 (Sharma)
        res = client.post("/orders/2/cancel", headers=headers)
        assert res.status_code == 403

    def test_pay_outstanding_partial_and_full(self, client: TestClient):
        """Retailer can pay outstanding balance partially and fully, restoring available credit."""
        token = login_as(client, phone="9826011111")  # Retailer 1 (Gupta: limit=100,000, outstanding=25,000)
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Partial payment of 10,000
        pay_res1 = client.post("/me/pay", json={"amount": 10000.00}, headers=headers)
        assert pay_res1.status_code == 200
        data1 = pay_res1.json()
        assert data1["success"] is True
        assert float(data1["amount_paid"]) == pytest.approx(10000.00)
        assert float(data1["new_outstanding"]) == pytest.approx(15000.00)
        assert float(data1["new_available_credit"]) == pytest.approx(85000.00)

        # 2. Full payment with no payload (pays remaining 15,000)
        pay_res2 = client.post("/me/pay", json={}, headers=headers)
        assert pay_res2.status_code == 200
        data2 = pay_res2.json()
        assert data2["success"] is True
        assert float(data2["amount_paid"]) == pytest.approx(15000.00)
        assert float(data2["new_outstanding"]) == pytest.approx(0.00)
        assert float(data2["new_available_credit"]) == pytest.approx(100000.00)

        # 3. Paying when outstanding is 0 fails with 400
        pay_res3 = client.post("/me/pay", json={}, headers=headers)
        assert pay_res3.status_code == 400
        assert "No outstanding" in pay_res3.json()["detail"]

    def test_pay_outstanding_forbidden_for_staff(self, client: TestClient):
        """Staff (order_desk) cannot call /me/pay."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}
        res = client.post("/me/pay", json={"amount": 5000.00}, headers=headers)
        assert res.status_code == 403

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

    def test_get_my_orders_limit_parameter_and_newest_first(self, client: TestClient):
        """GET /orders/mine with limit=3 returns at most 3 orders, newest first."""
        token = login_as(client, phone="9826011111")  # Retailer 1 (Gupta)
        headers = {"Authorization": f"Bearer {token}"}

        # Retailer 1 already has 1 seeded order (id=1)
        # Create 3 more orders to have a total of 4 orders
        res2 = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 1}],
                "client_request_id": "req-mine-order-2",
            },
            headers=headers,
        )
        assert res2.status_code == 200
        order_2_id = res2.json()["id"]

        res3 = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 2}],
                "client_request_id": "req-mine-order-3",
            },
            headers=headers,
        )
        assert res3.status_code == 200
        order_3_id = res3.json()["id"]

        res4 = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 3}],
                "client_request_id": "req-mine-order-4",
            },
            headers=headers,
        )
        assert res4.status_code == 200
        order_4_id = res4.json()["id"]

        # Without limit -> returns all 4 orders
        all_orders = client.get("/orders/mine", headers=headers).json()
        assert len(all_orders) == 4

        # With limit=3 -> returns at most 3 orders, newest first
        res_limit3 = client.get("/orders/mine?limit=3", headers=headers)
        assert res_limit3.status_code == 200
        orders_3 = res_limit3.json()
        assert len(orders_3) == 3

        # Newest first: order 4, order 3, order 2
        assert orders_3[0]["id"] == order_4_id
        assert orders_3[1]["id"] == order_3_id
        assert orders_3[2]["id"] == order_2_id

    def test_retailer_never_sees_another_retailers_data_returns_403(self, client: TestClient):
        """A retailer never sees another retailer's data (403)."""
        token_1 = login_as(client, phone="9826011111")  # Retailer 1
        headers_1 = {"Authorization": f"Bearer {token_1}"}

        # 1. Retailer profile: GET /retailers/2 -> 403
        res_profile = client.get("/retailers/2", headers=headers_1)
        assert res_profile.status_code == 403

        # 2. Catalogue: GET /catalogue?retailer_id=2 -> 403
        res_cat = client.get("/catalogue?retailer_id=2", headers=headers_1)
        assert res_cat.status_code == 403

        # 3. Cart quote: POST /cart/quote for retailer 2 -> 403
        res_quote = client.post(
            "/cart/quote",
            json={"retailer_id": 2, "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 1}]},
            headers=headers_1,
        )
        assert res_quote.status_code == 403

        # 4. Order creation: POST /orders for retailer 2 -> 403
        res_order = client.post(
            "/orders",
            json={
                "retailer_id": 2,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 1}],
                "client_request_id": "unauth-order-attempt",
            },
            headers=headers_1,
        )
        assert res_order.status_code == 403

        # 5. Capture: POST /capture for retailer 2 -> 403
        res_cap = client.post(
            "/capture",
            json={"retailer_id": 2, "text": "5 peti biscuit"},
            headers=headers_1,
        )
        assert res_cap.status_code == 403


class TestDeskEndpointsAndPermissions:
    """Tests for /desk/orders, PATCH /desk/orders/{id}, GET /desk/catalogue, and GET /retailers."""

    def test_retailer_calling_patch_returns_403(self, client: TestClient):
        """retailer calling PATCH returns 403."""
        token = login_as(client, phone="9826011111")  # Retailer
        headers = {"Authorization": f"Bearer {token}"}

        response = client.patch(
            "/desk/orders/1",
            json={"version": 1, "status": "approved"},
            headers=headers,
        )
        assert response.status_code == 403

    def test_desk_orders_list_with_age_and_filter(self, client: TestClient):
        """Desk operator lists orders with retailer name, total, status, source, age."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        response = client.get("/desk/orders", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "counts" in data
        orders = data["items"]
        assert len(orders) >= 1
        first = orders[0]
        assert "retailer" in first
        assert "total" in first
        assert "status" in first
        assert "source" in first
        assert "age" in first

    def test_desk_orders_counts_on_seeded_set(self, client: TestClient):
        """Counts equal 1 credit_hold, 2 pending, 1 approved on seeded set."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        res = client.get("/desk/orders", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 4
        assert data["counts"]["all"] == 4
        assert data["counts"]["credit_hold"] == 1
        assert data["counts"]["pending"] == 2
        assert data["counts"]["approved"] == 1
        assert len(data["items"]) == 4

    def test_desk_orders_q_filter_and_counts(self, client: TestClient):
        """q filters by retailer name and counts respect q."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Filter for Sharma -> only 1 order in seed (credit_hold)
        res = client.get("/desk/orders?q=Sharma", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 1
        assert data["counts"]["all"] == 1
        assert data["counts"]["credit_hold"] == 1
        assert data["counts"]["pending"] == 0
        assert data["counts"]["approved"] == 0
        assert data["items"][0]["retailer"] == "Sharma Provision Store"

    def test_desk_orders_pagination_limit_and_offset(self, client: TestClient):
        """Limit and offset page correctly."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Page 1: limit 2, offset 0
        res1 = client.get("/desk/orders?limit=2&offset=0&sort=newest", headers=headers)
        assert res1.status_code == 200
        data1 = res1.json()
        assert len(data1["items"]) == 2
        assert data1["total"] == 4
        page1_ids = [item["id"] for item in data1["items"]]

        # Page 2: limit 2, offset 2
        res2 = client.get("/desk/orders?limit=2&offset=2&sort=newest", headers=headers)
        assert res2.status_code == 200
        data2 = res2.json()
        assert len(data2["items"]) == 2
        assert data2["total"] == 4
        page2_ids = [item["id"] for item in data2["items"]]

        # Disjoint pages
        assert set(page1_ids).isdisjoint(set(page2_ids))

    def test_desk_order_detail_full_schema(self, client: TestClient):
        """GET /desk/orders/{id} returns all required order and line fields."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Order 1 in seed (approved)
        res = client.get("/desk/orders/1", headers=headers)
        assert res.status_code == 200
        order = res.json()
        assert order["id"] == 1
        assert order["source"] == "retailer_app"
        assert "created_at" in order
        assert order["placed_by"] == "Ramesh Gupta"
        assert order["override_flag"] is False
        assert order["override_reason"] is None
        assert order["approved_by"] == "Desk Officer Priya"
        assert order["approved_at"] is not None
        assert order["version"] == 1
        assert "credit_position" in order

        # Check lines
        assert len(order["lines"]) == 1
        line = order["lines"][0]
        assert line["line_id"] == 1
        assert line["sku_code"] == "SKU-BS-075"
        assert line["sku_name"] == "Glucose biscuit 75 g, case of 96"
        assert line["qty_cases"] == 10
        assert line["free_cases"] == 1
        assert line["line_total"] == "7776.00"
        assert "original_words" in line

    def test_desk_catalogue_desk_and_owner_only(self, client: TestClient):
        """GET /desk/catalogue returns exact stock_cases for desk and owner only."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        res = client.get("/desk/catalogue", headers=headers_desk)
        assert res.status_code == 200
        skus = res.json()
        assert len(skus) >= 3
        bs075 = next(s for s in skus if s["sku_code"] == "SKU-BS-075")
        assert bs075["name"] == "Glucose biscuit 75 g, case of 96"
        assert bs075["case_price"] == "777.60"
        assert bs075["units_per_case"] == 96
        assert bs075["price_includes_gst"] is False
        assert bs075["stock_cases"] == 340

        # Owner also allowed
        owner_token = login_as(client, phone="9826000003")
        headers_owner = {"Authorization": f"Bearer {owner_token}"}
        owner_res = client.get("/desk/catalogue", headers=headers_owner)
        assert owner_res.status_code == 200

        # Retailer gets 403
        ret_token = login_as(client, phone="9826011111")
        headers_ret = {"Authorization": f"Bearer {ret_token}"}
        ret_res = client.get("/desk/catalogue", headers=headers_ret)
        assert ret_res.status_code == 403

    def test_patch_order_versioning_and_concurrency(self, client: TestClient):
        """Stale version returns 409, approving twice returns 409, approved_by stored."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Order 3 is seeded as PENDING with version=1
        detail = client.get("/desk/orders/3", headers=headers).json()
        assert detail["version"] == 1
        assert detail["status"] == "pending"

        # 1. Stale version returns 409
        stale_res = client.patch(
            "/desk/orders/3",
            json={"version": 999, "status": "approved"},
            headers=headers,
        )
        assert stale_res.status_code == 409
        assert stale_res.json()["detail"] == "This order was changed by someone else. Reload it."

        # Missing version also returns 409
        missing_ver_res = client.patch(
            "/desk/orders/3",
            json={"status": "approved"},
            headers=headers,
        )
        assert missing_ver_res.status_code == 409
        assert missing_ver_res.json()["detail"] == "This order was changed by someone else. Reload it."

        # 2. Approve with correct version=1 -> 200 OK
        approve_res = client.patch(
            "/desk/orders/3",
            json={"version": 1, "status": "approved"},
            headers=headers,
        )
        assert approve_res.status_code == 200
        approved_data = approve_res.json()
        assert approved_data["status"] == "approved"
        assert approved_data["version"] == 2
        assert approved_data["approved_by"] == "Desk Officer Priya"
        assert approved_data["approved_at"] is not None

        # 3. Approving twice returns 409
        double_approve_res = client.patch(
            "/desk/orders/3",
            json={"version": 2, "status": "approved"},
            headers=headers,
        )
        assert double_approve_res.status_code == 409

    def test_patch_order_line_edit_qty_and_sku(self, client: TestClient):
        """A line edit may change qty_cases and sku_code, incrementing version."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Order 4 is seeded as PENDING with version=1 (SKU-BS-075, 2 cases)
        patch_res = client.patch(
            "/desk/orders/4",
            json={
                "version": 1,
                "lines": [{"sku_code": "SKU-DT-1KG", "qty_cases": 3}],
            },
            headers=headers,
        )
        assert patch_res.status_code == 200
        data = patch_res.json()
        assert data["version"] == 2
        assert len(data["lines"]) == 1
        assert data["lines"][0]["sku_code"] == "SKU-DT-1KG"
        assert data["lines"][0]["qty_cases"] == 3
        assert data["lines"][0]["line_total"] == "6090.00"

    def test_patch_order_insufficient_stock_structured_error(self, client: TestClient, session):
        """Insufficient stock reports structured error with sku_code and available."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        # Order 3 is seeded as PENDING: 2 cases of SKU-DT-1KG (needs 2 cases).
        # Reduce SKU-DT-1KG stock to 1 case in DB so it cannot be approved
        sku = session.exec(select(SKU).where(SKU.code == "SKU-DT-1KG")).first()
        sku.stock_cases = 1
        session.add(sku)
        session.commit()

        # Try approving Order 3 (version 1) -> 400 with structured insufficient stock error
        approve_res = client.patch(
            "/desk/orders/3",
            json={"version": 1, "status": "approved"},
            headers=headers,
        )
        assert approve_res.status_code == 400
        detail = approve_res.json()["detail"]
        assert detail["error"] == "insufficient_stock"
        assert detail["sku_code"] == "SKU-DT-1KG"
        assert detail["available"] == 1

    def test_get_retailers_q_filter(self, client: TestClient):
        """GET /retailers?q= filters retailers by name."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        res = client.get("/retailers?q=Gupta", headers=headers)
        assert res.status_code == 200
        retailers = res.json()
        assert len(retailers) == 1
        assert retailers[0]["name"] == "Gupta Kirana Store"

    def test_get_me_for_staff(self, client: TestClient):
        """GET /me for staff returns name and role."""
        desk_token = login_as(client, phone="9826000001")
        headers = {"Authorization": f"Bearer {desk_token}"}

        res = client.get("/me", headers=headers)
        assert res.status_code == 200
        me = res.json()
        assert me["name"] == "Desk Officer Priya"
        assert me["role"] == "order_desk"

        # Owner
        owner_token = login_as(client, phone="9826000003")
        owner_res = client.get("/me", headers={"Authorization": f"Bearer {owner_token}"})
        assert owner_res.status_code == 200
        assert owner_res.json()["name"] == "Owner Rajesh Agarwal"
        assert owner_res.json()["role"] == "owner"

    def test_retailer_calling_desk_endpoints_returns_403(self, client: TestClient):
        """A retailer calling /desk/orders, /desk/orders/{id}, PATCH, /desk/catalogue, /retailers gets 403."""
        ret_token = login_as(client, phone="9826011111")
        headers = {"Authorization": f"Bearer {ret_token}"}

        assert client.get("/desk/orders", headers=headers).status_code == 403
        assert client.get("/desk/orders/1", headers=headers).status_code == 403
        assert client.patch("/desk/orders/1", json={"version": 1, "status": "approved"}, headers=headers).status_code == 403
        assert client.get("/desk/catalogue", headers=headers).status_code == 403
        assert client.get("/retailers", headers=headers).status_code == 403

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
            json={"version": 1, "status": "approved"},
            headers=headers,
        )
        assert bad_patch.status_code == 400
        assert "override" in bad_patch.json()["detail"].lower()

        # Approve with override flag and reason -> 200
        good_patch = client.patch(
            "/desk/orders/2",
            json={
                "version": 1,
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
            json={"version": 1, "status": "approved"},
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

