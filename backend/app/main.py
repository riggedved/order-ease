"""FastAPI application entrypoint with authentication, schemes, and order lifecycle management."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
import json
from typing import Any, List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from backend.app.db import get_session, init_db
from backend.app.models import (
    User,
    Retailer,
    Order,
    OrderLine,
    SKU,
    Role,
    OrderStatus,
    OrderSource,
)
from backend.app.schemes import evaluate_scheme, round_paisa
from backend.app.auth import (
    MOCK_OTP,
    create_access_token,
    get_current_user,
    require_role,
    check_retailer_access,
)
from backend.app.schemas import (
    CatalogueSKUResponse,
    CartQuoteRequest,
    CartQuoteResponse,
    CartQuoteLineResponse,
    OrderCreateRequest,
    OrderResponse,
    OrderLineResponse,
    DeskOrderSummary,
    DeskOrderDetail,
    CreditPositionResponse,
    OrderPatchRequest,
    RetailerSimpleResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and seed initial data only when running production
    if get_session not in app.dependency_overrides:
        init_db()
    yield


app = FastAPI(
    title="Company A Ordering App",
    description="Kirana ordering platform for Company A (Jabalpur distributor)",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------
def format_age(dt: datetime) -> str:
    """Formats datetime into human-friendly relative age (e.g., '10m ago', '2h ago')."""
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    diff = now - dt
    seconds = int(diff.total_seconds())
    if seconds < 60:
        return f"{max(1, seconds)}s ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def get_scheme_label(sku: SKU) -> Optional[str]:
    """Derives a human-friendly scheme label for catalog displays."""
    if sku.scheme_type == "free_goods":
        ratio = 10
        if sku.scheme_params:
            try:
                params = json.loads(sku.scheme_params)
                ratio = int(params.get("free_ratio", 10))
            except Exception:
                pass
        return f"Buy {ratio} get 1 free"
    elif sku.scheme_type == "slab_discount":
        threshold = 5
        pct = "3%"
        if sku.scheme_params:
            try:
                params = json.loads(sku.scheme_params)
                threshold = int(params.get("threshold", 5))
                raw_pct = Decimal(str(params.get("discount_pct", "0.03")))
                pct = f"{int(raw_pct * 100)}%"
            except Exception:
                pass
        return f"{pct} off on {threshold}+ cases"
    return None


def calculate_cart_quote(
    session: Session,
    lines_req: List[Any],
) -> CartQuoteResponse:
    """Shared calculation service executing schemes.py and calculating GST and totals."""
    quote_lines: List[CartQuoteLineResponse] = []
    unblocked_subtotal = Decimal("0.00")
    total_gst = Decimal("0.00")
    total_payable = Decimal("0.00")

    for line_item in lines_req:
        sku_code = line_item.sku_code
        qty = line_item.qty_cases

        sku = session.exec(select(SKU).where(SKU.code == sku_code)).first()
        if not sku:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"SKU {sku_code} not found",
            )

        # Parse scheme configuration from SKU model
        has_free = sku.scheme_type == "free_goods"
        slab_threshold = None
        slab_discount = Decimal("0.00")

        if sku.scheme_params:
            try:
                params = json.loads(sku.scheme_params)
                if sku.scheme_type == "slab_discount":
                    slab_threshold = int(params.get("threshold", 5))
                    slab_discount = Decimal(str(params.get("discount_pct", "0.03")))
            except Exception:
                pass

        # Pure scheme evaluation
        res = evaluate_scheme(
            sku=sku.code,
            qty=qty,
            case_price=sku.case_price,
            stock=sku.stock_cases,
            has_free_goods=has_free,
            slab_threshold=slab_threshold,
            slab_discount_pct=slab_discount,
        )

        warnings: List[str] = []
        if res.is_blocked:
            line_subtotal = Decimal("0.00")
            line_gst = Decimal("0.00")
            line_pay = Decimal("0.00")
            warnings.append(f"Out of stock ({sku.code} is out of stock)")
        else:
            line_subtotal = res.final_line_value
            if sku.price_includes_gst:
                # Price includes GST -> extract GST portion
                line_gst = round_paisa(
                    line_subtotal * sku.gst_rate / (Decimal("1.00") + sku.gst_rate)
                )
                line_pay = line_subtotal
            else:
                # Price excludes GST -> calculate GST to add
                line_gst = round_paisa(line_subtotal * sku.gst_rate)
                line_pay = line_subtotal + line_gst

            if res.is_capped and res.message:
                warnings.append(res.message)

            unblocked_subtotal += line_subtotal
            total_gst += line_gst
            total_payable += line_pay

        quote_lines.append(
            CartQuoteLineResponse(
                sku_code=sku.code,
                name=sku.name,
                requested_cases=qty,
                charged_cases=res.charged_qty,
                free_cases=res.free_qty,
                case_price=res.case_price,
                discount=res.discount_amount,
                line_total=line_subtotal,
                gst_rate=sku.gst_rate,
                gst_amount=line_gst,
                price_includes_gst=sku.price_includes_gst,
                nudges=res.nudges,
                warnings=warnings,
                is_blocked=res.is_blocked,
                is_capped=res.is_capped,
            )
        )

    return CartQuoteResponse(
        subtotal=unblocked_subtotal,
        gst_amount=total_gst,
        payable=total_payable,
        lines=quote_lines,
    )


# ---------------------------------------------------------
# Authentication Routes
# ---------------------------------------------------------
class OTPRequest(BaseModel):
    phone: str
    otp: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    retailer_id: Optional[int] = None
    name: str


@app.post("/auth/otp", response_model=TokenResponse)
def verify_otp(payload: OTPRequest, session: Session = Depends(get_session)):
    """Validates phone and mock OTP (123456) and returns JWT containing user id and role."""
    if payload.otp != MOCK_OTP:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP. Mock code is 123456",
        )

    user = session.exec(select(User).where(User.phone == payload.phone)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phone number not registered",
        )

    token_data = {
        "sub": str(user.id),
        "role": user.role.value,
        "phone": user.phone,
        "retailer_id": user.retailer_id,
        "name": user.name,
    }
    token = create_access_token(token_data)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user_id=user.id,
        role=user.role.value,
        retailer_id=user.retailer_id,
        name=user.name,
    )


# ---------------------------------------------------------
# Catalogue Endpoint
# ---------------------------------------------------------
@app.get("/catalogue", response_model=List[CatalogueSKUResponse])
def get_catalogue(
    retailer_id: int = Query(..., description="Retailer ID to fetch catalog for"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Returns product catalogue for a retailer.

    Never returns exact stock numbers to retailers (only 'in_stock', 'low', or 'out').
    Applies strict retailer access control.
    """
    check_retailer_access(retailer_id, current_user, session)
    skus = session.exec(select(SKU)).all()

    catalog_list: List[CatalogueSKUResponse] = []
    for s in skus:
        if s.stock_cases <= 0:
            stock_status = "out"
        elif s.stock_cases <= 10:
            stock_status = "low"
        else:
            stock_status = "in_stock"

        catalog_list.append(
            CatalogueSKUResponse(
                code=s.code,
                name=s.name,
                image_url=s.image_url,
                price_per_piece=s.price_per_piece,
                case_price=s.case_price,
                units_per_case=s.units_per_case,
                price_includes_gst=s.price_includes_gst,
                gst_rate=s.gst_rate,
                scheme_label=get_scheme_label(s),
                stock_status=stock_status,
            )
        )
    return catalog_list


