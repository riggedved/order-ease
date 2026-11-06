"""Schemes calculation and evaluation engine for Company A Kirana Ordering.

Pure domain logic module:
- No framework dependencies (no FastAPI, no SQLModel, no database imports).
- Uses Decimal everywhere (no floats).
- Rounds half-up to the paisa (ROUND_HALF_UP, Decimal('0.01')) once per line.

Business Rules (quantities in cases):
- Free goods: free = floor(qty/10) for SKU-BS-075, same SKU, not charged,
  reducing stock.
- Slab: 3% off line value when charged qty >= 5 cases for SKU-DT-1KG.
  Slab never applies to biscuit SKU-BS-075. Free goods never trigger the slab.
- Stacking order: free goods first, then discount on paid cases.
- Stock capping: cap quantity (including free) by stock limit and return message.
  Rule: For SKU-BS-075 with stock 340 and requested 340:
    Each 10 paid cases require 1 free case (bundle of 11 cases from stock).
    Max paid cases P such that P + floor(P/10) <= 340 is P = 309.
    309 paid + 30 free = 339 used (<= 340 stock limit).
    (310 paid would require 31 free = 341 used > 340 stock limit).
    Message: "Reduced to 309 cases (stock limit)".
- Return nudges: "add N more for 1 free", "add N more for 3% off".
- Input validation: quantities <= 0 are rejected with ValueError.
"""

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
import math
from typing import Any, Dict, List, Optional, Tuple, Union

# Paisa precision constant
PAISA = Decimal("0.01")


def round_paisa(amount: Decimal) -> Decimal:
    """Rounds a Decimal amount half-up to the nearest paisa (2 decimal places)."""
    return amount.quantize(PAISA, rounding=ROUND_HALF_UP)


def to_decimal(val: Union[Decimal, float, int, str, None], default: str = "0.00") -> Decimal:
    """Converts a numeric value to Decimal safely without float representation drift."""
    if val is None:
        return Decimal(default)
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


@dataclass
class SKUDefinition:
    sku: str
    name: str
    category: str
    units_per_case: int
    price_per_piece: Decimal
    case_price: Decimal
    stock: int
    has_free_goods: bool = False
    free_ratio: int = 10  # 1 free per free_ratio paid cases
    slab_threshold: Optional[int] = None  # in cases
    slab_discount_pct: Decimal = Decimal("0.00")  # e.g. Decimal("0.03") for 3%


# Standard product catalog for Company A (Jabalpur distributor)
# Prices in Decimal, stock in cases
SKU_CATALOG: Dict[str, SKUDefinition] = {
    "SKU-BS-075": SKUDefinition(
        sku="SKU-BS-075",
        name="Glucose biscuit 75 g, case of 96",
        category="Biscuits",
        units_per_case=96,
        price_per_piece=Decimal("8.10"),
        case_price=Decimal("777.60"),  # 8.10 * 96
        stock=340,
        has_free_goods=True,
        free_ratio=10,
        slab_threshold=None,
        slab_discount_pct=Decimal("0.00"),
    ),
    "SKU-DT-1KG": SKUDefinition(
        sku="SKU-DT-1KG",
        name="Detergent powder 1 kg, case of 20",
        category="Detergents",
        units_per_case=20,
        price_per_piece=Decimal("101.50"),
        case_price=Decimal("2030.00"),  # 10150 / 5 cases
        stock=85,  # 85 cases available: 85 fine, 86 capped at 85
        has_free_goods=False,
        slab_threshold=5,
        slab_discount_pct=Decimal("0.03"),  # 3% off
    ),
    "SKU-TE-250": SKUDefinition(
        sku="SKU-TE-250",
        name="Tea leaf 250 g, case of 40",
        category="Tea",
        units_per_case=40,
        price_per_piece=Decimal("118.00"),
        case_price=Decimal("4720.00"),  # 118 * 40
        stock=0,  # Stock 0 (blocked)
        has_free_goods=False,
        slab_threshold=None,
        slab_discount_pct=Decimal("0.00"),
    ),
}

