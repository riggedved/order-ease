"""SQLModel models for Company A Kirana Distributor Ordering.

Entities:
- SKU: code, name, price_per_piece, units_per_case, gst_rate, price_includes_gst,
       stock_cases, scheme_type, scheme_params, image_url.
- User: role enum (retailer, salesman, order_desk, owner).
- Retailer: name, phone, credit_limit, outstanding, nullable salesman_id.
- Order: retailer_id, status (pending | credit_hold | approved),
         source (retailer_app | retailer_capture | desk_capture | salesman),
         placed_by_user_id, created_at, total.
- OrderLine: order_id, sku_code, qty_cases, charged_cases, free_cases,
             price_per_case, discount_amount, line_total.
- Alias: retailer_id, original_words, sku_code.
"""

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


class Role(str, Enum):
    RETAILER = "retailer"
    SALESMAN = "salesman"
    ORDER_DESK = "order_desk"
    OWNER = "owner"


class OrderStatus(str, Enum):
    PENDING = "pending"
    CREDIT_HOLD = "credit_hold"
    APPROVED = "approved"
    CANCELLED = "cancelled"


class OrderSource(str, Enum):
    RETAILER_APP = "retailer_app"
    RETAILER_CAPTURE = "retailer_capture"
    DESK_CAPTURE = "desk_capture"
    SALESMAN = "salesman"


class SKU(SQLModel, table=True):
    __tablename__ = "skus"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, description="Canonical SKU code e.g. SKU-BS-075")
    name: str = Field(description="Product name")
    price_per_piece: Decimal = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
    units_per_case: int = Field(default=1, description="Number of units per case")
    gst_rate: Decimal = Field(default=Decimal("0.05"), max_digits=5, decimal_places=4, description="GST rate e.g. 0.05 for 5%")
    price_includes_gst: bool = Field(default=True, description="Whether price_per_piece includes GST")
    stock_cases: int = Field(default=0, description="Available stock in cases")
    scheme_type: Optional[str] = Field(default=None, description="free_goods | slab_discount | None")
    scheme_params: Optional[str] = Field(default=None, description="JSON encoded scheme parameters")
    image_url: Optional[str] = Field(default=None, description="Product image URL")

    @property
    def case_price(self) -> Decimal:
        return (self.price_per_piece * Decimal(self.units_per_case)).quantize(Decimal("0.01"))


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    phone: str = Field(index=True, unique=True, description="User phone number")
    name: str = Field(description="User full name")
    role: Role = Field(default=Role.RETAILER, description="User role enum")
    retailer_id: Optional[int] = Field(default=None, foreign_key="retailers.id", nullable=True)

    # Relationships
    retailer: Optional["Retailer"] = Relationship(back_populates="users", sa_relationship_kwargs={"foreign_keys": "[User.retailer_id]"})


class Retailer(SQLModel, table=True):
    __tablename__ = "retailers"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(description="Shop/Kirana name")
    phone: str = Field(index=True, description="Retailer phone")
    credit_limit: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    outstanding: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    salesman_id: Optional[int] = Field(default=None, foreign_key="users.id", nullable=True)

    # Relationships
    users: List[User] = Relationship(back_populates="retailer", sa_relationship_kwargs={"foreign_keys": "[User.retailer_id]"})
    orders: List["Order"] = Relationship(back_populates="retailer")
    aliases: List["Alias"] = Relationship(back_populates="retailer")


class Order(SQLModel, table=True):
    __tablename__ = "orders"

    id: Optional[int] = Field(default=None, primary_key=True)
    retailer_id: int = Field(foreign_key="retailers.id", index=True)
    status: OrderStatus = Field(default=OrderStatus.PENDING)
    source: OrderSource = Field(default=OrderSource.RETAILER_APP)
    placed_by_user_id: int = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    total: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    client_request_id: Optional[str] = Field(default=None, index=True, nullable=True)
    override_flag: bool = Field(default=False)
    override_reason: Optional[str] = Field(default=None, nullable=True)
    exported_at: Optional[datetime] = Field(default=None, nullable=True)

    # Relationships
    retailer: Optional[Retailer] = Relationship(back_populates="orders")
    lines: List["OrderLine"] = Relationship(back_populates="order")


class OrderLine(SQLModel, table=True):
    __tablename__ = "order_lines"

    id: Optional[int] = Field(default=None, primary_key=True)
    order_id: int = Field(foreign_key="orders.id", index=True)
    sku_code: str = Field(index=True)
    qty_cases: int = Field(default=1)
    charged_cases: int = Field(default=1)
    free_cases: int = Field(default=0)
    price_per_case: Decimal = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
    line_total: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    original_words: Optional[str] = Field(default=None, nullable=True)
    unit: Optional[str] = Field(default="case", nullable=True)

    # Relationships
    order: Optional[Order] = Relationship(back_populates="lines")


class Alias(SQLModel, table=True):
    __tablename__ = "aliases"

    id: Optional[int] = Field(default=None, primary_key=True)
    retailer_id: int = Field(foreign_key="retailers.id", index=True)
    original_words: str = Field(description="Custom local text or vernacular query")
    sku_code: str = Field(description="Mapped SKU code")

    # Relationships
    retailer: Optional[Retailer] = Relationship(back_populates="aliases")


class CaptureLog(SQLModel, table=True):
    __tablename__ = "capture_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    retailer_id: int = Field(foreign_key="retailers.id", index=True)
    raw_text: str = Field(description="Raw message text captured")
    parsed_json: str = Field(description="JSON serialized parsed lines and quote")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

