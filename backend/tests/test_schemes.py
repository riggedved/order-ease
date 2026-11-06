"""Unit tests for the schemes evaluation engine.

Required tests from specification:
1. biscuit 9 -> 0 free
2. 10 -> 1 free, 10 charged
3. 25 -> 2 free
4. detergent 4 -> no discount
5. detergent 5 -> 10150 becomes 9845.50
6. tea 1 case -> blocked (stock 0)
7. biscuit 340 with free -> capped by stock
"""

import pytest
from backend.app.schemes import (
    evaluate_scheme,
    SchemeResult,
    quote_cart,
    SKU_CATALOG,
)


class TestRequiredSchemes:
    """Tests directly required by user specification."""

    def test_biscuit_9_cases_gives_0_free(self):
        """biscuit 9 -> 0 free.

        Free goods: floor(9 / 10) = 0 free goods.
        Charged: 9 cases.
        Nudge: Add 1 more cases to get 1 free.
        """
        result = evaluate_scheme("SKU-BS-075", qty=9)
        assert result.free_qty == 0
        assert result.free == 0
        assert result.charged_qty == 9
        assert result.stock_consumed == 9
        assert not result.is_blocked
        assert not result.is_capped
        assert "Add 1 more cases to get 1 free" in result.nudges

    def test_biscuit_10_cases_gives_1_free_10_charged(self):
        """biscuit 10 -> 1 free, 10 charged.

        Free goods: floor(10 / 10) = 1 free good.
        Charged: 10 cases (free good not charged).
        Stock reduction: 10 charged + 1 free = 11 cases reduced.
        Nudge: Add 10 more cases to get 1 free.
        """
        result = evaluate_scheme("SKU-BS-075", qty=10)
        assert result.free_qty == 1
        assert result.free == 1
        assert result.charged_qty == 10
        assert result.charged == 10
        assert result.total_qty == 11
        assert result.stock_consumed == 11
        assert result.final_line_value == pytest.approx(10 * result.case_price)
        assert "Add 10 more cases to get 1 free" in result.nudges

    def test_biscuit_25_cases_gives_2_free(self):
        """biscuit 25 -> 2 free.

        Free goods: floor(25 / 10) = 2 free goods.
        Charged: 25 cases.
        Stock reduction: 25 + 2 = 27 cases.
        Nudge: Add 5 more cases to get 1 free.
        """
        result = evaluate_scheme("SKU-BS-075", qty=25)
        assert result.free_qty == 2
        assert result.free == 2
        assert result.charged_qty == 25
        assert result.stock_consumed == 27
        assert "Add 5 more cases to get 1 free" in result.nudges

    def test_detergent_4_cases_no_discount(self):
        """detergent 4 -> no discount.

        Slab threshold is 5 cases. For 4 cases, discount is 0%.
        Line value = 4 * case_price (4 * 2030 = 8120).
        Nudge: Add 1 more cases to get 3% off.
        """
        result = evaluate_scheme("SKU-DT-1KG", qty=4)
        assert result.discount_pct == 0.0
        assert result.discount_amount == 0.0
        assert result.free_qty == 0
        assert result.final_line_value == pytest.approx(result.base_line_value)
        assert "Add 1 more cases to get 3% off" in result.nudges

    def test_detergent_5_cases_10150_becomes_9845_50(self):
        """detergent 5 -> 10150 becomes 9845.50.

        Slab: 3% off line value when qty >= 5 cases.
        Base line value: 10150.00 (5 * 2030).
        3% discount: 10150 * 0.03 = 304.50.
        Final line value: 10150 - 304.50 = 9845.50.
        """
        result = evaluate_scheme("SKU-DT-1KG", qty=5)
        assert result.base_line_value == pytest.approx(10150.00)
        assert result.discount_pct == pytest.approx(0.03)
        assert result.discount_amount == pytest.approx(304.50)
        assert result.final_line_value == pytest.approx(9845.50)
        assert result.final_value == pytest.approx(9845.50)
        # Slab discount already achieved, so no nudge for 3% off
        assert not any("3% off" in n for n in result.nudges)

    def test_tea_1_case_blocked_stock_0(self):
        """tea 1 case -> blocked (stock 0).

        Stock is 0 cases, so ordering 1 case must be blocked and return message.
        """
        result = evaluate_scheme("SKU-TEA-001", qty=1, stock=0)
        assert result.is_blocked is True
        assert result.blocked is True
        assert result.charged_qty == 0
        assert result.free_qty == 0
        assert result.stock_consumed == 0
        assert result.message is not None
        assert any(word in result.message.lower() for word in ["stock", "blocked", "out of stock"])

    def test_biscuit_340_with_free_capped_by_stock(self):
        """biscuit 340 with free -> capped by stock.

        Requested: 340 cases.
        Unconstrained free goods: floor(340 / 10) = 34 free cases.
        Total cases required: 340 + 34 = 374 cases.
        Available stock: 340 cases.
        Since 374 > 340, stock is exceeded.
        Total quantity (charged + free) must be capped to <= stock (340).
        With max paid where paid + floor(paid / 10) <= 340:
          paid = 309, free = 30, total = 339 <= 340 cases.
        Stock consumed <= 340.
        Message must indicate capping.
        """
        result = evaluate_scheme("SKU-BS-075", qty=340, stock=340)
        assert result.is_capped is True
        assert result.capped is True
        assert result.total_qty <= 340
        assert result.stock_consumed <= 340
        assert result.free_qty > 0
        assert result.charged_qty + result.free_qty <= 340
        assert result.message is not None
        assert "capped" in result.message.lower()

    def test_biscuit_340_default_catalog_stock(self):
        """biscuit 340 without passing stock uses catalog stock (340) and caps."""
        result = evaluate_scheme("SKU-BS-075", qty=340)
        assert result.is_capped is True
        assert result.total_qty <= 340
        assert result.stock_consumed <= 340
        assert result.message is not None
        assert "capped" in result.message.lower()


