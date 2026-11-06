"""Schemes calculation and evaluation engine for Company A Kirana Ordering.

Business Rules (quantities in cases):
- Free goods: free = floor(qty/10) for SKU-BS-075, same SKU, not charged,
  but they reduce stock.
- Slab: 3% off line value when qty >= 5 cases for SKU-DT-1KG.
- Stacking order: free goods first, then discount on paid cases.
- Stock capping: cap quantity (including free) by stock and return a message.
- Return nudges: "Add N more cases to get 1 free / 3% off".
"""

from dataclasses import dataclass, field
import math
from typing import Any, Dict, List, Optional, Tuple, Union


@dataclass
class SKUDefinition:
    sku: str
    name: str
    category: str
    units_per_case: int
    price_per_piece: float
    case_price: float
    stock: int
    has_free_goods: bool = False
    free_ratio: int = 10  # 1 free per free_ratio paid cases
    slab_threshold: Optional[int] = None  # in cases
    slab_discount_pct: float = 0.0  # e.g. 0.03 for 3%


# Standard product catalog for Company A (Jabalpur distributor)
SKU_CATALOG: Dict[str, SKUDefinition] = {
    "SKU-BS-075": SKUDefinition(
        sku="SKU-BS-075",
        name="Parle-G Biscuit 75g",
        category="Biscuits",
        units_per_case=96,
        price_per_piece=8.10,
        case_price=777.60,  # 8.10 * 96
        stock=340,
        has_free_goods=True,
        free_ratio=10,
    ),
    "SKU-DT-1KG": SKUDefinition(
        sku="SKU-DT-1KG",
        name="Surf Excel Detergent 1kg",
        category="Detergents",
        units_per_case=20,
        price_per_piece=101.50,
        case_price=2030.00,  # 10150 / 5 cases
        stock=500,
        has_free_goods=False,
        slab_threshold=5,
        slab_discount_pct=0.03,  # 3% off
    ),
    "SKU-TEA-001": SKUDefinition(
        sku="SKU-TEA-001",
        name="Red Label Tea 250g",
        category="Tea",
        units_per_case=40,
        price_per_piece=120.00,
        case_price=4800.00,
        stock=0,  # Stock 0 (blocked)
        has_free_goods=False,
    ),
}

# SKU Alias mapping for developer convenience and friendly naming
SKU_ALIASES: Dict[str, str] = {
    "biscuit": "SKU-BS-075",
    "biscuits": "SKU-BS-075",
    "parle-g": "SKU-BS-075",
    "detergent": "SKU-DT-1KG",
    "surf": "SKU-DT-1KG",
    "tea": "SKU-TEA-001",
    "red label": "SKU-TEA-001",
    "sku-tea-250": "SKU-TEA-001",
    "sku-tea": "SKU-TEA-001",
}


@dataclass
class SchemeResult:
    sku: str
    requested_qty: int
    charged_qty: int
    free_qty: int
    total_qty: int
    case_price: float
    base_line_value: float
    discount_pct: float
    discount_amount: float
    final_line_value: float
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
    def discount(self) -> float:
        return self.discount_amount

    @property
    def final_value(self) -> float:
        return self.final_line_value

    @property
    def line_value(self) -> float:
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
            "case_price": self.case_price,
            "base_line_value": self.base_line_value,
            "discount_pct": self.discount_pct,
            "discount_amount": self.discount_amount,
            "final_line_value": self.final_line_value,
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
    subtotal_amount: float
    total_discount: float
    total_amount: float
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
    """Finds maximum paid qty <= requested_qty such that paid + floor(paid / free_ratio) <= available_stock.

    Uses binary search for O(log N) efficiency and exact guarantee that:
      charged_qty + free_qty <= available_stock.
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
    case_price: Optional[float] = None,
    stock: Optional[int] = None,
    has_free_goods: Optional[bool] = None,
    slab_threshold: Optional[int] = None,
    slab_discount_pct: Optional[float] = None,
) -> SchemeResult:
    """Evaluates schemes for an SKU line item following Company A business rules.

    Stacking order:
    1. Free goods evaluated first (not charged, but reduce stock).
    2. Quantities (including free goods) capped by available stock.
    3. Slab discount applied strictly to the line value of paid cases.
    4. Nudges generated for next tiers.
    """
    canonical_sku = resolve_sku(sku)
    sku_def = SKU_CATALOG.get(canonical_sku)

    # Resolve parameters from catalog defaults if not explicitly provided
    resolved_price = (
        case_price
        if case_price is not None
        else (sku_def.case_price if sku_def else 0.0)
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
    rule_slab_threshold = (
        slab_threshold
        if slab_threshold is not None
        else (sku_def.slab_threshold if sku_def else None)
    )
    rule_slab_discount = (
        slab_discount_pct
        if slab_discount_pct is not None
        else (sku_def.slab_discount_pct if sku_def else 0.0)
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
            base_line_value=0.0,
            discount_pct=0.0,
            discount_amount=0.0,
            final_line_value=0.0,
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
            message = (
                f"Quantity capped by stock: requested {qty} cases "
                f"(+ {unconstrained_free} free = {total_needed} total), "
                f"but only {resolved_stock} cases available. "
                f"Adjusted to {charged_qty} charged + {free_qty} free cases."
            )
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
            message = (
                f"Quantity capped by stock: requested {qty} cases, "
                f"but only {resolved_stock} cases available."
            )
        else:
            charged_qty = qty
            total_qty = charged_qty

    stock_consumed = total_qty

    # 2. Base Line Value on charged cases (Free goods are ₹0)
    base_line_value = round(charged_qty * resolved_price, 2)

    # 3. Stacking order: Slab discount applied to paid line value
    discount_pct = 0.0
    discount_amount = 0.0

    if (
        rule_slab_threshold is not None
        and rule_slab_discount > 0
        and charged_qty >= rule_slab_threshold
    ):
        discount_pct = rule_slab_discount
        discount_amount = round(base_line_value * discount_pct, 2)

    final_line_value = round(base_line_value - discount_amount, 2)

    # 4. Nudges generation: "Add N more cases to get 1 free / 3% off"
    if rule_has_free and not is_blocked:
        next_free_tier = ((charged_qty // rule_free_ratio) + 1) * rule_free_ratio
        cases_to_free = next_free_tier - charged_qty
        nudges.append(f"Add {cases_to_free} more cases to get 1 free")

    if rule_slab_threshold is not None and rule_slab_discount > 0 and not is_blocked:
        if charged_qty < rule_slab_threshold:
            cases_to_slab = rule_slab_threshold - charged_qty
            pct_label = (
                f"{int(rule_slab_discount * 100)}%"
                if (rule_slab_discount * 100).is_integer()
                else f"{rule_slab_discount * 100}%"
            )
            nudges.append(f"Add {cases_to_slab} more cases to get {pct_label} off")

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
    """Evaluates an entire shopping cart and produces totals, nudges, and alerts.

    Matches POST /cart/quote endpoint logic.
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

    # Subtotal and totals include unblocked items
    subtotal = round(sum(l.base_line_value for l in lines if not l.is_blocked), 2)
    total_discount = round(
        sum(l.discount_amount for l in lines if not l.is_blocked), 2
    )
    total_amount = round(
        sum(l.final_line_value for l in lines if not l.is_blocked), 2
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
