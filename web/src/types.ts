export interface CatalogueSKU {
  code: string;
  name: string;
  image_url: string | null;
  price_per_piece: string | number;
  case_price: string | number;
  units_per_case: number;
  price_includes_gst: boolean;
  gst_rate: string | number;
  scheme_label: string | null;
  stock_status: 'in_stock' | 'low' | 'out';
}

export interface CartQuoteLineRequest {
  sku_code: string;
  qty_cases: number;
}

export interface CartQuoteLineResponse {
  sku_code: string;
  name: string;
  requested_cases: number;
  charged_cases: number;
  free_cases: number;
  case_price: string | number;
  discount: string | number;
  line_total: string | number;
  gst_rate: string | number;
  gst_amount: string | number;
  price_includes_gst: boolean;
  nudges: string[];
  warnings: string[];
  is_blocked: boolean;
  is_capped: boolean;
}

export interface CartQuoteResponse {
  subtotal: string | number;
  gst_amount: string | number;
  payable: string | number;
  lines: CartQuoteLineResponse[];
}

export interface UserMe {
  id: number;
  name: string;
  user_name: string | null;
  role: string;
  retailer_id: number | null;
  retailer_name: string | null;
  phone?: string | null;
  salesman_name?: string | null;
  salesman_phone?: string | null;
  credit_low?: boolean | null;
  available_credit?: number | string | null;
  credit_limit?: number | string | null;
  outstanding?: number | string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  role: string;
  retailer_id: number | null;
  name: string;
  user_name: string;
  retailer_name: string | null;
}

// ---------------------------------------------------------
// Cart Item Model
// ---------------------------------------------------------
export interface CartItem {
  sku_code: string;
  qty_cases: number;
  original_words?: string | null;
  unit?: string | null;
}

// ---------------------------------------------------------
// Order Capture Types
// ---------------------------------------------------------
export interface ParsedLine {
  id?: string | number;
  original_words: string;
  sku_code: string | null;
  qty: number | null;
  unit: string; // 'case' | 'piece' | 'unknown'
  confidence: string; // 'high' | 'medium' | 'low'
  alternatives: string[];
  fixed_options?: string[]; // Presorted in ascending pack size once upon capture
  flags: string[]; // 'out_of_stock' | 'needs_unit' | 'no_match'
}

export interface CaptureResponse {
  retailer_id: number;
  raw_text: string;
  lines: ParsedLine[];
  preview_quote: CartQuoteResponse | null;
}

export interface OrderLineCreate {
  sku_code: string;
  qty_cases: number;
  original_words?: string | null;
  unit?: string | null;
}

export interface OrderCreatePayload {
  retailer_id: number;
  lines: OrderLineCreate[];
  source?: 'retailer_app' | 'retailer_capture';
  client_request_id?: string;
}

export interface OrderResponseLine {
  id?: number | null;
  sku_code: string;
  name?: string | null;
  qty_cases: number;
  charged_cases: number;
  free_cases: number;
  price_per_case: string | number;
  discount_amount: string | number;
  line_total: string | number;
  original_words?: string | null;
  unit?: string | null;
}

export interface OrderResponse {
  id: number;
  retailer_id: number;
  retailer_name: string;
  status: 'pending' | 'credit_hold' | 'approved' | 'cancelled';
  source: string;
  created_at?: string;
  total: string | number;
  client_request_id?: string | null;
  lines?: OrderResponseLine[];
}