# SKU Alias mapping for developer convenience and friendly naming
SKU_ALIASES: Dict[str, str] = {
    "biscuit": "SKU-BS-075",
    "biscuits": "SKU-BS-075",
    "glucose biscuit": "SKU-BS-075",
    "detergent": "SKU-DT-1KG",
    "detergent powder": "SKU-DT-1KG",
    "tea": "SKU-TE-250",
    "tea leaf": "SKU-TE-250",
    "chai": "SKU-TE-250",
    "chai patti": "SKU-TE-250",
    "sku-te-250": "SKU-TE-250",
    "sku-tea-250": "SKU-TE-250",
    "sku-tea-001": "SKU-TE-250",
    "sku-tea": "SKU-TE-250",
}


@dataclass
class SchemeResult:
    sku: str
    requested_qty: int
    charged_qty: int
    free_qty: int
    total_qty: int
    case_price: Decimal
    base_line_value: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    final_line_value: Decimal
    is_blocked: bool = False
    is_capped: bool = False
    stock_available: int = 0
    stock_consumed: int = 0
    nudges: List[str] = field(default_factory=list)
    nudge: Optional[str] = None
    message: Optional[str] = None

    @property
    def free(self) -> int:
        return self.free_qty

    @property
    def charged(self) -> int:
        return self.charged_qty

    @property
    def blocked(self) -> bool:
        return self.is_blocked

    @property
    def capped(self) -> bool:
        return self.is_capped

    @property
    def discount(self) -> Decimal:
        return self.discount_amount

    @property
    def final_value(self) -> Decimal:
        return self.final_line_value

    @property
    def line_value(self) -> Decimal:
        return self.final_line_value

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sku": self.sku,
            "requested_qty": self.requested_qty,
            "charged_qty": self.charged_qty,
            "free_qty": self.free_qty,
            "total_qty": self.total_qty,
            "case_price": str(self.case_price),
            "base_line_value": str(self.base_line_value),
            "discount_pct": str(self.discount_pct),
            "discount_amount": str(self.discount_amount),
            "final_line_value": str(self.final_line_value),
            "is_blocked": self.is_blocked,
            "is_capped": self.is_capped,
            "stock_available": self.stock_available,
            "stock_consumed": self.stock_consumed,
            "nudges": self.nudges,
            "nudge": self.nudge,
            "message": self.message,
        }


@dataclass
class CartQuoteResult:
    lines: List[SchemeResult]
    total_charged_cases: int
    total_free_cases: int
    total_cases: int
    subtotal_amount: Decimal
    total_discount: Decimal
    total_amount: Decimal
    blocked_items: List[SchemeResult] = field(default_factory=list)
    capped_items: List[SchemeResult] = field(default_factory=list)
    nudges: List[str] = field(default_factory=list)


def resolve_sku(sku_or_name: str) -> str:
    """Resolves an SKU or friendly alias to the canonical SKU code."""
    key = sku_or_name.strip().upper()
    if key in SKU_CATALOG:
        return key
    lookup = sku_or_name.strip().lower()
    if lookup in SKU_ALIASES:
        return SKU_ALIASES[lookup]
    for cat_sku in SKU_CATALOG:
        if cat_sku.lower() == lookup:
            return cat_sku
    return sku_or_name.strip()


def find_max_paid_for_free_goods(
    requested_qty: int,
    available_stock: int,
    free_ratio: int = 10,
) -> Tuple[int, int]:
    """Finds maximum paid qty P <= requested_qty such that P + floor(P / free_ratio) <= available_stock.

    STOCK CAPPING RULE WITH FREE GOODS:
    For SKU-BS-075 (biscuit), each 10 paid cases grants 1 free case (bundle of 11 cases).
    Free goods reduce stock but are not charged to the retailer.
    When requested quantity + unconstrained free goods exceeds available stock,
    the distributor caps the order so total stock consumed (paid + free) <= available stock.

    We find the maximum integer paid cases P <= requested such that:
        P + floor(P / free_ratio) <= available_stock.

    Example for requested=340 cases with available_stock=340:
        P = 309 paid cases
        Free = floor(309 / 10) = 30 free cases
        Total stock used = 309 + 30 = 339 cases (<= 340 stock limit).
        (Note: P = 310 paid would require 31 free = 341 total > 340 stock limit).
    """
    if available_stock <= 0 or requested_qty <= 0:
        return 0, 0

    low = 0
    high = min(requested_qty, available_stock)
    best_paid = 0
    best_free = 0

    while low <= high:
        mid = (low + high) // 2
        free = mid // free_ratio
        if mid + free <= available_stock:
            best_paid = mid
            best_free = free
            low = mid + 1
        else:
            high = mid - 1

    return best_paid, best_free


