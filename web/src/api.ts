import type {
  TokenResponse,
  UserMe,
  CatalogueSKU,
  CartQuoteResponse,
  CartQuoteLineRequest,
  CaptureResponse,
  OrderCreatePayload,
  OrderResponse,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    let errorData = null;
    try {
      errorData = await response.json();
      if (errorData && errorData.detail) {
        errorDetail = typeof errorData.detail === 'string'
          ? errorData.detail
          : JSON.stringify(errorData.detail);
      }
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, errorDetail, errorData);
  }

  return response.json();
}

export async function loginWithOTP(phone: string, otp: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/otp', {
    method: 'POST',
    body: JSON.stringify({ phone, otp }),
  });
}

export async function fetchMe(token: string): Promise<UserMe> {
  return request<UserMe>('/me', {
    method: 'GET',
  }, token);
}

export async function fetchCatalogue(retailerId: number, token: string): Promise<CatalogueSKU[]> {
  return request<CatalogueSKU[]>(`/catalogue?retailer_id=${retailerId}`, {
    method: 'GET',
  }, token);
}

export async function fetchCartQuote(
  retailerId: number,
  lines: CartQuoteLineRequest[],
  token: string
): Promise<CartQuoteResponse> {
  return request<CartQuoteResponse>('/cart/quote', {
    method: 'POST',
    body: JSON.stringify({
      retailer_id: retailerId,
      lines,
    }),
  }, token);
}

export async function captureOrder(
  retailerId: number,
  text: string,
  token: string
): Promise<CaptureResponse> {
  return request<CaptureResponse>('/capture', {
    method: 'POST',
    body: JSON.stringify({
      retailer_id: retailerId,
      text,
    }),
  }, token);
}

export async function createOrder(
  payload: OrderCreatePayload,
  token: string
): Promise<OrderResponse> {
  return request<OrderResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}
