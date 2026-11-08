export type DeskLanguage = 'en' | 'hi';

export interface DeskTranslations {
  company_name: string;
  order_desk: string;
  nav_orders: string;
  nav_capture: string;
  nav_export: string;
  logout: string;
  search_retailer_placeholder: string;
  from_date: string;
  to_date: string;
  tab_all: string;
  tab_pending: string;
  tab_credit_hold: string;
  tab_approved: string;
  col_retailer: string;
  col_total: string;
  col_status: string;
  col_source: string;
  col_age: string;
  source_app: string;
  source_message: string;
  source_desk: string;
  source_salesman: string;
  status_pending: string;
  status_credit_hold: string;
  status_approved: string;
  status_cancelled: string;
  keyboard_shortcuts: string;
  pagination_summary: string;
  btn_previous: string;
  btn_next: string;
  empty_orders_title: string;
  empty_orders_desc: string;
  loading_orders: string;
  loading_details: string;
  error_orders: string;
  error_details: string;
  btn_retry: string;
  no_order_selected: string;
  order_number: string;
  order_items: string;
  col_product: string;
  col_cases: string;
  col_free: string;
  col_stock: string;
  col_line_total: string;
  stock_short: string;
  saves_as_alias: string;
  subtotal: string;
  gst: string;
  total: string;
  credit_position: string;
  credit_limit: string;
  credit_outstanding: string;
  credit_this_order: string;
  credit_projected: string;
  over_limit_by: string;
  within_limit: string;
  override_reason_label: string;
  override_placeholder: string;
  btn_save_edits: string;
  btn_approve: string;
  btn_approve_override: string;
  saving: string;
  approving: string;
  conflict_error: string;
  btn_reload: string;
  approved_by_info: string;
  override_reason_note: string;
  title_capture: string;
  select_retailer: string;
  capture_input_placeholder: string;
  btn_parse: string;
  btn_confirm_order: string;
  col_confidence: string;
  capture_empty: string;
  parsing: string;
  confirming: string;
  title_export: string;
  export_format: string;
  include_exported: string;
  btn_download: string;
  no_export_orders: string;
  export_summary: string;
  order_confirmed_msg: string;
}

