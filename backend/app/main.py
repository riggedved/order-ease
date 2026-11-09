"""FastAPI application entrypoint with authentication, schemes, and order lifecycle management."""

import csv
import io
import os
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timezone
from decimal import Decimal
import json
from typing import Any, List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Depends, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from backend.app.db import get_session, init_db
from backend.app.models import (
    User,
    Retailer,
    Order,
    OrderLine,
    SKU,
    Alias,
    CaptureLog,
    Role,
    OrderStatus,
    OrderSource,
)
from backend.app.schemes import evaluate_scheme, round_paisa
from backend.app.capture import get_parser
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
    CartQuoteLineRequest,
    CartQuoteLineResponse,
    OrderCreateRequest,
    OrderResponse,
    OrderLineResponse,
    OrderLinePatchItem,
    DeskOrderSummary,
    DeskOrdersCounts,
    DeskOrdersResponse,
    DeskOrderLineResponse,
    DeskCatalogueSKUResponse,
    DeskOrderDetail,
    CreditPositionResponse,
    OrderPatchRequest,
    RetailerSimpleResponse,
    CaptureRequest,
    CaptureResponse,
    ParsedLineResponse,
    UserMeResponse,
    PaymentRequest,
    PaymentResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and seed initial data if not already seeded
    init_db()
    yield


app = FastAPI(
    title="Company A Ordering App",
    description="Kirana ordering platform for Company A (Jabalpur distributor)",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration: allow origins from env var ALLOWED_ORIGINS (comma-separated, default empty)
allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip() for o in allowed_origins_raw.split(",") if o.strip()]

if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ---------------------------------------------------------
# Health Check Endpoint
# ---------------------------------------------------------
@app.get("/health")
def health_check():
    """Health check endpoint for Render and deployment monitoring with no auth or database work."""
    return {"status": "ok"}


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
                # Price includes GST -> GST should only be calculated on items exclusive of GST
                line_gst = Decimal("0.00")
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
    user_name: str
    retailer_name: Optional[str] = None


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

    retailer_name = None
    if user.retailer_id:
        retailer = session.get(Retailer, user.retailer_id)
        if retailer:
            retailer_name = retailer.name

    token_data = {
        "sub": str(user.id),
        "role": user.role.value,
        "phone": user.phone,
        "retailer_id": user.retailer_id,
        "name": user.name,
        "user_name": user.name,
        "retailer_name": retailer_name,
    }
    token = create_access_token(token_data)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user_id=user.id,
        role=user.role.value,
        retailer_id=user.retailer_id,
        name=user.name,
        user_name=user.name,
        retailer_name=retailer_name,
    )


