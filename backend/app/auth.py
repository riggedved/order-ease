"""Authentication and authorization utilities using JWT and role-based access control."""

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Union
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlmodel import Session, select

from backend.app.db import get_session
from backend.app.models import User, Retailer, Role

SECRET_KEY = "company-a-jabalpur-secure-key-32bytes-secret-token"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
MOCK_OTP = "123456"

security = HTTPBearer(auto_error=False)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    session: Session = Depends(get_session),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject identifier",
        )
    user = session.get(User, int(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


def require_role(allowed_roles: Union[List[Role], Role]):
    """FastAPI dependency to enforce that the authenticated user possesses an allowed role."""
    if isinstance(allowed_roles, Role):
        roles_list = [allowed_roles]
    else:
        roles_list = list(allowed_roles)

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles_list:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: role '{current_user.role.value}' does not have permission",
            )
        return current_user

    return role_checker


def check_retailer_access(
    retailer_id: int,
    current_user: User,
    session: Session,
) -> Retailer:
    """Verifies that the current user has authorization to access retailer data.

    Rules:
    - Retailer user: Can only access their own retailer_id.
    - Salesman: Can only access retailers assigned to them (retailer.salesman_id == user.id).
    - Order Desk & Owner: Can access any retailer.
    """
    retailer = session.get(Retailer, retailer_id)
    if not retailer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Retailer not found",
        )

    # Retailer can only access their own store
    if current_user.role == Role.RETAILER:
        if current_user.retailer_id != retailer_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Retailer can only access their own store data",
            )
        return retailer

    # Salesman can only access assigned stores
    if current_user.role == Role.SALESMAN:
        if retailer.salesman_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Salesman is not assigned to this retailer",
            )
        return retailer

    # Order Desk and Owner have unrestricted access to all retailers
    if current_user.role in (Role.ORDER_DESK, Role.OWNER):
        return retailer

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Forbidden: Unauthorized access",
    )
