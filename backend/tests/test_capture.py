"""Tests for the vernacular order capture engine, parsers, and endpoints."""

from decimal import Decimal
import json
import os
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from backend.app.capture import get_parser, RuleBasedParser, LLMParser
from backend.app.models import SKU, Retailer, Order, OrderLine, Alias, Role, OrderStatus, OrderSource


def login_as(client: TestClient, phone: str, otp: str = "123456") -> str:
    response = client.post("/auth/otp", json={"phone": phone, "otp": otp})
    assert response.status_code == 200
    return response.json()["access_token"]


class TestOrderCaptureParser:
    """Core rule-based parser tests with literal expected values."""

    def test_sample_three_lines_capture(self, session):
        """'bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti'
        for a retailer with no alias:
        - line 1 SKU-BS-075, 5 cases, medium confidence, alternative SKU-BS-150
        - line 2 SKU-DT-1KG, 2 cases
        - line 3 SKU-TE-250, 1 case, flag out_of_stock
        """
        parser = RuleBasedParser()
        text = "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti"
        # Retailer 3 has no aliases
        res = parser.parse(text, retailer_id=3, session=session)
        assert len(res.lines) == 3

        # Line 1: biscuit chhota
        l1 = res.lines[0]
        assert l1.sku_code == "SKU-BS-075"
        assert l1.qty == 5
        assert l1.unit == "case"
        assert l1.confidence == "medium"
        assert "SKU-BS-150" in l1.alternatives

        # Line 2: washing powder 1 kilo
        l2 = res.lines[1]
        assert l2.sku_code == "SKU-DT-1KG"
        assert l2.qty == 2
        assert l2.unit == "case"

        # Line 3: chai patti 250 wala
        l3 = res.lines[2]
        assert l3.sku_code == "SKU-TE-250"
        assert l3.qty == 1
        assert l3.unit == "case"
        assert "out_of_stock" in l3.flags

    def test_unit_unknown_needs_unit_flag(self, session):
        """'3 biscuit' -> unit unknown, flag needs_unit."""
        parser = RuleBasedParser()
        res = parser.parse("3 biscuit", retailer_id=1, session=session)
        assert len(res.lines) == 1
        l = res.lines[0]
        assert l.qty == 3
        assert l.unit == "unknown"
        assert "needs_unit" in l.flags
        assert l.sku_code == "SKU-BS-075"

    def test_no_match_low_confidence(self, session):
        """'5 peti kuch aur' -> no_match, low, no sku."""
        parser = RuleBasedParser()
        res = parser.parse("5 peti kuch aur", retailer_id=1, session=session)
        assert len(res.lines) == 1
        l = res.lines[0]
        assert l.qty == 5
        assert l.unit == "case"
        assert l.sku_code is None
        assert l.confidence == "low"
        assert "no_match" in l.flags

    def test_devanagari_digits_and_hindi_words(self, session):
        """Devanagari '५ पेटी बिस्कुट' -> quantity 5, unit case."""
        parser = RuleBasedParser()
        res = parser.parse("५ पेटी बिस्कुट", retailer_id=1, session=session)
        assert len(res.lines) == 1
        l = res.lines[0]
        assert l.qty == 5
        assert l.unit == "case"
        assert l.sku_code == "SKU-BS-075"

def make_llm_mock(content_or_status, is_exception=False):
    """Creates a mock post function for httpx.Client that only intercepts /chat/completions."""
    original_post = httpx.Client.post

    def mock_post(self, url, *args, **kwargs):
        url_str = str(url)
        if "/chat/completions" in url_str:
            if is_exception:
                raise content_or_status
            if isinstance(content_or_status, int):
                return httpx.Response(
                    status_code=content_or_status,
                    request=httpx.Request("POST", url_str),
                )
            return httpx.Response(
                status_code=200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": content_or_status,
                            }
                        }
                    ]
                },
                request=httpx.Request("POST", url_str),
            )
        return original_post(self, url, *args, **kwargs)

    return mock_post


