"""Pydantic schemas for request validation and response serialization."""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.app.models import OrderStatus, OrderSource


# ---------------------------------------------------------
# Catalogue Schemas
# ---------------------------------------------------------
class CatalogueSKUResponse(BaseModel):
    code: str
    name: str
    image_url: Optional[str] = None
    price_per_piece: Decimal
    case_price: Decimal
    units_per_case: int
    price_includes_gst: bool
    gst_rate: Decimal
    scheme_label: Optional[str] = None
    stock_status: str  # in_stock | low | out


# ---------------------------------------------------------
# Cart Quote Schemas
# ---------------------------------------------------------
class CartQuoteLineRequest(BaseModel):
    sku_code: str
    qty_cases: int


class CartQuoteRequest(BaseModel):
    retailer_id: int
    lines: List[CartQuoteLineRequest]


class CartQuoteLineResponse(BaseModel):
    sku_code: str
    name: str
    requested_cases: int
    charged_cases: int
    free_cases: int
    case_price: Decimal
    discount: Decimal
    line_total: Decimal
    gst_rate: Decimal
    gst_amount: Decimal
    price_includes_gst: bool
    nudges: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    is_blocked: bool = False
    is_capped: bool = False


class CartQuoteResponse(BaseModel):
    subtotal: Decimal
    gst_amount: Decimal
    payable: Decimal
    lines: List[CartQuoteLineResponse]


# ---------------------------------------------------------
# Capture Schemas
# ---------------------------------------------------------
class CaptureRequest(BaseModel):
    retailer_id: Optional[int] = None
    text: str


class ParsedLineResponse(BaseModel):
    original_words: str
    sku_code: Optional[str] = None
    qty: Optional[int] = None
    unit: str = "unknown"
    confidence: str = "low"
    alternatives: List[str] = Field(default_factory=list)
    flags: List[str] = Field(default_factory=list)


class CaptureResponse(BaseModel):
    retailer_id: int
    raw_text: str
    lines: List[ParsedLineResponse]
    preview_quote: Optional[CartQuoteResponse] = None


# ---------------------------------------------------------
# Order Schemas
# ---------------------------------------------------------
class OrderLineCreateItem(BaseModel):
    sku_code: str
    qty_cases: int
    original_words: Optional[str] = None
    unit: Optional[str] = "case"


class OrderCreateRequest(BaseModel):
    retailer_id: int
    lines: List[OrderLineCreateItem]
    source: Optional[OrderSource] = None
    client_request_id: str
    # Malicious/client-provided totals to test server ignores them
    total: Optional[Decimal] = None


class OrderLineResponse(BaseModel):
    id: Optional[int] = None
    sku_code: str
    name: Optional[str] = None
    qty_cases: int
    charged_cases: int
    free_cases: int
    price_per_case: Decimal
    discount_amount: Decimal
    line_total: Decimal
    original_words: Optional[str] = None
    unit: Optional[str] = "case"


class OrderResponse(BaseModel):
    id: int
    retailer_id: int
    retailer_name: str
    status: OrderStatus
    source: OrderSource
    placed_by_user_id: int
    created_at: datetime
    total: Decimal
    client_request_id: Optional[str] = None
    override_flag: bool = False
    override_reason: Optional[str] = None
    exported_at: Optional[datetime] = None
    lines: List[OrderLineResponse] = Field(default_factory=list)


# ---------------------------------------------------------
# Desk Orders Schemas
# ---------------------------------------------------------
class DeskOrderSummary(BaseModel):
    id: int
    retailer_id: int
    retailer: str  # retailer name
    total: Decimal
    status: OrderStatus
    source: OrderSource
    created_at: datetime
    age: str


class CreditPositionResponse(BaseModel):
    credit_limit: Decimal
    outstanding: Decimal
    current_order_total: Decimal
    projected_outstanding: Decimal
    is_over_limit: bool
    available_credit: Decimal


class DeskOrderDetail(BaseModel):
    id: int
    retailer_id: int
    retailer_name: str
    status: OrderStatus
    source: OrderSource
    created_at: datetime
    total: Decimal
    client_request_id: Optional[str] = None
    override_flag: bool = False
    override_reason: Optional[str] = None
    exported_at: Optional[datetime] = None
    lines: List[OrderLineResponse] = Field(default_factory=list)
    credit_position: CreditPositionResponse


class OrderLinePatchItem(BaseModel):
    sku_code: str
    qty_cases: int
    original_words: Optional[str] = None


class OrderPatchRequest(BaseModel):
    status: Optional[OrderStatus] = None
    lines: Optional[List[OrderLinePatchItem]] = None
    override_flag: Optional[bool] = False
    override_reason: Optional[str] = None


class RetailerSimpleResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None


class UserMeResponse(BaseModel):
    id: int
    name: str
    user_name: Optional[str] = None
    role: str
    retailer_id: Optional[int] = None
    retailer_name: Optional[str] = None


