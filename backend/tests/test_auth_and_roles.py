"""Unit tests for authentication, JWT issuance, and role-based access control.

Required test cases:
1. retailer A requesting retailer B's data -> 403
2. retailer calling any /desk endpoint -> 403
3. salesman requesting an unassigned retailer -> 403
4. wrong OTP -> 401
"""

import pytest
from fastapi.testclient import TestClient

from backend.app.models import Role


def login_as(client: TestClient, phone: str, otp: str = "123456") -> str:
    """Helper to authenticate and retrieve access token."""
    response = client.post("/auth/otp", json={"phone": phone, "otp": otp})
    assert response.status_code == 200
    return response.json()["access_token"]


class TestAuthAndOTP:
    """Authentication and OTP verification tests."""

    def test_wrong_otp_returns_401(self, client: TestClient):
        """wrong OTP -> 401."""
        response = client.post("/auth/otp", json={"phone": "9826011111", "otp": "999999"})
        assert response.status_code == 401
        assert "Invalid OTP" in response.json()["detail"]

    def test_valid_otp_returns_jwt_with_user_id_and_role(self, client: TestClient):
        """Valid OTP 123456 returns JWT with user_id and role."""
        response = client.post("/auth/otp", json={"phone": "9826011111", "otp": "123456"})
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["role"] == Role.RETAILER.value
        assert data["retailer_id"] == 1
        assert data["user_id"] is not None
        assert data["user_name"] == "Ramesh Gupta"
        assert data["retailer_name"] == "Gupta Kirana Store"

    def test_login_seeded_retailer_returns_retailer_name(self, client: TestClient):
        """Logging in as a seeded retailer returns that retailer's name."""
        response = client.post("/auth/otp", json={"phone": "9826011111", "otp": "123456"})
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "retailer"
        assert data["user_name"] == "Ramesh Gupta"
        assert data["retailer_name"] == "Gupta Kirana Store"
        assert data["retailer_id"] == 1

    def test_login_desk_returns_retailer_name_null(self, client: TestClient):
        """A desk login returns retailer_name null."""
        response = client.post("/auth/otp", json={"phone": "9826000001", "otp": "123456"})
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "order_desk"
        assert data["user_name"] == "Desk Officer Priya"
        assert data["retailer_name"] is None
        assert data["retailer_id"] is None

    def test_get_me_returns_user_info_for_retailer_and_staff(self, client: TestClient):
        """GET /me returns user profile with phone, salesman details, and credit_low."""
        # 1. Retailer (Gupta: limit 100000, outstanding 25000 -> credit_low=False)
        ret_token = login_as(client, phone="9826011111")
        res_ret = client.get("/me", headers={"Authorization": f"Bearer {ret_token}"})
        assert res_ret.status_code == 200
        ret_data = res_ret.json()
        assert ret_data["name"] == "Ramesh Gupta"
        assert ret_data["role"] == "retailer"
        assert ret_data["retailer_id"] == 1
        assert ret_data["retailer_name"] == "Gupta Kirana Store"
        assert ret_data["phone"] == "9826011111"
        assert ret_data["salesman_name"] == "Salesman Rahul Verma"
        assert ret_data["salesman_phone"] == "9826000002"
        assert ret_data["credit_low"] is False
        assert ret_data["id"] is not None

        # 2. Desk user (staff: phone, salesman details, credit_low are null)
        desk_token = login_as(client, phone="9826000001")
        res_desk = client.get("/me", headers={"Authorization": f"Bearer {desk_token}"})
        assert res_desk.status_code == 200
        desk_data = res_desk.json()
        assert desk_data["name"] == "Desk Officer Priya"
        assert desk_data["role"] == "order_desk"
        assert desk_data["retailer_id"] is None
        assert desk_data["retailer_name"] is None
        assert desk_data["phone"] is None
        assert desk_data["salesman_name"] is None
        assert desk_data["salesman_phone"] is None
        assert desk_data["credit_low"] is None
        assert desk_data["id"] is not None

        # 3. Unauthenticated -> 401
        res_unauth = client.get("/me")
        assert res_unauth.status_code == 401

    def test_get_me_sharma_credit_low_true(self, client: TestClient):
        """Sharma (limit 80000, outstanding 76500) has credit_low true.

        available_credit = 80000 - 76500 = 3500.
        10% of 80000 is 8000.
        3500 < 8000 -> credit_low is True.
        """
        token = login_as(client, phone="9826022222")
        res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Suresh Sharma"
        assert data["phone"] == "9826022222"
        assert data["retailer_name"] == "Sharma Provision Store"
        assert data["salesman_name"] == "Salesman Rahul Verma"
        assert data["salesman_phone"] == "9826000002"
        assert data["credit_low"] is True

    def test_get_me_gupta_credit_low_false_and_salesman_matches_seed(self, client: TestClient):
        """Gupta (limit 100000, outstanding 25000) has credit_low false and salesman fields match seed.

        available_credit = 100000 - 25000 = 75000.
        10% of 100000 is 10000.
        75000 >= 10000 -> credit_low is False.
        """
        token = login_as(client, phone="9826011111")
        res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Ramesh Gupta"
        assert data["phone"] == "9826011111"
        assert data["retailer_name"] == "Gupta Kirana Store"
        assert data["salesman_name"] == "Salesman Rahul Verma"
        assert data["salesman_phone"] == "9826000002"
        assert data["credit_low"] is False

    def test_get_me_unassigned_salesman_returns_null(self, client: TestClient):
        """Retailer without assigned salesman returns salesman_name and salesman_phone as null."""
        # Verma General Stores (retailer 3, phone 9826033333, unassigned salesman)
        token = login_as(client, phone="9826033333")
        res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Anil Verma"
        assert data["phone"] == "9826033333"
        assert data["retailer_name"] == "Verma General Stores"
        assert data["salesman_name"] is None
        assert data["salesman_phone"] is None
        assert data["credit_low"] is False

    def test_get_me_staff_fields_are_null(self, client: TestClient):
        """For staff (order_desk, salesman, owner), phone, salesman details and credit_low are null."""
        # Desk Officer Priya
        token_desk = login_as(client, phone="9826000001")
        res_desk = client.get("/me", headers={"Authorization": f"Bearer {token_desk}"})
        assert res_desk.status_code == 200
        data_desk = res_desk.json()
        assert data_desk["phone"] is None
        assert data_desk["salesman_name"] is None
        assert data_desk["salesman_phone"] is None
        assert data_desk["credit_low"] is None

        # Salesman Rahul Verma
        token_salesman = login_as(client, phone="9826000002")
        res_salesman = client.get("/me", headers={"Authorization": f"Bearer {token_salesman}"})
        assert res_salesman.status_code == 200
        data_salesman = res_salesman.json()
        assert data_salesman["phone"] is None
        assert data_salesman["salesman_name"] is None
        assert data_salesman["salesman_phone"] is None
        assert data_salesman["credit_low"] is None

        # Owner Rajesh Agarwal
        token_owner = login_as(client, phone="9826000003")
        res_owner = client.get("/me", headers={"Authorization": f"Bearer {token_owner}"})
        assert res_owner.status_code == 200
        data_owner = res_owner.json()
        assert data_owner["phone"] is None
        assert data_owner["salesman_name"] is None
        assert data_owner["salesman_phone"] is None
        assert data_owner["credit_low"] is None

    def test_unregistered_phone_returns_401(self, client: TestClient):
        """Unregistered phone number with OTP 123456 returns 401."""
        response = client.post("/auth/otp", json={"phone": "9999999999", "otp": "123456"})
        assert response.status_code == 401

    def test_missing_credentials_returns_401(self, client: TestClient):
        """Accessing protected endpoint without token returns 401."""
        response = client.get("/retailers/1")
        assert response.status_code == 401


