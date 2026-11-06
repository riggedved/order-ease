"""Database connection, session management, and seed data initialization."""

import os
from datetime import datetime, timezone
from decimal import Decimal
import json
from typing import Generator
from sqlmodel import SQLModel, Session, create_engine, select

from backend.app.models import (
    SKU,
    Retailer,
    User,
    Order,
    OrderLine,
    Alias,
    Role,
    OrderStatus,
    OrderSource,
)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./orderease.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def init_db(engine_to_use=engine) -> None:
    """Creates tables and seeds default data if tables are empty."""
    SQLModel.metadata.create_all(engine_to_use)
    with Session(engine_to_use) as session:
        seed_data_if_empty(session)


def seed_data_if_empty(session: Session) -> None:
    # Check if SKUs already seeded
    existing_sku = session.exec(select(SKU)).first()
    if existing_sku:
        return

    # 1. SKUs (3 Required + 3 Decoys with generic names)
    skus = [
        # Required sample SKUs
        SKU(
            code="SKU-BS-075",
            name="Glucose biscuit 75 g, case of 96",
            price_per_piece=Decimal("8.10"),
            units_per_case=96,
            gst_rate=Decimal("0.05"),
            price_includes_gst=False,
            stock_cases=340,
            scheme_type="free_goods",
            scheme_params=json.dumps({"free_ratio": 10}),
            image_url="https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200",
        ),
        SKU(
            code="SKU-DT-1KG",
            name="Detergent powder 1 kg, case of 20",
            price_per_piece=Decimal("101.50"),
            units_per_case=20,
            gst_rate=Decimal("0.18"),
            price_includes_gst=False,
            stock_cases=85,
            scheme_type="slab_discount",
            scheme_params=json.dumps({"threshold": 5, "discount_pct": "0.03"}),
            image_url="https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=200",
        ),
        SKU(
            code="SKU-TE-250",
            name="Tea leaf 250 g, case of 40",
            price_per_piece=Decimal("118.00"),
            units_per_case=40,
            gst_rate=Decimal("0.05"),
            price_includes_gst=False,
            stock_cases=0,  # 0 stock (blocked)
            scheme_type=None,
            scheme_params=None,
            image_url="https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=200",
        ),
        # Decoy SKUs
        SKU(
            code="SKU-BS-150",
            name="Glucose biscuit 150 g, case of 48",
            price_per_piece=Decimal("15.00"),
            units_per_case=48,
            gst_rate=Decimal("0.05"),
            price_includes_gst=True,
            stock_cases=120,
            scheme_type=None,
            scheme_params=None,
            image_url="https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200",
        ),
        SKU(
            code="SKU-DT-500",
            name="Detergent powder 500 g, case of 40",
            price_per_piece=Decimal("55.00"),
            units_per_case=40,
            gst_rate=Decimal("0.18"),
            price_includes_gst=True,
            stock_cases=100,
            scheme_type=None,
            scheme_params=None,
            image_url="https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=200",
        ),
        SKU(
            code="SKU-TE-100",
            name="Tea leaf 100 g, case of 80",
            price_per_piece=Decimal("50.00"),
            units_per_case=80,
            gst_rate=Decimal("0.05"),
            price_includes_gst=True,
            stock_cases=60,
            scheme_type=None,
            scheme_params=None,
            image_url="https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=200",
        ),
    ]
    for s in skus:
        session.add(s)
    session.commit()

    # 2. Staff Users (Desk, Salesman, Owner)
    desk_user = User(
        phone="9826000001",
        name="Desk Officer Priya",
        role=Role.ORDER_DESK,
        retailer_id=None,
    )
    salesman_user = User(
        phone="9826000002",
        name="Salesman Rahul Verma",
        role=Role.SALESMAN,
        retailer_id=None,
    )
    owner_user = User(
        phone="9826000003",
        name="Owner Rajesh Agarwal",
        role=Role.OWNER,
        retailer_id=None,
    )
    session.add(desk_user)
    session.add(salesman_user)
    session.add(owner_user)
    session.commit()

    # 3. 4 Retailers (One close to its limit, salesman assigned to 2)
    retailer_1 = Retailer(
        name="Gupta Kirana Store",
        phone="9826011111",
        credit_limit=Decimal("100000.00"),
        outstanding=Decimal("25000.00"),
        salesman_id=salesman_user.id,  # Assigned to salesman
    )
    retailer_2 = Retailer(
        name="Sharma Provision Store",
        phone="9826022222",
        credit_limit=Decimal("80000.00"),
        outstanding=Decimal("76500.00"),  # Close to limit! (95.6% utilized)
        salesman_id=salesman_user.id,  # Assigned to salesman
    )
    retailer_3 = Retailer(
        name="Verma General Stores",
        phone="9826033333",
        credit_limit=Decimal("50000.00"),
        outstanding=Decimal("12000.00"),
        salesman_id=None,  # Unassigned
    )
    retailer_4 = Retailer(
        name="Jabalpur Daily Mart",
        phone="9826044444",
        credit_limit=Decimal("120000.00"),
        outstanding=Decimal("35000.00"),
        salesman_id=None,  # Unassigned
    )
    session.add_all([retailer_1, retailer_2, retailer_3, retailer_4])
    session.commit()

    # 4. Retailer Users (linked to each Retailer)
    ret_user_1 = User(
        phone="9826011111",
        name="Ramesh Gupta",
        role=Role.RETAILER,
        retailer_id=retailer_1.id,
    )
    ret_user_2 = User(
        phone="9826022222",
        name="Suresh Sharma",
        role=Role.RETAILER,
        retailer_id=retailer_2.id,
    )
    ret_user_3 = User(
        phone="9826033333",
        name="Anil Verma",
        role=Role.RETAILER,
        retailer_id=retailer_3.id,
    )
    ret_user_4 = User(
        phone="9826044444",
        name="Vikram Patel",
        role=Role.RETAILER,
        retailer_id=retailer_4.id,
    )
    session.add_all([ret_user_1, ret_user_2, ret_user_3, ret_user_4])
    session.commit()

    # 5. Past Orders for each retailer
    order_1 = Order(
        retailer_id=retailer_1.id,
        status=OrderStatus.APPROVED,
        source=OrderSource.RETAILER_APP,
        placed_by_user_id=ret_user_1.id,
        created_at=datetime.now(timezone.utc),
        total=Decimal("7776.00"),
    )
    session.add(order_1)
    session.commit()

    line_1 = OrderLine(
        order_id=order_1.id,
        sku_code="SKU-BS-075",
        qty_cases=10,
        charged_cases=10,
        free_cases=1,
        price_per_case=Decimal("777.60"),
        discount_amount=Decimal("0.00"),
        line_total=Decimal("7776.00"),
    )
    session.add(line_1)

    order_2 = Order(
        retailer_id=retailer_2.id,
        status=OrderStatus.CREDIT_HOLD,
        source=OrderSource.SALESMAN,
        placed_by_user_id=salesman_user.id,
        created_at=datetime.now(timezone.utc),
        total=Decimal("9845.50"),
    )
    session.add(order_2)
    session.commit()

    line_2 = OrderLine(
        order_id=order_2.id,
        sku_code="SKU-DT-1KG",
        qty_cases=5,
        charged_cases=5,
        free_cases=0,
        price_per_case=Decimal("2030.00"),
        discount_amount=Decimal("304.50"),
        line_total=Decimal("9845.50"),
    )
    session.add(line_2)

    # 6. Generic Aliases
    alias_1 = Alias(
        retailer_id=retailer_1.id,
        original_words="glucose biscuit chota",
        sku_code="SKU-BS-075",
    )
    alias_2 = Alias(
        retailer_id=retailer_1.id,
        original_words="detergent powder 1kg",
        sku_code="SKU-DT-1KG",
    )
    alias_3 = Alias(
        retailer_id=retailer_1.id,
        original_words="tea leaf 250g",
        sku_code="SKU-TE-250",
    )
    session.add_all([alias_1, alias_2, alias_3])
    session.commit()