class TestLLMOrderParser:
    """Tests for LLMParser, formatting, think tags, fences, fallbacks, and validation."""

    def test_valid_response_same_lines_as_rule_parser(self, session, monkeypatch):
        """Valid response -> same lines as rule parser for sample message:
        'bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti'
        (SKU-BS-075 x5 medium, SKU-DT-1KG x2, SKU-TE-250 x1 out_of_stock; preview payable 7948.00)
        """
        llm_json = json.dumps({
            "lines": [
                {
                    "original_words": "bhaiya 5 peti biscuit chhota",
                    "qty": 5,
                    "unit": "case",
                    "item_text": "biscuit chhota",
                },
                {
                    "original_words": "2 peti washing powder 1 kilo",
                    "qty": 2,
                    "unit": "case",
                    "item_text": "washing powder 1 kilo",
                },
                {
                    "original_words": "chai patti 250 wala 1 peti",
                    "qty": 1,
                    "unit": "case",
                    "item_text": "chai patti 250 wala",
                },
            ]
        })
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(llm_json))

        parser = LLMParser()
        text = "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti"
        res = parser.parse(text, retailer_id=3, session=session)
        assert len(res.lines) == 3

        # Line 1: biscuit chhota
        l1 = res.lines[0]
        assert l1.sku_code == "SKU-BS-075"
        assert l1.qty == 5
        assert l1.unit == "case"
        assert l1.confidence == "medium"
        assert "SKU-BS-150" in l1.alternatives

        # Line 2: washing powder 1 kilo
        l2 = res.lines[1]
        assert l2.sku_code == "SKU-DT-1KG"
        assert l2.qty == 2
        assert l2.unit == "case"

        # Line 3: chai patti 250 wala (out of stock)
        l3 = res.lines[2]
        assert l3.sku_code == "SKU-TE-250"
        assert l3.qty == 1
        assert l3.unit == "case"
        assert "out_of_stock" in l3.flags

    def test_llm_post_capture_preview_payable_7948(self, client: TestClient, monkeypatch):
        """Preview quote with LLM parser yields payable 7948.00 before GST (tea excluded)."""
        llm_json = json.dumps({
            "lines": [
                {
                    "original_words": "bhaiya 5 peti biscuit chhota",
                    "qty": 5,
                    "unit": "case",
                    "item_text": "biscuit chhota",
                },
                {
                    "original_words": "2 peti washing powder 1 kilo",
                    "qty": 2,
                    "unit": "case",
                    "item_text": "washing powder 1 kilo",
                },
                {
                    "original_words": "chai patti 250 wala 1 peti",
                    "qty": 1,
                    "unit": "case",
                    "item_text": "chai patti 250 wala",
                },
            ]
        })
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(llm_json))
        monkeypatch.setenv("CAPTURE_PARSER", "llm")

        token = login_as(client, phone="9826011111")
        response = client.post(
            "/capture",
            json={
                "retailer_id": 1,
                "text": "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["lines"]) == 3
        assert data["preview_quote"] is not None
        assert float(data["preview_quote"]["subtotal"]) == pytest.approx(7948.00)

    def test_response_with_think_block(self, session, monkeypatch):
        """Strip any <think>...</think> block before parsing."""
        raw = "<think>Analyzing user message and matching products.</think>" + json.dumps({
            "lines": [
                {
                    "original_words": "5 peti biscuit chhota",
                    "qty": 5,
                    "unit": "case",
                    "item_text": "biscuit chhota",
                }
            ]
        })
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(raw))
        parser = LLMParser()
        res = parser.parse("5 peti biscuit chhota", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].sku_code == "SKU-BS-075"
        assert res.lines[0].qty == 5
        assert res.lines[0].unit == "case"

    def test_json_inside_code_fences(self, session, monkeypatch):
        """Extract JSON even when wrapped in markdown code fences."""
        raw = "```json\n" + json.dumps({
            "lines": [
                {
                    "original_words": "5 peti biscuit chhota",
                    "qty": 5,
                    "unit": "case",
                    "item_text": "biscuit chhota",
                }
            ]
        }) + "\n```"
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(raw))
        parser = LLMParser()
        res = parser.parse("5 peti biscuit chhota", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].sku_code == "SKU-BS-075"
        assert res.lines[0].qty == 5

    def test_invalid_json_fallback_used(self, session, monkeypatch, caplog):
        """Invalid JSON -> fallback to RuleBasedParser immediately."""
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock("THIS IS NOT JSON {{{"))
        parser = LLMParser()
        res = parser.parse("5 peti biscuit chhota", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].sku_code == "SKU-BS-075"
        assert res.lines[0].qty == 5
        assert res.lines[0].unit == "case"

    def test_timeout_fallback_used(self, session, monkeypatch):
        """Timeout (10s) -> fallback to RuleBasedParser immediately."""
        timeout_err = httpx.TimeoutException("Read timed out after 10.0s")
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(timeout_err, is_exception=True))
        parser = LLMParser()
        res = parser.parse("5 peti biscuit chhota", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].sku_code == "SKU-BS-075"
        assert res.lines[0].qty == 5

    def test_http_429_fallback_used(self, session, monkeypatch):
        """HTTP 429 -> fallback to RuleBasedParser immediately."""
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(429))
        parser = LLMParser()
        res = parser.parse("2 peti washing powder 1 kilo", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].sku_code == "SKU-DT-1KG"
        assert res.lines[0].qty == 2

    def test_response_containing_invented_sku_code_ignored(self, session, monkeypatch):
        """The LLM must never return or invent a SKU code; ignore any sku field it sends."""
        raw = json.dumps({
            "lines": [
                {
                    "original_words": "5 peti biscuit chhota",
                    "qty": 5,
                    "unit": "case",
                    "item_text": "biscuit chhota",
                    "sku": "INVENTED-SKU-999",
                    "sku_code": "HALLUCINATED-CODE",
                }
            ]
        })
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(raw))
        parser = LLMParser()
        res = parser.parse("5 peti biscuit chhota", retailer_id=1, session=session)
        assert len(res.lines) == 1
        # SKU code comes from internal matcher, invented code is ignored
        assert res.lines[0].sku_code == "SKU-BS-075"

    def test_unit_not_in_original_words_becomes_unknown(self, session, monkeypatch):
        """'3 biscuit' with an LLM response that says unit=case -> unit becomes unknown."""
        raw = json.dumps({
            "lines": [
                {
                    "original_words": "3 biscuit",
                    "qty": 3,
                    "unit": "case",
                    "item_text": "biscuit",
                }
            ]
        })
        monkeypatch.setattr(httpx.Client, "post", make_llm_mock(raw))
        parser = LLMParser()
        res = parser.parse("3 biscuit", retailer_id=1, session=session)
        assert len(res.lines) == 1
        assert res.lines[0].qty == 3
        assert res.lines[0].unit == "unknown"
        assert "needs_unit" in res.lines[0].flags
        assert res.lines[0].sku_code == "SKU-BS-075"

    def test_get_parser_selection(self, monkeypatch):
        """Test CAPTURE_PARSER selection between rule, llm, and auto."""
        monkeypatch.setenv("CAPTURE_PARSER", "rule")
        assert isinstance(get_parser(), RuleBasedParser)
        monkeypatch.setenv("CAPTURE_PARSER", "llm")
        assert isinstance(get_parser(), LLMParser)
        monkeypatch.setenv("CAPTURE_PARSER", "auto")
        assert isinstance(get_parser(), LLMParser)