class TestRoleBasedAccessControl:
    """Role and store-level permission tests."""

    def test_retailer_a_requesting_retailer_b_data_returns_403(self, client: TestClient):
        """retailer A requesting retailer B's data -> 403.

        Retailer 1 (phone: 9826011111) requests data for Retailer 2 (/retailers/2).
        Must be forbidden with 403.
        """
        token_a = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token_a}"}

        # Requesting own store (Retailer 1) -> 200 OK
        own_res = client.get("/retailers/1", headers=headers)
        assert own_res.status_code == 200
        assert own_res.json()["id"] == 1

        # Requesting another store (Retailer 2) -> 403 Forbidden
        other_res = client.get("/retailers/2", headers=headers)
        assert other_res.status_code == 403
        assert "Forbidden" in other_res.json()["detail"]

    def test_retailer_calling_any_desk_endpoint_returns_403(self, client: TestClient):
        """retailer calling any /desk endpoint -> 403."""
        token_a = login_as(client, phone="9826011111")  # Retailer 1
        headers = {"Authorization": f"Bearer {token_a}"}

        # Calling /desk/orders
        orders_res = client.get("/desk/orders", headers=headers)
        assert orders_res.status_code == 403

        # Calling /desk/retailers
        retailers_res = client.get("/desk/retailers", headers=headers)
        assert retailers_res.status_code == 403

    def test_salesman_requesting_unassigned_retailer_returns_403(self, client: TestClient):
        """salesman requesting an unassigned retailer -> 403.

        Salesman Rahul (phone: 9826000002) is assigned to Retailer 1 and Retailer 2,
        but NOT to Retailer 3 or Retailer 4.
        """
        salesman_token = login_as(client, phone="9826000002")  # Salesman
        headers = {"Authorization": f"Bearer {salesman_token}"}

        # Assigned store (Retailer 1) -> 200 OK
        assigned_res = client.get("/retailers/1", headers=headers)
        assert assigned_res.status_code == 200
        assert assigned_res.json()["id"] == 1

        # Assigned store (Retailer 2) -> 200 OK
        assigned_res2 = client.get("/retailers/2", headers=headers)
        assert assigned_res2.status_code == 200
        assert assigned_res2.json()["id"] == 2

        # Unassigned store (Retailer 3) -> 403 Forbidden
        unassigned_res3 = client.get("/retailers/3", headers=headers)
        assert unassigned_res3.status_code == 403
        assert "Forbidden" in unassigned_res3.json()["detail"]

        # Unassigned store (Retailer 4) -> 403 Forbidden
        unassigned_res4 = client.get("/retailers/4", headers=headers)
        assert unassigned_res4.status_code == 403
        assert "Forbidden" in unassigned_res4.json()["detail"]

    def test_order_desk_and_owner_access(self, client: TestClient):
        """order_desk and owner can access /desk and any retailer."""
        desk_token = login_as(client, phone="9826000001")  # Order Desk
        desk_headers = {"Authorization": f"Bearer {desk_token}"}

        # Desk can access /desk/orders
        desk_orders = client.get("/desk/orders", headers=desk_headers)
        assert desk_orders.status_code == 200
        assert len(desk_orders.json()) >= 2

        # Desk can access any retailer
        desk_ret3 = client.get("/retailers/3", headers=desk_headers)
        assert desk_ret3.status_code == 200

        # Owner can access /desk/orders and any retailer
        owner_token = login_as(client, phone="9826000003")  # Owner
        owner_headers = {"Authorization": f"Bearer {owner_token}"}

        owner_orders = client.get("/desk/orders", headers=owner_headers)
        assert owner_orders.status_code == 200

        owner_ret4 = client.get("/retailers/4", headers=owner_headers)
        assert owner_ret4.status_code == 200