@app.get("/me", response_model=UserMeResponse)
def get_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Returns user profile for the logged-in user.

    For retailer users:
    - phone: user's phone number
    - salesman_name: name of assigned salesman (or None if unassigned)
    - salesman_phone: phone of assigned salesman (or None if unassigned)
    - credit_low: True when available_credit is below 10% of credit_limit
    For staff users (desk, salesman, owner):
    - phone, salesman_name, salesman_phone, credit_low are null.
    """
    retailer_name = None
    phone = None
    salesman_name = None
    salesman_phone = None
    credit_low = None
    credit_limit = None
    outstanding = None
    available_credit_val = None

    if current_user.role == Role.RETAILER:
        phone = current_user.phone
        if current_user.retailer_id:
            retailer = session.get(Retailer, current_user.retailer_id)
            if retailer:
                retailer_name = retailer.name
                credit_limit = retailer.credit_limit
                outstanding = retailer.outstanding
                available_credit = retailer.credit_limit - retailer.outstanding
                available_credit_val = available_credit
                credit_low = available_credit < (retailer.credit_limit * Decimal("0.10"))
                if retailer.salesman_id:
                    salesman = session.get(User, retailer.salesman_id)
                    if salesman:
                        salesman_name = salesman.name
                        salesman_phone = salesman.phone

    return UserMeResponse(
        id=current_user.id,
        name=current_user.name,
        user_name=current_user.name,
        role=current_user.role.value,
        retailer_id=current_user.retailer_id,
        retailer_name=retailer_name,
        phone=phone,
        salesman_name=salesman_name,
        salesman_phone=salesman_phone,
        credit_low=credit_low,
        credit_limit=credit_limit,
        outstanding=outstanding,
        available_credit=available_credit_val,
    )


@app.post("/me/pay", response_model=PaymentResponse)
def pay_outstanding(
    payload: Optional[PaymentRequest] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Allows a retailer to pay their outstanding balance, restoring available credit."""
    if current_user.role != Role.RETAILER or not current_user.retailer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Only retailers can pay their outstanding balance",
        )

    retailer = session.get(Retailer, current_user.retailer_id)
    if not retailer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Retailer profile not found",
        )

    # Determine amount to pay: if not specified or <= 0, pay full outstanding
    pay_amount = payload.amount if payload and payload.amount and payload.amount > 0 else retailer.outstanding

    if pay_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No outstanding balance to pay",
        )

    actual_paid = min(retailer.outstanding, pay_amount)
    retailer.outstanding = max(Decimal("0.00"), retailer.outstanding - actual_paid)
    session.add(retailer)
    session.commit()
    session.refresh(retailer)

    available = retailer.credit_limit - retailer.outstanding
    return PaymentResponse(
        success=True,
        amount_paid=actual_paid,
        new_outstanding=retailer.outstanding,
        new_available_credit=available,
        message=f"Payment of ₹{actual_paid} successful. Available credit is now ₹{available}.",
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
# Cart Quote & Capture Endpoints
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


@app.post("/capture", response_model=CaptureResponse)
def capture_order(
    payload: CaptureRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Parses vernacular voice/text message, generates quote preview, and saves capture log. Creates NO order."""
    if current_user.role == Role.RETAILER:
        if payload.retailer_id is not None and payload.retailer_id != current_user.retailer_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Retailer cannot capture for another retailer",
            )
        eff_retailer_id = current_user.retailer_id
    else:
        if not payload.retailer_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="retailer_id is required",
            )
        check_retailer_access(payload.retailer_id, current_user, session)
        eff_retailer_id = payload.retailer_id

    parser = get_parser()
    capture_result = parser.parse(payload.text, eff_retailer_id, session)

    # Build preview quote for quoteable lines (unit == 'case' and valid SKU)
    quoteable = [
        CartQuoteLineRequest(sku_code=l.sku_code, qty_cases=l.qty or 1)
        for l in capture_result.lines
        if l.sku_code and l.unit == "case" and (l.qty or 0) > 0
    ]

    preview_quote = None
    if quoteable:
        preview_quote = calculate_cart_quote(session, quoteable)

    # Save only a capture log. Creates NO order.
    log_entry = CaptureLog(
        retailer_id=eff_retailer_id,
        raw_text=payload.text,
        parsed_json=json.dumps({
            "lines": [l.to_dict() for l in capture_result.lines],
            "preview_subtotal": str(preview_quote.subtotal) if preview_quote else "0.00",
            "preview_payable": str(preview_quote.payable) if preview_quote else "0.00",
        }),
    )
    session.add(log_entry)
    session.commit()

    parsed_responses = [
        ParsedLineResponse(
            original_words=l.original_words,
            sku_code=l.sku_code,
            qty=l.qty,
            unit=l.unit,
            confidence=l.confidence,
            alternatives=l.alternatives,
            flags=l.flags,
        )
        for l in capture_result.lines
    ]

    return CaptureResponse(
        retailer_id=eff_retailer_id,
        raw_text=payload.text,
        lines=parsed_responses,
        preview_quote=preview_quote,
    )


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
    # Retailer-specific restrictions
    if current_user.role == Role.RETAILER:
        if payload.retailer_id != current_user.retailer_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Retailer cannot order for another retailer",
            )
        if payload.source == OrderSource.DESK_CAPTURE or (
            payload.source and str(payload.source) == "desk_capture"
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Retailer cannot specify desk_capture as source",
            )

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
                    original_words=ol.original_words,
                    unit=ol.unit,
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

    # Orders within the credit limit are placed normally and decrease the available credit limit (by increasing outstanding)
    if order_status != OrderStatus.CREDIT_HOLD:
        retailer.outstanding += quote.payable
        session.add(retailer)

    session.commit()
    session.refresh(order)
    session.refresh(retailer)

    # 6. Persist Order Lines carrying original_words and unit
    req_meta = {
        idx: (item.original_words, item.unit)
        for idx, item in enumerate(payload.lines)
    }

    order_line_responses: List[OrderLineResponse] = []
    for idx, ql in enumerate(quote.lines):
        words, unit_val = req_meta.get(idx, (None, "case"))
        ol = OrderLine(
            order_id=order.id,
            sku_code=ql.sku_code,
            qty_cases=ql.requested_cases,
            charged_cases=ql.charged_cases,
            free_cases=ql.free_cases,
            price_per_case=ql.case_price,
            discount_amount=ql.discount,
            line_total=ql.line_total,
            original_words=words,
            unit=unit_val or "case",
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
                original_words=ol.original_words,
                unit=ol.unit,
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
    limit: Optional[int] = Query(default=None, description="Optional maximum number of orders to return", ge=1),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Returns a retailer's own order history, newest first."""
    if not current_user.retailer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current user is not associated with a retailer",
        )
    retailer = session.get(Retailer, current_user.retailer_id)
    query = (
        select(Order)
        .where(Order.retailer_id == current_user.retailer_id)
        .order_by(Order.created_at.desc(), Order.id.desc())
    )
    if limit is not None:
        query = query.limit(limit)
    orders = session.exec(query).all()

    sku_map = {s.code: s.name for s in session.exec(select(SKU)).all()}
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
                        name=sku_map.get(ol.sku_code, ol.sku_code),
                        qty_cases=ol.qty_cases,
                        charged_cases=ol.charged_cases,
                        free_cases=ol.free_cases,
                        price_per_case=ol.price_per_case,
                        discount_amount=ol.discount_amount,
                        line_total=ol.line_total,
                        original_words=ol.original_words,
                        unit=ol.unit,
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
    q: Optional[str] = Query(None, description="Retailer name contains"),
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns id and name for every retailer so the desk can pick a retailer."""
    query = select(Retailer).order_by(Retailer.name)
    if q and q.strip():
        query = query.where(Retailer.name.ilike(f"%{q.strip()}%"))
    retailers = session.exec(query).all()
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
@app.get("/desk/catalogue", response_model=List[DeskCatalogueSKUResponse])
def get_desk_catalogue(
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns catalogue with exact stock quantities for desk and owner only."""
    skus = session.exec(select(SKU).order_by(SKU.code)).all()
    return [
        DeskCatalogueSKUResponse(
            sku_code=s.code,
            name=s.name,
            case_price=s.case_price,
            units_per_case=s.units_per_case,
            price_includes_gst=s.price_includes_gst,
            stock_cases=s.stock_cases,
        )
        for s in skus
    ]


@app.get("/desk/orders", response_model=DeskOrdersResponse)
def get_desk_orders(
    status_filter: Optional[OrderStatus] = Query(None, alias="status"),
    q: Optional[str] = Query(None, description="Retailer name contains"),
    from_date: Optional[date] = Query(None, description="Start date filter (inclusive)"),
    to_date: Optional[date] = Query(None, description="End date filter (inclusive)"),
    sort: str = Query("newest", description="sort order: newest | oldest"),
    limit: int = Query(50, ge=1, le=200, description="Items limit (default 50, max 200)"),
    offset: int = Query(0, ge=0, description="Items offset (default 0)"),
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns distributor orders across all stores with status and relative age."""
    base_query = select(Order).join(Retailer, Order.retailer_id == Retailer.id)
    if q and q.strip():
        base_query = base_query.where(Retailer.name.ilike(f"%{q.strip()}%"))
    if from_date:
        start_dt = datetime.combine(from_date, time.min).replace(tzinfo=timezone.utc)
        base_query = base_query.where(Order.created_at >= start_dt)
    if to_date:
        end_dt = datetime.combine(to_date, time.max).replace(tzinfo=timezone.utc)
        base_query = base_query.where(Order.created_at <= end_dt)

    base_orders = session.exec(base_query).all()
    count_all = len(base_orders)
    count_pending = sum(1 for o in base_orders if o.status == OrderStatus.PENDING)
    count_credit_hold = sum(1 for o in base_orders if o.status == OrderStatus.CREDIT_HOLD)
    count_approved = sum(1 for o in base_orders if o.status == OrderStatus.APPROVED)
    counts = DeskOrdersCounts(
        all=count_all,
        pending=count_pending,
        credit_hold=count_credit_hold,
        approved=count_approved,
    )

    filtered_query = base_query
    if status_filter:
        filtered_query = filtered_query.where(Order.status == status_filter)

    if sort == "oldest":
        filtered_query = filtered_query.order_by(Order.created_at.asc(), Order.id.asc())
    else:
        filtered_query = filtered_query.order_by(Order.created_at.desc(), Order.id.desc())

    if status_filter:
        total = (
            count_pending if status_filter == OrderStatus.PENDING
            else count_credit_hold if status_filter == OrderStatus.CREDIT_HOLD
            else count_approved if status_filter == OrderStatus.APPROVED
            else sum(1 for o in base_orders if o.status == status_filter)
        )
    else:
        total = count_all

    paged_orders = session.exec(filtered_query.offset(offset).limit(limit)).all()

    items: List[DeskOrderSummary] = []
    for o in paged_orders:
        ret = session.get(Retailer, o.retailer_id)
        items.append(
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
    return DeskOrdersResponse(items=items, total=total, counts=counts)


@app.post("/orders/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Cancels a pending or credit_hold order and restores retailer credit limit if previously pending."""
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order #{order_id} not found",
        )

    # Check retailer authorization: Retailer can only cancel their own orders
    if current_user.role == Role.RETAILER:
        if order.retailer_id != current_user.retailer_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Cannot cancel an order belonging to another retailer",
            )
    elif current_user.role == Role.SALESMAN:
        retailer = session.get(Retailer, order.retailer_id)
        if not retailer or retailer.salesman_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Salesman not assigned to this retailer",
            )

    # Check allowed statuses
    if order.status not in [OrderStatus.PENDING, OrderStatus.CREDIT_HOLD]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel order #{order_id} with status '{order.status}'. Only pending or credit_hold orders can be cancelled.",
        )

    retailer = session.get(Retailer, order.retailer_id)

    # If the order was pending, its total was added to retailer.outstanding; restore it!
    if order.status == OrderStatus.PENDING and retailer:
        retailer.outstanding = max(Decimal("0.00"), retailer.outstanding - order.total)
        session.add(retailer)

    order.status = OrderStatus.CANCELLED
    session.add(order)
    session.commit()
    session.refresh(order)

    lines = session.exec(select(OrderLine).where(OrderLine.order_id == order.id)).all()
    sku_map = {s.code: s.name for s in session.exec(select(SKU)).all()}
    return OrderResponse(
        id=order.id,
        retailer_id=order.retailer_id,
        retailer_name=retailer.name if retailer else "",
        status=order.status,
        source=order.source,
        placed_by_user_id=order.placed_by_user_id,
        created_at=order.created_at,
        total=order.total,
        client_request_id=order.client_request_id,
        override_flag=order.override_flag,
        override_reason=order.override_reason,
        lines=[
            OrderLineResponse(
                id=ol.id,
                sku_code=ol.sku_code,
                name=sku_map.get(ol.sku_code, ol.sku_code),
                qty_cases=ol.qty_cases,
                charged_cases=ol.charged_cases,
                free_cases=ol.free_cases,
                price_per_case=ol.price_per_case,
                discount_amount=ol.discount_amount,
                line_total=ol.line_total,
                original_words=ol.original_words,
                unit=ol.unit,
            )
            for ol in lines
        ],
    )


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

    desk_lines: List[DeskOrderLineResponse] = []
    for ol in lines:
        sku = session.exec(select(SKU).where(SKU.code == ol.sku_code)).first()
        sku_name = sku.name if sku else ol.sku_code
        desk_lines.append(
            DeskOrderLineResponse(
                line_id=ol.id,
                id=ol.id,
                sku_code=ol.sku_code,
                sku_name=sku_name,
                qty_cases=ol.qty_cases,
                charged_cases=ol.charged_cases,
                free_cases=ol.free_cases,
                price_per_case=ol.price_per_case,
                discount_amount=ol.discount_amount,
                line_total=ol.line_total,
                original_words=ol.original_words,
                unit=ol.unit,
            )
        )

    placed_user = session.get(User, order.placed_by_user_id) if order.placed_by_user_id else None
    placed_by_name = placed_user.name if placed_user else "Unknown"

    approver = session.get(User, order.approved_by_user_id) if order.approved_by_user_id else None
    approved_by_name = approver.name if approver else None

    return DeskOrderDetail(
        id=order.id,
        retailer_id=order.retailer_id,
        retailer_name=retailer.name if retailer else "",
        status=order.status,
        source=order.source,
        created_at=order.created_at,
        total=order.total,
        placed_by=placed_by_name,
        placed_by_user_id=order.placed_by_user_id,
        credit_position=credit_pos,
        override_flag=order.override_flag,
        override_reason=order.override_reason,
        approved_by=approved_by_name,
        approved_at=order.approved_at,
        version=order.version,
        client_request_id=order.client_request_id,
        exported_at=order.exported_at,
        lines=desk_lines,
    )