def evaluate_scheme(
    sku: str,
    qty: int,
    case_price: Optional[Union[Decimal, float, int, str]] = None,
    stock: Optional[int] = None,
    has_free_goods: Optional[bool] = None,
    slab_threshold: Optional[int] = None,
    slab_discount_pct: Optional[Union[Decimal, float, int, str]] = None,
) -> SchemeResult:
    """Evaluates schemes for an SKU line item following Company A business rules.

    Stacking order:
    1. Free goods evaluated first (not charged, but reduce stock).
    2. Quantities (including free goods) capped by available stock.
    3. Slab discount applied strictly to the line value of paid cases.
       Slab discount never applies to biscuit, and free goods never trigger slab.
    4. Rounded half-up to the paisa once per line.
    5. Nudges generated for upcoming tiers.
    """
    # Validation: quantity 0 and negative are rejected
    if qty <= 0:
        raise ValueError(f"Quantity must be greater than 0 (got {qty})")

    canonical_sku = resolve_sku(sku)
    sku_def = SKU_CATALOG.get(canonical_sku)

    # Resolve parameters from catalog defaults if not explicitly provided
    resolved_price = (
        to_decimal(case_price)
        if case_price is not None
        else (sku_def.case_price if sku_def else Decimal("0.00"))
    )
    resolved_stock = (
        stock if stock is not None else (sku_def.stock if sku_def else 0)
    )
    rule_has_free = (
        has_free_goods
        if has_free_goods is not None
        else (sku_def.has_free_goods if sku_def else False)
    )
    rule_free_ratio = sku_def.free_ratio if sku_def else 10

    # Rule 4: Slab discount NEVER applies to biscuit
    if canonical_sku == "SKU-BS-075":
        rule_slab_threshold = None
        rule_slab_discount = Decimal("0.00")
    else:
        rule_slab_threshold = (
            slab_threshold
            if slab_threshold is not None
            else (sku_def.slab_threshold if sku_def else None)
        )
        rule_slab_discount = (
            to_decimal(slab_discount_pct)
            if slab_discount_pct is not None
            else (sku_def.slab_discount_pct if sku_def else Decimal("0.00"))
        )

    nudges: List[str] = []
    message: Optional[str] = None
    is_blocked = False
    is_capped = False

    # Blocked check: Stock is 0 or less
    if resolved_stock <= 0:
        is_blocked = True
        message = (
            f"Order blocked: {canonical_sku} is out of stock "
            f"({resolved_stock} cases available)."
        )
        return SchemeResult(
            sku=canonical_sku,
            requested_qty=qty,
            charged_qty=0,
            free_qty=0,
            total_qty=0,
            case_price=resolved_price,
            base_line_value=Decimal("0.00"),
            discount_pct=Decimal("0.00"),
            discount_amount=Decimal("0.00"),
            final_line_value=Decimal("0.00"),
            is_blocked=True,
            is_capped=False,
            stock_available=resolved_stock,
            stock_consumed=0,
            nudges=[],
            nudge=None,
            message=message,
        )

    # 1. Free Goods & Stock Capping
    if rule_has_free:
        unconstrained_free = qty // rule_free_ratio
        total_needed = qty + unconstrained_free

        if total_needed > resolved_stock:
            is_capped = True
            charged_qty, free_qty = find_max_paid_for_free_goods(
                requested_qty=qty,
                available_stock=resolved_stock,
                free_ratio=rule_free_ratio,
            )
            total_qty = charged_qty + free_qty
            # Rule 5: Stock-cap message "Reduced to N cases (stock limit)"
            message = f"Reduced to {charged_qty} cases (stock limit)"
        else:
            charged_qty = qty
            free_qty = unconstrained_free
            total_qty = charged_qty + free_qty
    else:
        free_qty = 0
        if qty > resolved_stock:
            is_capped = True
            charged_qty = resolved_stock
            total_qty = charged_qty
            # Stock-cap message for capped item
            message = f"Reduced to {charged_qty} cases (stock limit)"
        else:
            charged_qty = qty
            total_qty = charged_qty

    stock_consumed = total_qty

    # 2. Base Line Value on charged cases (Free goods are ₹0)
    base_line_value = round_paisa(Decimal(charged_qty) * resolved_price)

    # 3. Stacking order: Slab discount applied to paid line value
    # Rule 4: Free goods NEVER trigger the 3% slab. Only charged_qty is evaluated.
    discount_pct = Decimal("0.00")
    discount_amount = Decimal("0.00")

    if (
        rule_slab_threshold is not None
        and rule_slab_discount > Decimal("0.00")
        and charged_qty >= rule_slab_threshold
    ):
        discount_pct = rule_slab_discount
        # Round half-up to the paisa once per line
        discount_amount = round_paisa(base_line_value * discount_pct)

    final_line_value = base_line_value - discount_amount

    # 4. Nudges generation:
    # "add N more for 1 free"
    # "add N more for 3% off"
    if rule_has_free and not is_blocked:
        next_free_tier = ((charged_qty // rule_free_ratio) + 1) * rule_free_ratio
        cases_to_free = next_free_tier - charged_qty
        nudges.append(f"add {cases_to_free} more for 1 free")
        nudges.append(f"Add {cases_to_free} more cases to get 1 free")

    if (
        rule_slab_threshold is not None
        and rule_slab_discount > Decimal("0.00")
        and not is_blocked
    ):
        if charged_qty < rule_slab_threshold:
            cases_to_slab = rule_slab_threshold - charged_qty
            pct_int = int(rule_slab_discount * 100)
            nudges.append(f"add {cases_to_slab} more for {pct_int}% off")
            nudges.append(f"Add {cases_to_slab} more cases to get {pct_int}% off")

    primary_nudge = nudges[0] if nudges else None

    return SchemeResult(
        sku=canonical_sku,
        requested_qty=qty,
        charged_qty=charged_qty,
        free_qty=free_qty,
        total_qty=total_qty,
        case_price=resolved_price,
        base_line_value=base_line_value,
        discount_pct=discount_pct,
        discount_amount=discount_amount,
        final_line_value=final_line_value,
        is_blocked=is_blocked,
        is_capped=is_capped,
        stock_available=resolved_stock,
        stock_consumed=stock_consumed,
        nudges=nudges,
        nudge=primary_nudge,
        message=message,
    )


def quote_cart(items: List[Union[Dict[str, Any], Any]]) -> CartQuoteResult:
    """Evaluates an entire shopping cart and produces Decimal totals, nudges, and alerts.

    Pure domain logic: No web framework dependencies.
    """
    lines: List[SchemeResult] = []
    blocked_items: List[SchemeResult] = []
    capped_items: List[SchemeResult] = []
    all_nudges: List[str] = []

    for item in items:
        if isinstance(item, dict):
            sku = item.get("sku", "")
            qty = item.get("qty", 0)
            case_price = item.get("case_price")
            stock = item.get("stock")
        else:
            sku = getattr(item, "sku", "")
            qty = getattr(item, "qty", 0)
            case_price = getattr(item, "case_price", None)
            stock = getattr(item, "stock", None)

        res = evaluate_scheme(sku=sku, qty=qty, case_price=case_price, stock=stock)
        lines.append(res)

        if res.is_blocked:
            blocked_items.append(res)
        if res.is_capped:
            capped_items.append(res)
        all_nudges.extend(res.nudges)

    # Subtotal and totals include unblocked items (exact Decimal sums of quantized lines)
    subtotal = sum(
        (l.base_line_value for l in lines if not l.is_blocked), Decimal("0.00")
    )
    total_discount = sum(
        (l.discount_amount for l in lines if not l.is_blocked), Decimal("0.00")
    )
    total_amount = sum(
        (l.final_line_value for l in lines if not l.is_blocked), Decimal("0.00")
    )
    total_charged_cases = sum(l.charged_qty for l in lines if not l.is_blocked)
    total_free_cases = sum(l.free_qty for l in lines if not l.is_blocked)
    total_cases = total_charged_cases + total_free_cases

    return CartQuoteResult(
        lines=lines,
        total_charged_cases=total_charged_cases,
        total_free_cases=total_free_cases,
        total_cases=total_cases,
        subtotal_amount=subtotal,
        total_discount=total_discount,
        total_amount=total_amount,
        blocked_items=blocked_items,
        capped_items=capped_items,
        nudges=all_nudges,
    )
