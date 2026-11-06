"""Unit tests for the schemes evaluation engine.

Specification & Requirements:
1. Use Decimal everywhere, no floats. Round half-up to the paisa once per line.
2. Boundary tests: biscuit 19 -> 1 free, 20 -> 2 free; quantity 0 and negative
   are rejected; detergent 85 fine, 86 capped at 85.
3. Nudge tests: biscuit 5 -> "add 5 more for 1 free", biscuit 9 -> "add 1 more",
   detergent 2 -> "add 3 more for 3% off".
4. Free goods never trigger the 3% slab, and the slab never applies to biscuit.
5. Stock-cap case (biscuit with stock 340):
   309 paid + 30 free = 339 used, message "Reduced to 309 cases (stock limit)".
6. schemes.py must not import FastAPI, SQLModel or the DB.
"""

from decimal import Decimal
import inspect
import pytest

from backend.app import schemes
from backend.app.schemes import (
    evaluate_scheme,
    SchemeResult,
    quote_cart,
    SKU_CATALOG,
    PAISA,
)


class TestRequiredSchemes:
    """Core scheme tests required by specification."""

    def test_biscuit_9_cases_gives_0_free(self):
        """biscuit 9 -> 0 free."""
        result = evaluate_scheme("SKU-BS-075", qty=9)
        assert isinstance(result.final_line_value, Decimal)
        assert isinstance(result.case_price, Decimal)
        assert result.free_qty == 0
        assert result.free == 0
        assert result.charged_qty == 9
        assert result.stock_consumed == 9
        assert not result.is_blocked
        assert not result.is_capped
        assert result.final_line_value == Decimal("6998.40")  # 9 * 777.60

    def test_biscuit_10_cases_gives_1_free_10_charged(self):
        """biscuit 10 -> 1 free, 10 charged. Free good is ₹0 and reduces stock."""
        result = evaluate_scheme("SKU-BS-075", qty=10)
        assert result.free_qty == 1
        assert result.free == 1
        assert result.charged_qty == 10
        assert result.charged == 10
        assert result.total_qty == 11
        assert result.stock_consumed == 11
        assert result.final_line_value == Decimal("7776.00")  # 10 * 777.60

    def test_biscuit_25_cases_gives_2_free(self):
        """biscuit 25 -> 2 free."""
        result = evaluate_scheme("SKU-BS-075", qty=25)
        assert result.free_qty == 2
        assert result.free == 2
        assert result.charged_qty == 25
        assert result.stock_consumed == 27
        assert result.final_line_value == Decimal("19440.00")  # 25 * 777.60

    def test_detergent_4_cases_no_discount(self):
        """detergent 4 -> no discount."""
        result = evaluate_scheme("SKU-DT-1KG", qty=4)
        assert result.discount_pct == Decimal("0.00")
        assert result.discount_amount == Decimal("0.00")
        assert result.free_qty == 0
        assert result.final_line_value == Decimal("8120.00")  # 4 * 2030.00

    def test_detergent_5_cases_10150_becomes_9845_50(self):
        """detergent 5 -> 10150 becomes 9845.50 (3% off line value)."""
        result = evaluate_scheme("SKU-DT-1KG", qty=5)
        assert result.base_line_value == Decimal("10150.00")
        assert result.discount_pct == Decimal("0.03")
        assert result.discount_amount == Decimal("304.50")
        assert result.final_line_value == Decimal("9845.50")
        assert result.final_value == Decimal("9845.50")

    def test_tea_1_case_blocked_stock_0(self):
        """tea 1 case -> blocked (stock 0)."""
        result = evaluate_scheme("SKU-TEA-001", qty=1, stock=0)
        assert result.is_blocked is True
        assert result.blocked is True
        assert result.charged_qty == 0
        assert result.free_qty == 0
        assert result.stock_consumed == 0
        assert result.message is not None
        assert "out of stock" in result.message.lower()

    def test_biscuit_340_with_free_capped_by_stock(self):
        """biscuit 340 with stock 340 -> capped: 309 paid + 30 free = 339 used.

        Message: 'Reduced to 309 cases (stock limit)'.
        """
        result = evaluate_scheme("SKU-BS-075", qty=340, stock=340)
        assert result.is_capped is True
        assert result.capped is True
        assert result.charged_qty == 309
        assert result.free_qty == 30
        assert result.stock_consumed == 339
        assert result.total_qty == 339
        assert result.stock_consumed <= 340
        assert result.message == "Reduced to 309 cases (stock limit)"


class TestBoundaryConditions:
    """Boundary tests required: biscuit 19, 20; qty 0 and negative; detergent 85, 86."""

    def test_biscuit_19_gives_1_free(self):
        """biscuit 19 -> 1 free (floor(19/10) = 1)."""
        result = evaluate_scheme("SKU-BS-075", qty=19)
        assert result.charged_qty == 19
        assert result.free_qty == 1
        assert result.stock_consumed == 20

    def test_biscuit_20_gives_2_free(self):
        """biscuit 20 -> 2 free (floor(20/10) = 2)."""
        result = evaluate_scheme("SKU-BS-075", qty=20)
        assert result.charged_qty == 20
        assert result.free_qty == 2
        assert result.stock_consumed == 22

    def test_quantity_zero_is_rejected(self):
        """Quantity 0 must be rejected with ValueError."""
        with pytest.raises(ValueError, match="greater than 0"):
            evaluate_scheme("SKU-BS-075", qty=0)

    def test_quantity_negative_is_rejected(self):
        """Quantity negative must be rejected with ValueError."""
        with pytest.raises(ValueError, match="greater than 0"):
            evaluate_scheme("SKU-BS-075", qty=-5)

    def test_detergent_85_fine_and_86_capped_at_85(self):
        """detergent 85 fine, 86 capped at 85."""
        # Stock for detergent in catalog is 85
        fine_res = evaluate_scheme("SKU-DT-1KG", qty=85)
        assert fine_res.is_capped is False
        assert fine_res.charged_qty == 85
        assert fine_res.free_qty == 0
        assert fine_res.stock_consumed == 85

        capped_res = evaluate_scheme("SKU-DT-1KG", qty=86)
        assert capped_res.is_capped is True
        assert capped_res.charged_qty == 85
        assert capped_res.free_qty == 0
        assert capped_res.stock_consumed == 85
        assert capped_res.message == "Reduced to 85 cases (stock limit)"


