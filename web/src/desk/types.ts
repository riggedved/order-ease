export type OrderStatus = 'pending' | 'credit_hold' | 'approved' | 'cancelled';
export type OrderSource = 'retailer_app' | 'retailer_capture' | 'desk_capture' | 'salesman';

export interface DeskOrderSummary {
  id: number;
  retailer_id: number;
  retailer: string;
  total: string | number;
  status: OrderStatus;
  source: OrderSource;
  created_at: string;
  age: string;
}

export interface DeskOrdersCounts {
  all: number;
  pending: number;
  credit_hold: number;
  approved: number;
}

export interface DeskOrdersResponse {
  items: DeskOrderSummary[];
  total: number;
  counts: DeskOrdersCounts;
}

export interface DeskOrderLine {
  line_id: number;
  sku_code: string;
  sku_name: string;
  qty_cases: number;
  free_cases: number;
  line_total: string | number;
  original_words?: string | null;
  unit?: string | null;
  price_per_case?: string | number;
  discount_amount?: string | number;
}

export interface CreditPosition {
  credit_limit: string | number;
  outstanding: string | number;
  current_order_total: string | number;
  projected_outstanding: string | number;
  is_over_limit: boolean;
  available_credit: string | number;
}

export interface DeskOrderDetail {
  id: number;
  retailer_id: number;
  retailer_name: string;
  status: OrderStatus;
  source: OrderSource;
  created_at: string;
  total: string | number;
  placed_by: string;
  credit_position: CreditPosition;
  override_flag: boolean;
  override_reason?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  version: number;
  client_request_id?: string | null;
  exported_at?: string | null;
  lines: DeskOrderLine[];
}

export interface DeskCatalogueSKU {
  sku_code: string;
  name: string;
  case_price: string | number;
  units_per_case: number;
  price_includes_gst: boolean;
  stock_cases: number;
}

export interface OrderPatchLine {
  sku_code: string;
  qty_cases: number;
  original_words?: string | null;
}

export interface OrderPatchPayload {
  version: number;
  status?: OrderStatus;
  lines?: OrderPatchLine[];
  override_flag?: boolean;
  override_reason?: string;
}