class TestStackingAndEdgeCases:
    """Additional edge cases ensuring complete scheme adherence."""

    def test_free_goods_exact_boundary_cap(self):
        """If stock is 10 and requested is 10:
        10 + floor(10/10) = 11 > 10.
        Must cap to 9 paid + 0 free = 9 cases <= 10.
        """
        result = evaluate_scheme("SKU-BS-075", qty=10, stock=10)
        assert result.is_capped is True
        assert result.charged_qty == 9
        assert result.free_qty == 0
        assert result.total_qty == 9
        assert result.stock_consumed <= 10

    def test_free_goods_fits_exact_boundary(self):
        """If stock is 11 and requested is 10:
        10 + 1 free = 11 <= 11.
        Fits exactly, not capped!
        """
        result = evaluate_scheme("SKU-BS-075", qty=10, stock=11)
        assert result.is_capped is False
        assert result.charged_qty == 10
        assert result.free_qty == 1
        assert result.total_qty == 11
        assert result.stock_consumed == 11

    def test_zero_quantity(self):
        """Ordering 0 cases produces 0 charges and 0 free goods."""
        result = evaluate_scheme("SKU-BS-075", qty=0)
        assert result.charged_qty == 0
        assert result.free_qty == 0
        assert result.final_line_value == 0.0

    def test_stacking_order_free_first_then_discount_on_paid_cases(self):
        """Stacking order: free goods first, then discount on paid cases.

        If an item has both free goods and a slab discount:
        Free goods reduce stock and cost 0.
        Slab discount applies strictly to the paid cases value.
        """
        # Testing a hypothetical SKU with both: 1 free per 10, plus 3% slab at >= 5 paid cases
        result = evaluate_scheme(
            "SKU-COMBO",
            qty=10,
            case_price=1000.0,
            stock=100,
            has_free_goods=True,
            slab_threshold=5,
            slab_discount_pct=0.03,
        )
        assert result.free_qty == 1
        assert result.charged_qty == 10
        # Paid line value = 10 * 1000 = 10000 (free good is ₹0)
        assert result.base_line_value == pytest.approx(10000.0)
        # 3% discount applies to 10000 = 300.0
        assert result.discount_amount == pytest.approx(300.0)
        assert result.final_line_value == pytest.approx(9700.0)
        assert result.stock_consumed == 11

    def test_alias_resolution(self):
        """Tests that friendly aliases like 'biscuit', 'detergent', 'tea' resolve correctly."""
        biscuit = evaluate_scheme("biscuit", qty=10)
        assert biscuit.sku == "SKU-BS-075"
        assert biscuit.free_qty == 1

        detergent = evaluate_scheme("detergent", qty=5)
        assert detergent.sku == "SKU-DT-1KG"
        assert detergent.discount_amount == pytest.approx(304.50)

        tea = evaluate_scheme("tea", qty=1)
        assert tea.sku == "SKU-TEA-001"
        assert tea.is_blocked is True

    def test_cart_quote_multiple_items(self):
        """Tests calculating a full cart quote containing all three items."""
        cart_items = [
            {"sku": "SKU-BS-075", "qty": 10},
            {"sku": "SKU-DT-1KG", "qty": 5},
            {"sku": "SKU-TEA-001", "qty": 1},
        ]
        quote = quote_cart(cart_items)
        assert len(quote.lines) == 3
        # Biscuit line
        assert quote.lines[0].free_qty == 1
        # Detergent line
        assert quote.lines[1].final_line_value == pytest.approx(9845.50)
        # Tea line
        assert quote.lines[2].is_blocked is True
        # Cart total includes only unblocked items
        expected_total = (10 * 777.60) + 9845.50
        assert quote.total_amount == pytest.approx(expected_total)
        assert len(quote.blocked_items) == 1