# ---------------------------------------------------------
# Cart Quote Endpoint
# ---------------------------------------------------------
@app.post("/cart/quote", response_model=CartQuoteResponse)
def get_cart_quote(
    payload: CartQuoteRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Calculates live quote, applying schemes, stock capping, GST, and nudges."""
    check_retailer_access(payload.retailer_id, current_user, session)
    return calculate_cart_quote(session, payload.lines)


# ---------------------------------------------------------
# Orders Endpoints
# ---------------------------------------------------------
@app.post("/orders", response_model=OrderResponse)
def create_order(
    payload: OrderCreateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Places an order with server-side re-quoting, idempotency, and credit checks."""
    retailer = check_retailer_access(payload.retailer_id, current_user, session)

    # 1. Idempotency Check: Same client_request_id must never create a duplicate order
    existing_order = session.exec(
        select(Order).where(Order.client_request_id == payload.client_request_id)
    ).first()
    if existing_order:
        lines = session.exec(
            select(OrderLine).where(OrderLine.order_id == existing_order.id)
        ).all()
        return OrderResponse(
            id=existing_order.id,
            retailer_id=existing_order.retailer_id,
            retailer_name=retailer.name,
            status=existing_order.status,
            source=existing_order.source,
            placed_by_user_id=existing_order.placed_by_user_id,
            created_at=existing_order.created_at,
            total=existing_order.total,
            client_request_id=existing_order.client_request_id,
            override_flag=existing_order.override_flag,
            override_reason=existing_order.override_reason,
            lines=[
                OrderLineResponse(
                    id=ol.id,
                    sku_code=ol.sku_code,
                    qty_cases=ol.qty_cases,
                    charged_cases=ol.charged_cases,
                    free_cases=ol.free_cases,
                    price_per_case=ol.price_per_case,
                    discount_amount=ol.discount_amount,
                    line_total=ol.line_total,
                )
                for ol in lines
            ],
        )

    # 2. Server-side Re-quote: ignore client totals completely
    quote = calculate_cart_quote(session, payload.lines)

    # 3. Source assignment based on caller role
    if current_user.role == Role.RETAILER:
        if payload.source in [OrderSource.RETAILER_APP, OrderSource.RETAILER_CAPTURE]:
            order_source = payload.source
        else:
            order_source = OrderSource.RETAILER_APP
    elif current_user.role == Role.SALESMAN:
        order_source = OrderSource.SALESMAN
    else:  # order_desk or owner
        order_source = payload.source or OrderSource.DESK_CAPTURE

    # 4. Credit limit check: If outstanding + payable > credit_limit -> credit_hold
    total_liability = retailer.outstanding + quote.payable
    if total_liability > retailer.credit_limit:
        order_status = OrderStatus.CREDIT_HOLD
    else:
        order_status = OrderStatus.PENDING

    # 5. Persist Order (Stock is NOT reduced here; only when approved by desk)
    order = Order(
        retailer_id=retailer.id,
        status=order_status,
        source=order_source,
        placed_by_user_id=current_user.id,
        created_at=datetime.now(timezone.utc),
        total=quote.payable,
        client_request_id=payload.client_request_id,
    )
    session.add(order)
    session.commit()
    session.refresh(order)

    # 6. Persist Order Lines
    order_line_responses: List[OrderLineResponse] = []
    for ql in quote.lines:
        ol = OrderLine(
            order_id=order.id,
            sku_code=ql.sku_code,
            qty_cases=ql.requested_cases,
            charged_cases=ql.charged_cases,
            free_cases=ql.free_cases,
            price_per_case=ql.case_price,
            discount_amount=ql.discount,
            line_total=ql.line_total,
        )
        session.add(ol)
        session.commit()
        session.refresh(ol)
        order_line_responses.append(
            OrderLineResponse(
                id=ol.id,
                sku_code=ol.sku_code,
                name=ql.name,
                qty_cases=ol.qty_cases,
                charged_cases=ol.charged_cases,
                free_cases=ol.free_cases,
                price_per_case=ol.price_per_case,
                discount_amount=ol.discount_amount,
                line_total=ol.line_total,
            )
        )

    return OrderResponse(
        id=order.id,
        retailer_id=order.retailer_id,
        retailer_name=retailer.name,
        status=order.status,
        source=order.source,
        placed_by_user_id=order.placed_by_user_id,
        created_at=order.created_at,
        total=order.total,
        client_request_id=order.client_request_id,
        override_flag=order.override_flag,
        override_reason=order.override_reason,
        lines=order_line_responses,
    )


@app.get("/orders/mine", response_model=List[OrderResponse])
def get_my_orders(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Returns a retailer's own order history."""
    if not current_user.retailer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current user is not associated with a retailer",
        )
    retailer = session.get(Retailer, current_user.retailer_id)
    orders = session.exec(
        select(Order)
        .where(Order.retailer_id == current_user.retailer_id)
        .order_by(Order.created_at.desc())
    ).all()

    results: List[OrderResponse] = []
    for o in orders:
        lines = session.exec(select(OrderLine).where(OrderLine.order_id == o.id)).all()
        results.append(
            OrderResponse(
                id=o.id,
                retailer_id=o.retailer_id,
                retailer_name=retailer.name if retailer else "",
                status=o.status,
                source=o.source,
                placed_by_user_id=o.placed_by_user_id,
                created_at=o.created_at,
                total=o.total,
                client_request_id=o.client_request_id,
                override_flag=o.override_flag,
                override_reason=o.override_reason,
                lines=[
                    OrderLineResponse(
                        id=ol.id,
                        sku_code=ol.sku_code,
                        qty_cases=ol.qty_cases,
                        charged_cases=ol.charged_cases,
                        free_cases=ol.free_cases,
                        price_per_case=ol.price_per_case,
                        discount_amount=ol.discount_amount,
                        line_total=ol.line_total,
                    )
                    for ol in lines
                ],
            )
        )
    return results


# ---------------------------------------------------------
# Retailers Directory (Desk & Owner only)
# ---------------------------------------------------------
@app.get("/retailers", response_model=List[RetailerSimpleResponse])
@app.get("/desk/retailers", response_model=List[RetailerSimpleResponse])
def get_all_retailers(
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns id and name for every retailer so the desk can pick a retailer."""
    retailers = session.exec(select(Retailer).order_by(Retailer.name)).all()
    return [
        RetailerSimpleResponse(id=r.id, name=r.name, phone=r.phone)
        for r in retailers
    ]


@app.get("/retailers/{retailer_id}")
def get_retailer(
    retailer_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Retrieves retailer profile and credit limits with store-level access control."""
    retailer = check_retailer_access(retailer_id, current_user, session)
    return {
        "id": retailer.id,
        "name": retailer.name,
        "phone": retailer.phone,
        "credit_limit": retailer.credit_limit,
        "outstanding": retailer.outstanding,
        "salesman_id": retailer.salesman_id,
    }


# ---------------------------------------------------------
# Desk Endpoints (Protected: only order_desk and owner)
# ---------------------------------------------------------
@app.get("/desk/orders", response_model=List[DeskOrderSummary])
def get_desk_orders(
    status_filter: Optional[OrderStatus] = Query(None, alias="status"),
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns distributor orders across all stores with status and relative age."""
    query = select(Order).order_by(Order.created_at.desc())
    if status_filter:
        query = query.where(Order.status == status_filter)
    orders = session.exec(query).all()

    results: List[DeskOrderSummary] = []
    for o in orders:
        ret = session.get(Retailer, o.retailer_id)
        results.append(
            DeskOrderSummary(
                id=o.id,
                retailer_id=o.retailer_id,
                retailer=ret.name if ret else f"Retailer #{o.retailer_id}",
                total=o.total,
                status=o.status,
                source=o.source,
                created_at=o.created_at,
                age=format_age(o.created_at),
            )
        )
    return results


@app.get("/desk/orders/{order_id}", response_model=DeskOrderDetail)
def get_desk_order_detail(
    order_id: int,
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns complete detail of an order, including lines and retailer credit position."""
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order #{order_id} not found",
        )

    retailer = session.get(Retailer, order.retailer_id)
    lines = session.exec(select(OrderLine).where(OrderLine.order_id == order.id)).all()

    # Calculate retailer credit position
    projected = retailer.outstanding + order.total
    is_over = projected > retailer.credit_limit
    available = max(Decimal("0.00"), retailer.credit_limit - retailer.outstanding)

    credit_pos = CreditPositionResponse(
        credit_limit=retailer.credit_limit,
        outstanding=retailer.outstanding,
        current_order_total=order.total,
        projected_outstanding=projected,
        is_over_limit=is_over,
        available_credit=available,
    )

    return DeskOrderDetail(
        id=order.id,
        retailer_id=order.retailer_id,
        retailer_name=retailer.name if retailer else "",
        status=order.status,
        source=order.source,
        created_at=order.created_at,
        total=order.total,
        client_request_id=order.client_request_id,
        override_flag=order.override_flag,
        override_reason=order.override_reason,
        lines=[
            OrderLineResponse(
                id=ol.id,
                sku_code=ol.sku_code,
                qty_cases=ol.qty_cases,
                charged_cases=ol.charged_cases,
                free_cases=ol.free_cases,
                price_per_case=ol.price_per_case,
                discount_amount=ol.discount_amount,
                line_total=ol.line_total,
            )
            for ol in lines
        ],
        credit_position=credit_pos,
    )


@app.patch("/desk/orders/{order_id}", response_model=DeskOrderDetail)
def patch_desk_order(
    order_id: int,
    payload: OrderPatchRequest,
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Edits line quantities (re-quotes), approves order, or releases credit holds.

    Approving a credit_hold order requires explicit override_flag=True and override_reason.
    Stock is decremented upon approval.
    """
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order #{order_id} not found",
        )

    retailer = session.get(Retailer, order.retailer_id)

    # 1. Edit line quantities if provided (re-quote on server)
    if payload.lines is not None:
        quote = calculate_cart_quote(session, payload.lines)

        # Clear old lines and replace with new ones
        old_lines = session.exec(
            select(OrderLine).where(OrderLine.order_id == order.id)
        ).all()
        for ol in old_lines:
            session.delete(ol)
        session.commit()

        for ql in quote.lines:
            ol = OrderLine(
                order_id=order.id,
                sku_code=ql.sku_code,
                qty_cases=ql.requested_cases,
                charged_cases=ql.charged_cases,
                free_cases=ql.free_cases,
                price_per_case=ql.case_price,
                discount_amount=ql.discount,
                line_total=ql.line_total,
            )
            session.add(ol)
        order.total = quote.payable

        # If not approved, re-evaluate credit limit
        if order.status != OrderStatus.APPROVED:
            if retailer.outstanding + order.total > retailer.credit_limit:
                order.status = OrderStatus.CREDIT_HOLD
            else:
                order.status = OrderStatus.PENDING

    # 2. Status change / approval handling
    if payload.status is not None:
        target_status = payload.status

        # Approving a credit_hold order needs an explicit override flag and reason
        if (
            order.status == OrderStatus.CREDIT_HOLD
            and target_status == OrderStatus.APPROVED
        ):
            if not payload.override_flag or not (
                payload.override_reason and payload.override_reason.strip()
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Approving a credit_hold order requires override_flag=True and a non-empty override_reason",
                )
            order.override_flag = True
            order.override_reason = payload.override_reason.strip()

        # Stock reduction only occurs when the desk approves
        if (
            target_status == OrderStatus.APPROVED
            and order.status != OrderStatus.APPROVED
        ):
            # Reduce stock in SKU table for each line
            order_lines = session.exec(
                select(OrderLine).where(OrderLine.order_id == order.id)
            ).all()
            for ol in order_lines:
                sku = session.exec(
                    select(SKU).where(SKU.code == ol.sku_code)
                ).first()
                if sku:
                    sku.stock_cases -= (ol.charged_cases + ol.free_cases)
                    session.add(sku)

            # Update retailer balance
            retailer.outstanding += order.total
            session.add(retailer)

        order.status = target_status

    if payload.override_flag:
        order.override_flag = True
    if payload.override_reason:
        order.override_reason = payload.override_reason.strip()

    session.add(order)
    session.commit()
    session.refresh(order)

    return get_desk_order_detail(
        order_id=order.id, current_user=current_user, session=session
    )