export const deskTranslations: Record<DeskLanguage, DeskTranslations> = {
  en: {
    company_name: 'Company A',
    order_desk: 'Order desk',
    nav_orders: 'Orders',
    nav_capture: 'Capture',
    nav_export: 'Export',
    logout: 'Logout',
    search_retailer_placeholder: 'Search retailer',
    from_date: 'From',
    to_date: 'To',
    tab_all: 'All',
    tab_pending: 'Pending',
    tab_credit_hold: 'Credit hold',
    tab_approved: 'Approved',
    col_retailer: 'Retailer',
    col_total: 'Total',
    col_status: 'Status',
    col_source: 'Source',
    col_age: 'Age',
    source_app: 'App',
    source_message: 'Message',
    source_desk: 'Desk',
    source_salesman: 'Salesman',
    status_pending: 'Pending',
    status_credit_hold: 'Credit hold',
    status_approved: 'Approved',
    status_cancelled: 'Cancelled',
    keyboard_shortcuts: '↑↓ navigate  ·  Enter open  ·  A approve  ·  O override',
    pagination_summary: '{from}–{to} of {total}',
    btn_previous: 'Previous',
    btn_next: 'Next',
    empty_orders_title: 'No orders found',
    empty_orders_desc: 'Try adjusting your search or date filter',
    loading_orders: 'Loading orders...',
    loading_details: 'Loading order details...',
    error_orders: 'Failed to load orders',
    error_details: 'Failed to load order details',
    btn_retry: 'Retry',
    no_order_selected: 'Select an order from the list to view and manage details.',
    order_number: 'Order #{id}',
    order_items: 'Order Items',
    col_product: 'Product',
    col_cases: 'Cases',
    col_free: 'Free',
    col_stock: 'Stock',
    col_line_total: 'Line total',
    stock_short: 'short',
    saves_as_alias: 'Saves as alias for this retailer',
    subtotal: 'Subtotal',
    gst: 'GST',
    total: 'Total',
    credit_position: 'Credit position',
    credit_limit: 'Limit',
    credit_outstanding: 'Outstanding',
    credit_this_order: 'This order',
    credit_projected: 'Projected',
    over_limit_by: 'Over limit by {amount}',
    within_limit: 'Within limit ({amount} available)',
    override_reason_label: 'Override reason (required)',
    override_placeholder: 'Override reason (required for credit hold)',
    btn_save_edits: 'Save edits',
    btn_approve: 'Approve',
    btn_approve_override: 'Override & approve',
    saving: 'Saving...',
    approving: 'Approving...',
    conflict_error: 'This order was changed by someone else. Reload it.',
    btn_reload: 'Reload',
    approved_by_info: 'Approved by {name}, {time}',
    override_reason_note: 'Override note: {reason}',
    title_capture: 'Vernacular AI Order Capture',
    select_retailer: 'Select retailer',
    capture_input_placeholder: 'Type or paste order message (e.g. 5 biscuit, 2 oil...)',
    btn_parse: 'Parse',
    btn_confirm_order: 'Confirm order',
    col_confidence: 'Confidence',
    capture_empty: 'Enter an order message and click Parse to review lines',
    parsing: 'Parsing...',
    confirming: 'Confirming...',
    title_export: 'Tally Export',
    export_format: 'Format',
    include_exported: 'Include exported',
    btn_download: 'Download',
    no_export_orders: 'No approved orders found to export',
    export_summary: '{count} orders ready for Tally export',
    order_confirmed_msg: 'Order #{id} created successfully',
  },
  hi: {
    company_name: 'Company A',
    order_desk: 'ऑर्डर डेस्क',
    nav_orders: 'ऑर्डर्स',
    nav_capture: 'कैप्चर',
    nav_export: 'एक्सपोर्ट',
    logout: 'लॉगआउट',
    search_retailer_placeholder: 'किराना खोजें',
    from_date: 'से',
    to_date: 'तक',
    tab_all: 'सभी',
    tab_pending: 'लंबित',
    tab_credit_hold: 'क्रेडिट होल्ड',
    tab_approved: 'स्वीकृत',
    col_retailer: 'किराना',
    col_total: 'कुल',
    col_status: 'स्थिति',
    col_source: 'स्रोत',
    col_age: 'समय',
    source_app: 'ऐप',
    source_message: 'मैसेज',
    source_desk: 'डेस्क',
    source_salesman: 'सेल्समैन',
    status_pending: 'लंबित',
    status_credit_hold: 'क्रेडिट होल्ड',
    status_approved: 'स्वीकृत',
    status_cancelled: 'रद्द',
    keyboard_shortcuts: '↑↓ नेविगेट करें  ·  Enter खोलें  ·  A स्वीकृत करें  ·  O ओवरराइड',
    pagination_summary: '{total} में से {from}–{to}',
    btn_previous: 'पिछला',
    btn_next: 'अगला',
    empty_orders_title: 'कोई ऑर्डर नहीं मिला',
    empty_orders_desc: 'अपनी खोज या दिनांक फ़िल्टर बदलें',
    loading_orders: 'ऑर्डर लोड हो रहे हैं...',
    loading_details: 'ऑर्डर विवरण लोड हो रहा है...',
    error_orders: 'ऑर्डर लोड करने में विफल',
    error_details: 'ऑर्डर विवरण लोड करने में विफल',
    btn_retry: 'पुनः प्रयास करें',
    no_order_selected: 'विवरण देखने और प्रबंधित करने के लिए सूची से एक ऑर्डर चुनें।',
    order_number: 'ऑर्डर #{id}',
    order_items: 'ऑर्डर उत्पाद',
    col_product: 'उत्पाद',
    col_cases: 'पेटियां',
    col_free: 'मुफ़्त',
    col_stock: 'स्टॉक',
    col_line_total: 'कुल मूल्य',
    stock_short: 'कम',
    saves_as_alias: 'इस किराना के लिए उपनाम के रूप में सहेजता है',
    subtotal: 'उप-कुल',
    gst: 'जीएसटी',
    total: 'कुल',
    credit_position: 'क्रेडिट स्थिति',
    credit_limit: 'सीमा',
    credit_outstanding: 'बकाया',
    credit_this_order: 'यह ऑर्डर',
    credit_projected: 'अनुमानित',
    over_limit_by: 'सीमा से {amount} अधिक',
    within_limit: 'सीमा के भीतर ({amount} उपलब्ध)',
    override_reason_label: 'ओवरराइड कारण (आवश्यक)',
    override_placeholder: 'ओवरराइड कारण (क्रेडिट होल्ड के लिए आवश्यक)',
    btn_save_edits: 'बदलाव सेव करें',
    btn_approve: 'स्वीकृत करें',
    btn_approve_override: 'ओवरराइड और स्वीकृत',
    saving: 'सहेज रहे हैं...',
    approving: 'स्वीकृत कर रहे हैं...',
    conflict_error: 'यह ऑर्डर किसी और द्वारा बदल दिया गया था। इसे पुनः लोड करें।',
    btn_reload: 'पुनः लोड करें',
    approved_by_info: '{name} द्वारा स्वीकृत, {time}',
    override_reason_note: 'ओवरराइड नोट: {reason}',
    title_capture: 'AI ऑर्डर कैप्चर',
    select_retailer: 'किराना चुनें',
    capture_input_placeholder: 'ऑर्डर संदेश दर्ज करें (उदा. 5 बिस्किट, 2 तेल...)',
    btn_parse: 'पार्स करें',
    btn_confirm_order: 'ऑर्डर पुष्टि करें',
    col_confidence: 'सटीकता',
    capture_empty: 'पंक्तियों की समीक्षा के लिए संदेश दर्ज करें और पार्स पर क्लिक करें',
    parsing: 'पार्स कर रहे हैं...',
    confirming: 'पुष्टि कर रहे हैं...',
    title_export: 'टैली एक्सपोर्ट',
    export_format: 'प्रारूप',
    include_exported: 'पहले से एक्सपोर्ट किए गए शामिल करें',
    btn_download: 'डाउनलोड करें',
    no_export_orders: 'एक्सपोर्ट के लिए कोई स्वीकृत ऑर्डर नहीं मिला',
    export_summary: 'टैली एक्सपोर्ट के लिए {count} ऑर्डर तैयार हैं',
    order_confirmed_msg: 'ऑर्डर #{id} सफलतापूर्वक बनाया गया',
  },
};