class TestSeededDataAndTempDatabase:
    """Verifies that seeded data uses generic names, SKU-TE-250, and temp database."""

    def test_generic_sku_names_and_code(self, session):
        """Verifies SKU-TE-250 and generic product naming in database."""
        from sqlmodel import select
        from backend.app.models import SKU, Alias

        skus = {s.code: s for s in session.exec(select(SKU)).all()}
        assert "SKU-TE-250" in skus
        assert "SKU-TEA-250" not in skus

        # Check required generic names
        assert skus["SKU-BS-075"].name == "Glucose biscuit 75 g, case of 96"
        assert skus["SKU-DT-1KG"].name == "Detergent powder 1 kg, case of 20"
        assert skus["SKU-TE-250"].name == "Tea leaf 250 g, case of 40"

        # Check decoy generic names
        assert skus["SKU-BS-150"].name == "Glucose biscuit 150 g, case of 48"
        assert skus["SKU-DT-500"].name == "Detergent powder 500 g, case of 40"
        assert skus["SKU-TE-100"].name == "Tea leaf 100 g, case of 80"

        # Check aliases
        aliases = session.exec(select(Alias)).all()
        alias_skus = {a.sku_code for a in aliases}
        assert "SKU-TE-250" in alias_skus
        alias_texts = {a.original_words for a in aliases}
        assert "glucose biscuit chota" in alias_texts
        assert "detergent powder 1kg" in alias_texts
        assert "tea leaf 250g" in alias_texts