@app.patch("/desk/orders/{order_id}", response_model=DeskOrderDetail)
def patch_desk_order(
    order_id: int,
    payload: OrderPatchRequest,
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Edits line quantities (re-quotes), approves order, or releases credit holds.

    Requires current version. Stale version returns 409.
    Approving already approved order returns 409.
    Stock is decremented upon approval. Approver is recorded.
    Version is incremented on every change.
    """
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order #{order_id} not found",
        )

    # Require current version. If stale or missing, return 409
    if payload.version is None or payload.version != order.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This order was changed by someone else. Reload it.",
        )

    # Approving an already approved order returns 409
    if payload.status == OrderStatus.APPROVED and order.status == OrderStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This order is already approved",
        )

    retailer = session.get(Retailer, order.retailer_id)

    # 1. Edit line quantities if provided (re-quote on server)
    if payload.lines is not None:
        old_lines = session.exec(
            select(OrderLine).where(OrderLine.order_id == order.id)
        ).all()
        old_words_sku = {
            ol.original_words.strip().lower(): ol.sku_code
            for ol in old_lines
            if ol.original_words
        }
        old_by_idx = {i: ol for i, ol in enumerate(old_lines)}

        # Check for SKU changes on lines with original_words to save an Alias
        for idx, pl in enumerate(payload.lines):
            words = pl.original_words
            if not words and idx in old_by_idx:
                words = old_by_idx[idx].original_words

            if words:
                words_clean = words.strip().lower()
                old_sku = old_words_sku.get(words_clean) or (
                    old_by_idx[idx].sku_code if idx in old_by_idx else None
                )
                if old_sku and old_sku != pl.sku_code:
                    # Desk changed the SKU: Save an Alias for this retailer (only if category compatible)
                    from backend.app.capture import RuleBasedParser
                    if RuleBasedParser().is_category_compatible(words_clean, pl.sku_code):
                        existing_alias = session.exec(
                            select(Alias).where(
                                Alias.retailer_id == order.retailer_id,
                                Alias.original_words == words_clean,
                            )
                        ).first()
                        if existing_alias:
                            existing_alias.sku_code = pl.sku_code
                            session.add(existing_alias)
                        else:
                            new_alias = Alias(
                                retailer_id=order.retailer_id,
                                original_words=words_clean,
                                sku_code=pl.sku_code,
                            )
                            session.add(new_alias)
                        session.commit()

        # Delete old lines and re-create updated lines
        for ol in old_lines:
            session.delete(ol)
        session.commit()

        quote = calculate_cart_quote(session, payload.lines)
        for idx, ql in enumerate(quote.lines):
            words = payload.lines[idx].original_words if idx < len(payload.lines) else None
            if not words and idx in old_by_idx:
                words = old_by_idx[idx].original_words
            ol = OrderLine(
                order_id=order.id,
                sku_code=ql.sku_code,
                qty_cases=ql.requested_cases,
                charged_cases=ql.charged_cases,
                free_cases=ql.free_cases,
                price_per_case=ql.case_price,
                discount_amount=ql.discount,
                line_total=ql.line_total,
                original_words=words,
                unit="case",
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

        # Approval re-checks stock including free cases and refuses if it would go negative
        if (
            target_status == OrderStatus.APPROVED
            and order.status != OrderStatus.APPROVED
        ):
            order_lines = session.exec(
                select(OrderLine).where(OrderLine.order_id == order.id)
            ).all()

            # Pre-check stock across all lines
            for ol in order_lines:
                sku = session.exec(
                    select(SKU).where(SKU.code == ol.sku_code)
                ).first()
                if sku:
                    needed = ol.charged_cases + ol.free_cases
                    if sku.stock_cases < needed:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail={
                                "error": "insufficient_stock",
                                "sku_code": sku.code,
                                "available": sku.stock_cases,
                                "needed": needed,
                                "message": f"Insufficient stock for {sku.code} (needs {needed}, available {sku.stock_cases})",
                            },
                        )

            # Deduct stock after verification
            for ol in order_lines:
                sku = session.exec(
                    select(SKU).where(SKU.code == ol.sku_code)
                ).first()
                if sku:
                    sku.stock_cases -= (ol.charged_cases + ol.free_cases)
                    session.add(sku)

            # Update retailer balance only if order was on credit_hold (not previously added to outstanding)
            if order.status == OrderStatus.CREDIT_HOLD:
                retailer.outstanding += order.total
                session.add(retailer)

            # Record approved_by and approved_at
            order.approved_by_user_id = current_user.id
            order.approved_at = datetime.now(timezone.utc)

        order.status = target_status

    if payload.override_flag:
        order.override_flag = True
    if payload.override_reason:
        order.override_reason = payload.override_reason.strip()

    # Increment version on every change
    order.version += 1
    session.add(order)
    session.commit()
    session.refresh(order)

    return get_desk_order_detail(
        order_id=order.id, current_user=current_user, session=session
    )


@app.get("/desk/export/tally")
def export_tally(
    format: str = Query("xml", description="Export format: xml or csv"),
    include_exported: bool = Query(False, description="Whether to include orders already exported"),
    from_date: Optional[date] = Query(None, description="Start date filter (inclusive)"),
    to_date: Optional[date] = Query(None, description="End date filter (inclusive)"),
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Exports approved orders in Tally XML or CSV format.

    Accessible to order_desk and owner only.
    """
    fmt = format.lower().strip()
    if fmt not in ("xml", "csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid format. Supported formats are 'xml' and 'csv'.",
        )

    query = select(Order).where(Order.status == OrderStatus.APPROVED)

    if not include_exported:
        query = query.where(Order.exported_at == None)

    if from_date:
        from_dt = datetime.combine(from_date, time.min).replace(tzinfo=timezone.utc)
        query = query.where(Order.created_at >= from_dt)

    if to_date:
        to_dt = datetime.combine(to_date, time.max).replace(tzinfo=timezone.utc)
        query = query.where(Order.created_at <= to_dt)

    orders = session.exec(query.order_by(Order.id.asc())).all()

    all_skus = {s.code: s for s in session.exec(select(SKU)).all()}
    all_retailers = {r.id: r for r in session.exec(select(Retailer)).all()}

    now = datetime.now(timezone.utc)

    if fmt == "xml":
        root = ET.Element("ENVELOPE")
        header = ET.SubElement(root, "HEADER")
        tally_req = ET.SubElement(header, "TALLYREQUEST")
        tally_req.text = "Import Data"

        body = ET.SubElement(root, "BODY")
        import_data = ET.SubElement(body, "IMPORTDATA")

        request_desc = ET.SubElement(import_data, "REQUESTDESC")
        report_name = ET.SubElement(request_desc, "REPORTNAME")
        report_name.text = "Vouchers"
        static_vars = ET.SubElement(request_desc, "STATICVARIABLES")
        sv_curr_company = ET.SubElement(static_vars, "SVCURRENTCOMPANY")
        sv_curr_company.text = "Company A"

        request_data = ET.SubElement(import_data, "REQUESTDATA")

        for order in orders:
            retailer = all_retailers.get(order.retailer_id)
            retailer_name = retailer.name if retailer else f"Retailer {order.retailer_id}"

            tally_msg = ET.SubElement(request_data, "TALLYMESSAGE")
            tally_msg.set("xmlns:UDF", "TallyUDF")

            voucher = ET.SubElement(tally_msg, "VOUCHER")
            voucher.set("VCHTYPE", "Sales Order")
            voucher.set("ACTION", "Create")

            date_elem = ET.SubElement(voucher, "DATE")
            date_elem.text = order.created_at.strftime("%Y%m%d")

            vtype_elem = ET.SubElement(voucher, "VOUCHERTYPENAME")
            vtype_elem.text = "Sales Order"

            vnum_elem = ET.SubElement(voucher, "VOUCHERNUMBER")
            vnum_elem.text = str(order.id)

            party_elem = ET.SubElement(voucher, "PARTYLEDGERNAME")
            party_elem.text = retailer_name

            source_val = order.source.value if hasattr(order.source, "value") else str(order.source)
            narr_elem = ET.SubElement(voucher, "NARRATION")
            narr_elem.text = f"Order #{order.id} source: {source_val}"

            vtotal_elem = ET.SubElement(voucher, "VOUCHERTOTAL")
            vtotal_elem.text = f"{order.total:.2f}"

            lines = session.exec(
                select(OrderLine).where(OrderLine.order_id == order.id).order_by(OrderLine.id.asc())
            ).all()

            for line in lines:
                sku = all_skus.get(line.sku_code)
                sku_name = sku.name if sku else line.sku_code

                # Charged inventory entry
                if line.charged_cases > 0:
                    inv = ET.SubElement(voucher, "ALLINVENTORYENTRIES.LIST")
                    sname = ET.SubElement(inv, "STOCKITEMNAME")
                    sname.text = sku_name

                    rate = ET.SubElement(inv, "RATE")
                    rate.text = f"{line.price_per_case:.2f}"

                    billed = ET.SubElement(inv, "BILLEDQTY")
                    billed.text = str(line.charged_cases)

                    actual = ET.SubElement(inv, "ACTUALQTY")
                    actual.text = str(line.charged_cases)

                    amount = ET.SubElement(inv, "AMOUNT")
                    amount.text = f"{line.line_total:.2f}"

                # Free goods separate inventory entry with rate 0 and amount 0
                if line.free_cases > 0:
                    free_inv = ET.SubElement(voucher, "ALLINVENTORYENTRIES.LIST")
                    fsname = ET.SubElement(free_inv, "STOCKITEMNAME")
                    fsname.text = sku_name

                    frate = ET.SubElement(free_inv, "RATE")
                    frate.text = "0.00"

                    fbilled = ET.SubElement(free_inv, "BILLEDQTY")
                    fbilled.text = "0"

                    factual = ET.SubElement(free_inv, "ACTUALQTY")
                    factual.text = str(line.free_cases)

                    famount = ET.SubElement(free_inv, "AMOUNT")
                    famount.text = "0.00"

        xml_raw = ET.tostring(root, encoding="utf-8").decode("utf-8")
        output_content = f"<!-- MOCK export, not validated against a real Tally. -->\n{xml_raw}"
    else:
        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow([
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
        ])

        for order in orders:
            retailer = all_retailers.get(order.retailer_id)
            retailer_name = retailer.name if retailer else f"Retailer {order.retailer_id}"
            order_date = order.created_at.strftime("%Y-%m-%d")
            source_val = order.source.value if hasattr(order.source, "value") else str(order.source)
            override_reason = order.override_reason or ""

            lines = session.exec(
                select(OrderLine).where(OrderLine.order_id == order.id).order_by(OrderLine.id.asc())
            ).all()

            for line in lines:
                sku = all_skus.get(line.sku_code)
                sku_name = sku.name if sku else line.sku_code
                gst_rate = f"{sku.gst_rate:.2f}" if sku else "0.00"

                writer.writerow([
                    order.id,
                    order_date,
                    retailer_name,
                    line.sku_code,
                    sku_name,
                    line.qty_cases,
                    line.free_cases,
                    f"{line.price_per_case:.2f}",
                    f"{line.discount_amount:.2f}",
                    f"{line.line_total:.2f}",
                    gst_rate,
                    f"{order.total:.2f}",
                    source_val,
                    override_reason,
                ])

        output_content = output.getvalue()

    # After a successful export, set exported_at
    for order in orders:
        order.exported_at = now
    session.commit()

    dated_filename = f"tally_orders_{now.strftime('%Y%m%d_%H%M%S')}.{fmt}"
    headers = {
        "Content-Disposition": f'attachment; filename="{dated_filename}"',
        "X-Tally-Export-Warning": "MOCK export, not validated against a real Tally.",
    }
    media_type = "application/xml" if fmt == "xml" else "text/csv"

    return Response(content=output_content, media_type=media_type, headers=headers)
