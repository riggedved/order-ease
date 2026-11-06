"""Tests for GET /desk/export/tally (XML and CSV export formats)."""

import csv
from datetime import datetime, timezone
from decimal import Decimal
import io
import xml.etree.ElementTree as ET
import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from backend.app.models import SKU, Retailer, Order, OrderLine, OrderStatus, OrderSource, Role


def login_as(client: TestClient, phone: str, otp: str = "123456") -> str:
    """Helper to authenticate and retrieve access token."""
    response = client.post("/auth/otp", json={"phone": phone, "otp": otp})
    assert response.status_code == 200
    return response.json()["access_token"]


class TestTallyExportEndpoint:
    """Tests for GET /desk/export/tally?format=xml|csv"""

    def test_sample_order_biscuit_5_detergent_2_exports_2_entries_and_voucher_total_7948(
        self, client: TestClient, session
    ):
        """The sample order (biscuit 5, detergent 2) exports 2 inventory entries and
        voucher total 7948.00.
        """
        desk_token = login_as(client, phone="9826000001")  # Desk user
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        # Create sample order for Retailer 1
        order = Order(
            retailer_id=1,
            status=OrderStatus.APPROVED,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("7948.00"),
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        # Line 1: Biscuit 5 cases (5 x 777.60 = 3888.00)
        line1 = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=5,
            charged_cases=5,
            free_cases=0,
            price_per_case=Decimal("777.60"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("3888.00"),
        )
        # Line 2: Detergent 2 cases (2 x 2030.00 = 4060.00)
        line2 = OrderLine(
            order_id=order.id,
            sku_code="SKU-DT-1KG",
            qty_cases=2,
            charged_cases=2,
            free_cases=0,
            price_per_case=Decimal("2030.00"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("4060.00"),
        )
        session.add(line1)
        session.add(line2)
        session.commit()

        # Export XML
        res = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res.status_code == 200
        assert "application/xml" in res.headers["content-type"]
        assert "X-Tally-Export-Warning" in res.headers
        assert "MOCK export, not validated against a real Tally." in res.headers["X-Tally-Export-Warning"]
        assert "attachment; filename=" in res.headers["content-disposition"]
        assert res.headers["content-disposition"].endswith('.xml"')

        # Parse XML
        root = ET.fromstring(res.text)
        assert root.tag == "ENVELOPE"

        voucher = root.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']")
        assert voucher is not None
        assert voucher.find("VOUCHERTYPENAME").text == "Sales Order"
        assert voucher.find("VOUCHERTOTAL").text == "7948.00"

        # Check 2 inventory entries
        entries = voucher.findall("ALLINVENTORYENTRIES.LIST")
        assert len(entries) == 2

        # Entry 1: Biscuit
        e1 = entries[0]
        assert e1.find("STOCKITEMNAME").text == "Glucose biscuit 75 g, case of 96"
        assert e1.find("RATE").text == "777.60"
        assert e1.find("BILLEDQTY").text == "5"
        assert e1.find("ACTUALQTY").text == "5"
        assert e1.find("AMOUNT").text == "3888.00"

        # Entry 2: Detergent
        e2 = entries[1]
        assert e2.find("STOCKITEMNAME").text == "Detergent powder 1 kg, case of 20"
        assert e2.find("RATE").text == "2030.00"
        assert e2.find("BILLEDQTY").text == "2"
        assert e2.find("ACTUALQTY").text == "2"
        assert e2.find("AMOUNT").text == "4060.00"

    def test_biscuit_10_cases_exports_a_free_goods_entry_with_amount_0(
        self, client: TestClient, session
    ):
        """Biscuit 10 cases exports a free-goods entry with amount 0."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        order = Order(
            retailer_id=1,
            status=OrderStatus.APPROVED,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("7776.00"),
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        # 10 charged cases + 1 free case
        line = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=10,
            charged_cases=10,
            free_cases=1,
            price_per_case=Decimal("777.60"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("7776.00"),
        )
        session.add(line)
        session.commit()

        res = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res.status_code == 200

        root = ET.fromstring(res.text)
        voucher = root.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']")
        assert voucher is not None

        entries = voucher.findall("ALLINVENTORYENTRIES.LIST")
        assert len(entries) == 2

        # 1st entry: charged goods
        charged_entry = entries[0]
        assert charged_entry.find("STOCKITEMNAME").text == "Glucose biscuit 75 g, case of 96"
        assert charged_entry.find("RATE").text == "777.60"
        assert charged_entry.find("BILLEDQTY").text == "10"
        assert charged_entry.find("ACTUALQTY").text == "10"
        assert charged_entry.find("AMOUNT").text == "7776.00"

        # 2nd entry: free goods with rate 0 and amount 0
        free_entry = entries[1]
        assert free_entry.find("STOCKITEMNAME").text == "Glucose biscuit 75 g, case of 96"
        assert free_entry.find("RATE").text == "0.00"
        assert free_entry.find("AMOUNT").text == "0.00"
        assert free_entry.find("ACTUALQTY").text == "1"
        assert free_entry.find("BILLEDQTY").text == "0"

    def test_order_with_ampersand_in_retailer_name_produces_valid_xml(
        self, client: TestClient, session
    ):
        """An order with '&' in the retailer name produces valid XML (parse it back)."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        retailer = Retailer(
            name="Gupta & Sons Kirana & General Store",
            phone="9826099999",
            credit_limit=Decimal("50000.00"),
            outstanding=Decimal("0.00"),
        )
        session.add(retailer)
        session.commit()
        session.refresh(retailer)

        order = Order(
            retailer_id=retailer.id,
            status=OrderStatus.APPROVED,
            source=OrderSource.DESK_CAPTURE,
            placed_by_user_id=1,
            total=Decimal("777.60"),
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        line = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=1,
            charged_cases=1,
            free_cases=0,
            price_per_case=Decimal("777.60"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("777.60"),
        )
        session.add(line)
        session.commit()

        res = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res.status_code == 200

        # Parse it back successfully
        root = ET.fromstring(res.text)
        voucher = root.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']")
        assert voucher is not None
        assert voucher.find("PARTYLEDGERNAME").text == "Gupta & Sons Kirana & General Store"

    def test_pending_and_credit_hold_orders_are_not_exported(
        self, client: TestClient, session
    ):
        """Pending and credit_hold orders are not exported."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        # Pending order
        o_pending = Order(
            retailer_id=1,
            status=OrderStatus.PENDING,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("1000.00"),
        )
        # Credit hold order
        o_hold = Order(
            retailer_id=1,
            status=OrderStatus.CREDIT_HOLD,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("2000.00"),
        )
        session.add(o_pending)
        session.add(o_hold)
        session.commit()

        res = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res.status_code == 200

        root = ET.fromstring(res.text)
        assert root.find(f".//VOUCHER[VOUCHERNUMBER='{o_pending.id}']") is None
        assert root.find(f".//VOUCHER[VOUCHERNUMBER='{o_hold.id}']") is None

    def test_second_export_skips_already_exported_orders_include_exported_returns_them(
        self, client: TestClient, session
    ):
        """Second export skips already-exported orders; include_exported=true returns them."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        order = Order(
            retailer_id=1,
            status=OrderStatus.APPROVED,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("3888.00"),
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        line = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=5,
            charged_cases=5,
            free_cases=0,
            price_per_case=Decimal("777.60"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("3888.00"),
        )
        session.add(line)
        session.commit()

        # 1st export: order is exported and stamped with exported_at
        res1 = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res1.status_code == 200
        root1 = ET.fromstring(res1.text)
        assert root1.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']") is not None

        # Verify exported_at is now set on the order
        session.expire_all()
        order_db = session.get(Order, order.id)
        assert order_db.exported_at is not None

        # 2nd export (include_exported=False by default): order is skipped
        res2 = client.get("/desk/export/tally?format=xml", headers=headers_desk)
        assert res2.status_code == 200
        root2 = ET.fromstring(res2.text)
        assert root2.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']") is None

        # 3rd export (include_exported=true): order is included again
        res3 = client.get("/desk/export/tally?format=xml&include_exported=true", headers=headers_desk)
        assert res3.status_code == 200
        root3 = ET.fromstring(res3.text)
        assert root3.find(f".//VOUCHER[VOUCHERNUMBER='{order.id}']") is not None

    def test_retailer_and_salesman_calling_endpoint_gets_403(self, client: TestClient):
        """Retailer and salesman calling GET /desk/export/tally get 403."""
        # Retailer
        ret_token = login_as(client, phone="9826011111")
        res_ret = client.get(
            "/desk/export/tally?format=xml",
            headers={"Authorization": f"Bearer {ret_token}"},
        )
        assert res_ret.status_code == 403

        # Salesman
        sm_token = login_as(client, phone="9826000002")
        res_sm = client.get(
            "/desk/export/tally?format=xml",
            headers={"Authorization": f"Bearer {sm_token}"},
        )
        assert res_sm.status_code == 403

        # Owner is allowed
        owner_token = login_as(client, phone="9826000003")
        res_owner = client.get(
            "/desk/export/tally?format=xml",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert res_owner.status_code == 200

    def test_csv_export_format_and_columns(self, client: TestClient, session):
        """CSV export contains exact columns and row values per order line."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        order = Order(
            retailer_id=1,
            status=OrderStatus.APPROVED,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("7948.00"),
            override_reason="Credit limit overridden by desk",
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        line1 = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=5,
            charged_cases=5,
            free_cases=0,
            price_per_case=Decimal("777.60"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("3888.00"),
        )
        line2 = OrderLine(
            order_id=order.id,
            sku_code="SKU-DT-1KG",
            qty_cases=2,
            charged_cases=2,
            free_cases=0,
            price_per_case=Decimal("2030.00"),
            discount_amount=Decimal("0.00"),
            line_total=Decimal("4060.00"),
        )
        session.add(line1)
        session.add(line2)
        session.commit()

        res = client.get("/desk/export/tally?format=csv&include_exported=true", headers=headers_desk)
        assert res.status_code == 200
        assert "text/csv" in res.headers["content-type"]
        assert "attachment; filename=" in res.headers["content-disposition"]
        assert res.headers["content-disposition"].endswith('.csv"')

        # Read CSV rows
        reader = csv.DictReader(io.StringIO(res.text))
        expected_fields = [
            "order_id",
            "date",
            "retailer",
            "sku_code",
            "sku_name",
            "qty_cases",
            "free_cases",
            "rate_per_case",
            "discount",
            "line_total",
            "gst_rate",
            "order_total",
            "source",
            "override_reason",
        ]
        assert reader.fieldnames == expected_fields

        rows = [r for r in reader if r["order_id"] == str(order.id)]
        assert len(rows) == 2

        # Biscuit row
        r1 = rows[0]
        assert r1["sku_code"] == "SKU-BS-075"
        assert r1["sku_name"] == "Glucose biscuit 75 g, case of 96"
        assert r1["qty_cases"] == "5"
        assert r1["free_cases"] == "0"
        assert r1["rate_per_case"] == "777.60"
        assert r1["discount"] == "0.00"
        assert r1["line_total"] == "3888.00"
        assert r1["order_total"] == "7948.00"
        assert r1["source"] == "retailer_app"
        assert r1["override_reason"] == "Credit limit overridden by desk"

        # Detergent row
        r2 = rows[1]
        assert r2["sku_code"] == "SKU-DT-1KG"
        assert r2["sku_name"] == "Detergent powder 1 kg, case of 20"
        assert r2["qty_cases"] == "2"
        assert r2["free_cases"] == "0"
        assert r2["rate_per_case"] == "2030.00"
        assert r2["discount"] == "0.00"
        assert r2["line_total"] == "4060.00"
        assert r2["order_total"] == "7948.00"