class TestNudges:
    """Nudge tests: biscuit 5, biscuit 9, detergent 2."""

    def test_biscuit_5_nudge_add_5_more_for_1_free(self):
        """biscuit 5 -> 'add 5 more for 1 free'."""
        result = evaluate_scheme("SKU-BS-075", qty=5)
        assert "add 5 more for 1 free" in result.nudges
        assert "add 5 more for 1 free" in (result.nudge or "").lower()

    def test_biscuit_9_nudge_add_1_more(self):
        """biscuit 9 -> 'add 1 more'."""
        result = evaluate_scheme("SKU-BS-075", qty=9)
        assert any("add 1 more" in n for n in result.nudges)
        assert "add 1 more" in (result.nudge or "").lower()

    def test_detergent_2_nudge_add_3_more_for_3_pct_off(self):
        """detergent 2 -> 'add 3 more for 3% off'."""
        result = evaluate_scheme("SKU-DT-1KG", qty=2)
        assert "add 3 more for 3% off" in result.nudges
        assert "add 3 more for 3% off" in (result.nudge or "").lower()


class TestSlabRulesAndStacking:
    """Rules: Free goods never trigger 3% slab, slab never applies to biscuit."""

    def test_slab_never_applies_to_biscuit(self):
        """Even with qty >= 5, 10, or 340, slab discount NEVER applies to biscuit."""
        for qty in [5, 10, 25, 100]:
            res = evaluate_scheme("SKU-BS-075", qty=qty)
            assert res.discount_pct == Decimal("0.00")
            assert res.discount_amount == Decimal("0.00")

    def test_free_goods_never_trigger_slab(self):
        """Free goods never trigger the slab; only paid/charged cases count.

        Suppose an SKU has free goods and a 5-case slab:
        If paid=4, free=1 (total=5 cases):
        Since charged cases is only 4 (< 5), slab discount is NOT triggered!
        """
        result = evaluate_scheme(
            "SKU-TEST-COMBO",
            qty=4,
            case_price=Decimal("1000.00"),
            stock=100,
            has_free_goods=True,
            slab_threshold=5,
            slab_discount_pct=Decimal("0.03"),
        )
        # 4 cases does not get free goods (needs 10), and does not trigger slab (< 5)
        assert result.charged_qty == 4
        assert result.discount_amount == Decimal("0.00")

        # Now test 10 cases: gets 1 free (total 11). Charged is 10 >= 5, so slab triggers on 10 * 1000 = 10000
        result10 = evaluate_scheme(
            "SKU-TEST-COMBO",
            qty=10,
            case_price=Decimal("1000.00"),
            stock=100,
            has_free_goods=True,
            slab_threshold=5,
            slab_discount_pct=Decimal("0.03"),
        )
        assert result10.charged_qty == 10
        assert result10.free_qty == 1
        assert result10.base_line_value == Decimal("10000.00")
        assert result10.discount_amount == Decimal("300.00")
        assert result10.final_line_value == Decimal("9700.00")


class TestPaisaRoundingAndDecimals:
    """Round half-up to the paisa once per line using Decimal."""

    def test_round_half_up_to_paisa(self):
        """Tests that rounding uses Decimal ROUND_HALF_UP to the paisa."""
        # Line price with fraction paisa: 3 cases at 10.335
        # 3 * 10.335 = 31.005 -> rounds half-up to 31.01
        res = evaluate_scheme("SKU-CUSTOM", qty=3, case_price=Decimal("10.335"), stock=50)
        assert res.base_line_value == Decimal("31.01")
        assert res.final_line_value == Decimal("31.01")

    def test_cart_quote_decimals(self):
        """quote_cart aggregates exact Decimal amounts."""
        quote = quote_cart([
            {"sku": "SKU-BS-075", "qty": 10},
            {"sku": "SKU-DT-1KG", "qty": 5},
            {"sku": "SKU-TEA-001", "qty": 1},
        ])
        assert isinstance(quote.subtotal_amount, Decimal)
        assert isinstance(quote.total_discount, Decimal)
        assert isinstance(quote.total_amount, Decimal)
        assert quote.total_discount == Decimal("304.50")
        # 10 * 777.60 = 7776.00; detergent 5 = 9845.50
        assert quote.total_amount == Decimal("7776.00") + Decimal("9845.50")


class TestArchitectureDecoupling:
    """schemes.py must not import FastAPI, SQLModel or the DB."""

    def test_no_framework_imports(self):
        """Verifies that schemes.py does not import fastapi, sqlmodel, or database libraries."""
        source = inspect.getsource(schemes)
        forbidden = ["fastapi", "sqlmodel", "sqlalchemy", "sqlite3", "database", "models"]
        for line in source.splitlines():
            line_clean = line.strip()
            if line_clean.startswith("import ") or line_clean.startswith("from "):
                for pkg in forbidden:
                    assert pkg not in line_clean.lower(), (
                        f"schemes.py imports forbidden package '{pkg}': {line_clean}"
                    )
