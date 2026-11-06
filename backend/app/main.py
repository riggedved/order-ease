"""FastAPI application entrypoint with authentication and role-based access control."""

from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.app.db import get_session, init_db
from backend.app.models import User, Retailer, Order, SKU, Role, OrderStatus
from backend.app.auth import (
    MOCK_OTP,
    create_access_token,
    get_current_user,
    require_role,
    check_retailer_access,
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
# Request / Response Schemas
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


class RetailerResponse(BaseModel):
    id: int
    name: str
    phone: str
    credit_limit: float
    outstanding: float
    salesman_id: Optional[int] = None


class OrderSummary(BaseModel):
    id: int
    retailer_id: int
    status: str
    source: str
    total: float
    created_at: str


# ---------------------------------------------------------
# Authentication Routes
# ---------------------------------------------------------
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
# Retailer Routes (Scoped with granular ownership checks)
# ---------------------------------------------------------
@app.get("/retailers/{retailer_id}", response_model=RetailerResponse)
def get_retailer(
    retailer_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Retrieves retailer profile and credit limits.

    Strictly enforced:
    - Retailer can only access their own store.
    - Salesman can only access assigned stores.
    - Desk & Owner can access all stores.
    """
    retailer = check_retailer_access(retailer_id, current_user, session)
    return RetailerResponse(
        id=retailer.id,
        name=retailer.name,
        phone=retailer.phone,
        credit_limit=float(retailer.credit_limit),
        outstanding=float(retailer.outstanding),
        salesman_id=retailer.salesman_id,
    )


@app.get("/retailers/{retailer_id}/orders", response_model=List[OrderSummary])
def get_retailer_orders(
    retailer_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Retrieves orders for a specific retailer with permission checks."""
    retailer = check_retailer_access(retailer_id, current_user, session)
    orders = session.exec(select(Order).where(Order.retailer_id == retailer.id)).all()
    return [
        OrderSummary(
            id=o.id,
            retailer_id=o.retailer_id,
            status=o.status.value,
            source=o.source.value,
            total=float(o.total),
            created_at=o.created_at.isoformat(),
        )
        for o in orders
    ]


# ---------------------------------------------------------
# Desk Endpoints (Protected: only order_desk and owner)
# ---------------------------------------------------------
@app.get("/desk/orders", response_model=List[OrderSummary])
def get_desk_orders(
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns all distributor orders across all retailers. Requires order_desk or owner role."""
    orders = session.exec(select(Order)).all()
    return [
        OrderSummary(
            id=o.id,
            retailer_id=o.retailer_id,
            status=o.status.value,
            source=o.source.value,
            total=float(o.total),
            created_at=o.created_at.isoformat(),
        )
        for o in orders
    ]


@app.get("/desk/retailers", response_model=List[RetailerResponse])
def get_desk_retailers(
    current_user: User = Depends(require_role([Role.ORDER_DESK, Role.OWNER])),
    session: Session = Depends(get_session),
):
    """Returns all retailers in the distributor system."""
    retailers = session.exec(select(Retailer)).all()
    return [
        RetailerResponse(
            id=r.id,
            name=r.name,
            phone=r.phone,
            credit_limit=float(r.credit_limit),
            outstanding=float(r.outstanding),
            salesman_id=r.salesman_id,
        )
        for r in retailers
    ]