class TestCaptureEndpointAndLifecycle:
    """Tests for POST /capture, security, preview quotes, and alias learning."""

    def test_post_capture_preview_payable_7948_tea_excluded(self, client: TestClient):
        """POST /capture returns parsed lines and preview payable 7948.00 (tea excluded).
        Creates NO Order rows.
        """
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        # Check initial order count
        order_count_before = len(client.get("/orders/mine", headers=headers).json())

        payload = {
            "retailer_id": 1,
            "text": "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti",
        }
        response = client.post("/capture", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()

        # 3 lines parsed
        assert len(data["lines"]) == 3
        assert data["lines"][0]["sku_code"] == "SKU-BS-075"
        assert data["lines"][0]["qty"] == 5
        assert data["lines"][1]["sku_code"] == "SKU-DT-1KG"
        assert data["lines"][1]["qty"] == 2
        assert data["lines"][2]["sku_code"] == "SKU-TE-250"
        assert "out_of_stock" in data["lines"][2]["flags"]

        # Preview quote: tea excluded (stock 0), biscuit 5 (3888) + detergent 2 (4060) = 7948.00 before GST
        preview = data["preview_quote"]
        assert preview is not None
        assert float(preview["subtotal"]) == pytest.approx(7948.00)

        # Creates NO Order rows
        order_count_after = len(client.get("/orders/mine", headers=headers).json())
        assert order_count_after == order_count_before

    def test_retailer_calling_capture_for_another_retailer_returns_403(self, client: TestClient):
        """A retailer calling POST /capture with another retailer's id -> 403."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        # Retailer 1 tries to capture for Retailer 2
        response = client.post(
            "/capture",
            json={"retailer_id": 2, "text": "5 peti biscuit"},
            headers=headers,
        )
        assert response.status_code == 403

    def test_alias_learning_when_desk_patches_line_sku(self, client: TestClient):
        """Alias: desk changes line 1 to SKU-BS-150, then the same words for the same retailer
        match SKU-BS-150 with high confidence; a different retailer is unaffected.
        """
        # 1. Retailer 1 captures order
        ret1_token = login_as(client, phone="9826011111")  # Retailer 1
        headers_ret1 = {"Authorization": f"Bearer {ret1_token}"}

        # Place order carrying original_words="bhaiya 5 peti biscuit chhota"
        words = "bhaiya 5 peti biscuit chhota"
        order_res = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [
                    {
                        "sku_code": "SKU-BS-075",
                        "qty_cases": 5,
                        "original_words": words,
                        "unit": "case",
                    }
                ],
                "source": "retailer_capture",
                "client_request_id": "alias-test-order-1",
            },
            headers=headers_ret1,
        )
        assert order_res.status_code == 200
        order_id = order_res.json()["id"]

        # 2. Desk modifies line 1 SKU to SKU-BS-150
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        patch_res = client.patch(
            f"/desk/orders/{order_id}",
            json={
                "version": 1,
                "lines": [
                    {
                        "sku_code": "SKU-BS-150",
                        "qty_cases": 5,
                        "original_words": words,
                    }
                ],
            },
            headers=headers_desk,
        )
        assert patch_res.status_code == 200

        # 3. Next capture of same words for Retailer 1 must match SKU-BS-150 with high confidence
        cap_ret1 = client.post(
            "/capture",
            json={"retailer_id": 1, "text": words},
            headers=headers_ret1,
        )
        assert cap_ret1.status_code == 200
        parsed_ret1 = cap_ret1.json()["lines"][0]
        assert parsed_ret1["sku_code"] == "SKU-BS-150"
        assert parsed_ret1["confidence"] == "high"

        # 4. A different retailer (Retailer 2) capturing same words is UNAFFECTED
        ret2_token = login_as(client, phone="9826022222")  # Retailer 2
        headers_ret2 = {"Authorization": f"Bearer {ret2_token}"}

        cap_ret2 = client.post(
            "/capture",
            json={"retailer_id": 2, "text": words},
            headers=headers_ret2,
        )
        assert cap_ret2.status_code == 200
        parsed_ret2 = cap_ret2.json()["lines"][0]
        # Retailer 2 has no alias -> matches default dictionary SKU-BS-075 with medium confidence
        assert parsed_ret2["sku_code"] == "SKU-BS-075"
        assert parsed_ret2["confidence"] == "medium"

    def test_retailer_security_restrictions_on_order(self, client: TestClient):
        """A retailer sending source desk_capture, or ordering for another retailer, returns 403."""
        token = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token}"}

        # Retailer 1 ordering for Retailer 2 -> 403
        res_other = client.post(
            "/orders",
            json={
                "retailer_id": 2,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 1}],
                "client_request_id": "cheat-retailer-id",
            },
            headers=headers,
        )
        assert res_other.status_code == 403

        # Retailer 1 trying to forge desk_capture source -> 403
        res_desk = client.post(
            "/orders",
            json={
                "retailer_id": 1,
                "lines": [{"sku_code": "SKU-BS-075", "qty_cases": 1}],
                "source": "desk_capture",
                "client_request_id": "cheat-source-desk",
            },
            headers=headers,
        )
        assert res_desk.status_code == 403

    def test_approval_rechecks_stock_and_refuses_if_insufficient(self, client: TestClient, session):
        """Approval re-checks stock including free cases and refuses if it would go negative."""
        desk_token = login_as(client, phone="9826000001")
        headers_desk = {"Authorization": f"Bearer {desk_token}"}

        # Create a pending order for 400 cases of biscuit (catalog stock is only 340)
        # Note: If someone orders 340, with free it needs 374 which exceeds 340!
        order = Order(
            retailer_id=1,
            status=OrderStatus.PENDING,
            source=OrderSource.RETAILER_APP,
            placed_by_user_id=1,
            total=Decimal("10000.00"),
            client_request_id="insufficient-stock-test-order",
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        # Line requires 350 cases (exceeds stock 340)
        line = OrderLine(
            order_id=order.id,
            sku_code="SKU-BS-075",
            qty_cases=350,
            charged_cases=350,
            free_cases=0,
            price_per_case=Decimal("777.60"),
            line_total=Decimal("10000.00"),
        )
        session.add(line)
        session.commit()

        # Desk tries to approve order -> Must be refused with 400 because stock is 340 < 350
        patch_res = client.patch(
            f"/desk/orders/{order.id}",
            json={"version": 1, "status": "approved"},
            headers=headers_desk,
        )
        assert patch_res.status_code == 400
        detail = patch_res.json()["detail"]
        assert detail["error"] == "insufficient_stock"
        assert detail["sku_code"] == "SKU-BS-075"
        assert detail["available"] == 340

