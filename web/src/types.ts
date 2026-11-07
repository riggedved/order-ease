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

