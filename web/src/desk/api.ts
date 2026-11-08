import type {
  DeskOrdersResponse,
  DeskOrderDetail,
  DeskCatalogueSKU,
  OrderPatchPayload,
} from './types';

export class DeskApiError extends Error {
  status: number;
  detail: any;
  isConflict: boolean;
  isInsufficientStock: boolean;
  insufficientStockInfo?: {
    sku_code: string;
    available: number;
    needed?: number;
    message?: string;
  };

  constructor(status: number, detail: any) {
    let msg = 'Request failed';
    if (typeof detail === 'string') {
      msg = detail;
    } else if (detail && typeof detail === 'object') {
      if (detail.message) {
        msg = detail.message;
      } else if (detail.error) {
        msg = detail.error;
      }
    }
    super(msg);
    this.name = 'DeskApiError';
    this.status = status;
    this.detail = detail;
    this.isConflict = status === 409;
    this.isInsufficientStock = Boolean(
      detail && typeof detail === 'object' && detail.error === 'insufficient_stock'
    );
    if (this.isInsufficientStock) {
      this.insufficientStockInfo = {
        sku_code: detail.sku_code,
        available: detail.available,
        needed: detail.needed,
        message: detail.message,
      };
    }
  }
}

export async function fetchDeskOrders(
  token: string,
  params: {
    q?: string;
    from_date?: string;
    to_date?: string;
    status?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }
): Promise<DeskOrdersResponse> {
  const query = new URLSearchParams();
  if (params.q) query.append('q', params.q);
  if (params.from_date) query.append('from_date', params.from_date);
  if (params.to_date) query.append('to_date', params.to_date);
  if (params.status && params.status !== 'all') query.append('status', params.status);
  if (params.sort) query.append('sort', params.sort);
  if (params.limit !== undefined) query.append('limit', String(params.limit));
  if (params.offset !== undefined) query.append('offset', String(params.offset));

  const url = `/desk/orders?${query.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }

  return res.json();
}

export async function fetchDeskOrderDetail(
  token: string,
  orderId: number
): Promise<DeskOrderDetail> {
  const res = await fetch(`/desk/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }

  return res.json();
}

export async function fetchDeskCatalogue(token: string): Promise<DeskCatalogueSKU[]> {
  const res = await fetch('/desk/catalogue', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }

  return res.json();
}

export async function patchDeskOrder(
  token: string,
  orderId: number,
  payload: OrderPatchPayload
): Promise<DeskOrderDetail> {
  const res = await fetch(`/desk/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }

  return res.json();
}

export interface SimpleRetailer {
  id: number;
  name: string;
  phone_number: string;
}

export async function fetchDeskRetailers(token: string, q?: string): Promise<SimpleRetailer[]> {
  const url = q ? `/retailers?q=${encodeURIComponent(q)}` : '/retailers';
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new DeskApiError(res.status, 'Failed to fetch retailers');
  }
  return res.json();
}

export async function captureDeskOrder(
  token: string,
  retailerId: number,
  text: string
): Promise<any> {
  const res = await fetch('/capture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      retailer_id: retailerId,
      text,
      source: 'desk_capture',
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }
  return res.json();
}

export async function postDeskOrder(
  token: string,
  retailerId: number,
  lines: Array<{ sku_code: string; qty_cases: number; original_words?: string | null }>
): Promise<any> {
  const res = await fetch('/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      retailer_id: retailerId,
      lines,
      source: 'desk_capture',
      client_request_id: `desk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new DeskApiError(res.status, errorData.detail || errorData);
  }
  return res.json();
}

