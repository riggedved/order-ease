import React, { useState, useRef, useMemo } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { CartQuoteResponse, CatalogueSKU, CartItem, OrderResponse } from '../types';
import { createOrder, ApiError } from '../api';
import {
  formatINR,
  cleanProductName,
  toSentenceCase,
  formatCases,
} from '../utils';
import { ProductImage } from './ProductImage';

interface CartViewProps {
  lang: Language;
  quote: CartQuoteResponse | null;
  quoteLoading: boolean;
  catalogue: CatalogueSKU[];
  cartItems: Record<string, CartItem>;
  onUpdateQty: (skuCode: string, qty: number) => void;
  onClearCart: () => void;
  onBackToCatalogue: () => void;
  cartMessageNote?: string | null;
  onDismissMessageNote?: () => void;
  retailerId: number;
  token: string;
}

export const CartView: React.FC<CartViewProps> = ({
  lang,
  quote,
  quoteLoading,
  catalogue,
  cartItems,
  onUpdateQty,
  onClearCart,
  onBackToCatalogue,
  cartMessageNote,
  onDismissMessageNote,
  retailerId,
  token,
}) => {
  const t = translations[lang];

  // Order Placement State (Only place POST /orders is called)
  const [orderPlacing, setOrderPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<OrderResponse | null>(null);
  const clientRequestIdRef = useRef<string | null>(null);

  // Helper to find SKU info from catalogue for piece breakdown
  const getSkuInfo = (skuCode: string) => {
    return catalogue.find((s) => s.code === skuCode);
  };

  const lines = quote?.lines || [];
  // Active lines that have requested_cases > 0
  const activeLines = lines.filter((l) => l.requested_cases > 0);
  const totalItemCount = activeLines.length;

  const totalCases = useMemo(() => {
    return activeLines.reduce((acc, l) => acc + (l.requested_cases || 0), 0);
  }, [activeLines]);

  const handlePlaceOrder = async () => {
    if (orderPlacing || totalCases === 0 || quoteLoading) return;
    setOrderError(null);

    // Generate client_request_id once per attempt and reuse it on retries
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }

    const items = Object.values(cartItems).filter((i) => i.qty_cases > 0);
    if (items.length === 0) return;

    // Order source: if any cart line has original_words, send retailer_capture, otherwise retailer_app
    const hasCaptureLine = items.some((i) => !!i.original_words);
    const source = hasCaptureLine ? 'retailer_capture' : 'retailer_app';

    const payloadLines = items.map((i) => ({
      sku_code: i.sku_code,
      qty_cases: i.qty_cases,
      original_words: i.original_words || null,
      unit: i.unit || 'case',
    }));

    setOrderPlacing(true);
    try {
      const order = await createOrder(
        {
          retailer_id: retailerId,
          lines: payloadLines,
          source,
          client_request_id: clientRequestIdRef.current,
        },
        token
      );
      clientRequestIdRef.current = null;
      onClearCart();
      setOrderSuccess(order);
    } catch (err: any) {
      // Re-use clientRequestIdRef.current on retry so idempotency is maintained
      if (err instanceof ApiError) {
        setOrderError(err.message);
      } else {
        setOrderError(err.message || 'Could not place order. Please try again.');
      }
    } finally {
      setOrderPlacing(false);
    }
  };

  if (activeLines.length === 0 && !orderSuccess) {
    return (
      <div className="flex flex-col flex-1 px-4 pt-6 pb-8 bg-surface">
        {/* Back Button */}
        <div className="flex items-center pb-4 border-b border-border mb-6">
          <button
            type="button"
            onClick={onBackToCatalogue}
            className="min-tap -ml-2 px-2 flex items-center text-sm font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
            aria-label={t.back_to_catalogue}
          >
            <svg
              className="w-5 h-5 mr-1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>{t.back_to_catalogue}</span>
          </button>
        </div>

        {/* Empty State */}
        <div className="flex flex-col items-center justify-center flex-1 py-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-border flex items-center justify-center text-ink-muted mb-4">
            <svg
              className="w-8 h-8 text-ink-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          </div>
          <h2 className="text-base font-bold text-ink mb-1">
            {t.empty_cart_title}
          </h2>
          <p className="text-xs text-ink-muted max-w-xs mb-6">
            {t.empty_cart_subtitle}
          </p>
          <button
            type="button"
            onClick={onBackToCatalogue}
            className="min-tap px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary-dark transition-colors"
          >
            {t.back_to_catalogue}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-4 pt-6 pb-36 bg-surface">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
        <button
          type="button"
          onClick={onBackToCatalogue}
          className="min-tap -ml-2 px-2 flex items-center text-sm font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
        >
          <svg
            className="w-5 h-5 mr-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>{t.back_to_catalogue}</span>
        </button>

        <span className="text-xs font-semibold text-ink-muted">
          {totalItemCount} {totalItemCount === 1 ? t.item : t.items}
        </span>
      </div>

      {/* Screen Title (with guaranteed top clearance from sticky header) */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">
          {t.cart} ({totalItemCount} {totalItemCount === 1 ? t.item : t.items})
        </h1>
        {quoteLoading && (
          <span className="text-xs text-primary font-medium flex items-center gap-1">
            <svg
              className="animate-spin h-3.5 w-3.5 text-primary"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            <span>Updating...</span>
          </span>
        )}
      </div>

      {/* Message Note: e.g. "2 items added from your message" */}
      {cartMessageNote && (
        <div className="mb-4 p-3 rounded-xl bg-primary-50 border border-primary/20 text-xs font-semibold text-primary flex items-center justify-between gap-2 select-none">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-primary shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span>{cartMessageNote}</span>
          </div>
          {onDismissMessageNote && (
            <button
              type="button"
              onClick={onDismissMessageNote}
              className="text-primary hover:text-primary-dark font-bold text-base leading-none p-1"
              aria-label="Dismiss note"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Inline Order Error (with Retry) */}
      {orderError && (
        <div
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-xs"
          role="alert"
        >
          <svg
            className="w-4 h-4 shrink-0 mt-0.5 text-red-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="flex-1">
            <span>{orderError}</span>
          </div>
          <button
            type="button"
            onClick={handlePlaceOrder}
            className="min-tap text-xs font-bold text-red-700 underline shrink-0"
          >
            {t.retry}
          </button>
        </div>
      )}

      {/* Cart Lines List */}
      <div className="space-y-3 mb-6">
        {activeLines.map((line) => {
          const sku = getSkuInfo(line.sku_code);
          const isBlocked = line.is_blocked;

          return (
            <div
              key={line.sku_code}
              className={`p-3.5 rounded-xl border border-border bg-white flex flex-col space-y-2.5 ${
                isBlocked ? 'opacity-85' : ''
              }`}
            >
              {/* Line Header: ProductImage Thumbnail, Product Name & Breakdown */}
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div className="w-12 h-12 rounded-lg bg-gray-50 border border-border shrink-0 p-1 flex items-center justify-center">
                    <ProductImage skuCode={line.sku_code} alt={cleanProductName(line.name)} />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-ink leading-tight">
                      {cleanProductName(line.name)}
                    </h2>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {formatINR(line.case_price)} / {t.per_case}{' '}
                      {sku && (
                        <span>
                          ({formatINR(sku.price_per_piece)} × {sku.units_per_case} ·{' '}
                          {sku.price_includes_gst ? t.incl_gst : t.excl_gst})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Total */}
                <div className="text-right shrink-0">
                  <span
                    className={`text-base font-bold ${
                      isBlocked ? 'text-ink-muted line-through' : 'text-ink'
                    }`}
                  >
                    {formatINR(line.line_total)}
                  </span>
                </div>
              </div>

              {/* Stepper Control (48px tall: h-12) */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center border border-border rounded-xl h-12 bg-surface">
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.sku_code, Math.max(0, line.requested_cases - 1))}
                    className="w-12 h-12 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-100 active:bg-gray-200 rounded-l-xl transition-colors select-none focus:outline-none"
                    aria-label={`Decrease ${line.name}`}
                  >
                    −
                  </button>
                  <span className="px-3 min-w-[70px] text-center text-sm font-bold text-ink select-none">
                    {formatCases(line.requested_cases, lang)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.sku_code, line.requested_cases + 1)}
                    disabled={isBlocked}
                    className="w-12 h-12 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-100 active:bg-gray-200 rounded-r-xl transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
                    aria-label={`Increase ${line.name}`}
                  >
                    +
                  </button>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => onUpdateQty(line.sku_code, 0)}
                  className="min-tap text-xs text-ink-muted hover:text-error underline py-1 px-2 font-medium"
                >
                  {t.remove}
                </button>
              </div>

              {/* Free Goods Badge */}
              {line.free_cases > 0 && (
                <div className="flex items-center gap-1.5 text-primary text-xs font-semibold pt-1">
                  <svg
                    className="w-4 h-4 text-primary shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>
                    +{line.free_cases}{' '}
                    {line.free_cases === 1
                      ? t.free_cases_badge
                      : t.free_cases_plural_badge}
                  </span>
                </div>
              )}

              {/* Discount Applied Badge */}
              {parseFloat(line.discount?.toString() || '0') > 0 && (
                <div className="flex items-center gap-1.5 text-primary text-xs font-semibold pt-1">
                  <svg
                    className="w-4 h-4 text-primary shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    />
                  </svg>
                  <span>
                    {formatINR(line.discount)} {t.discount_applied}
                  </span>
                </div>
              )}

              {/* Nudges from server quote: one line of green text in sentence case, no box */}
              {line.nudges && line.nudges.length > 0 && (
                <div className="pt-1">
                  {Array.from(new Set(line.nudges)).slice(0, 1).map((nudge, idx) => (
                    <div
                      key={idx}
                      className="text-xs text-primary font-medium flex items-center gap-1.5"
                    >
                      <svg
                        className="w-3.5 h-3.5 text-primary shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{toSentenceCase(nudge)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings from server quote (e.g. out of stock or capped) */}
              {line.warnings && line.warnings.length > 0 && (
                <div className="space-y-1 pt-1">
                  {line.warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 p-2 rounded-lg bg-error-bg/30 border border-error/30 text-xs font-medium text-error"
                    >
                      <svg
                        className="w-3.5 h-3.5 text-error shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bill Summary Card: Subtotal, GST, Total (incl. GST) */}
      <div className="p-4 bg-white border border-border rounded-xl space-y-3 mb-4">
        {/* Subtotal */}
        <div className="flex justify-between items-center text-sm text-ink-muted">
          <span>{lang === 'hi' ? 'उप-कुल (सबटोटल)' : 'Subtotal'}</span>
          <span className="font-semibold text-ink">
            {formatINR(quote?.subtotal)}
          </span>
        </div>

        {/* GST */}
        <div className="flex justify-between items-center text-sm text-ink-muted">
          <span>{lang === 'hi' ? 'जीएसटी' : 'GST'}</span>
          <span className="font-semibold text-ink">
            {formatINR(quote?.gst_amount)}
          </span>
        </div>

        {/* Divider */}
        <div className="h-px bg-border my-1" />

        {/* Total (incl. GST) */}
        <div className="flex justify-between items-baseline pt-1">
          <span className="text-base font-bold text-ink">
            {t.total_incl_gst}
          </span>
          <span className="text-xl font-bold text-primary">
            {formatINR(quote?.payable)}
          </span>
        </div>
      </div>

      {/* Fixed Bottom Bar: safe-area aware, green, like catalogue cart bar */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[420px] bg-primary text-white p-3 z-40 border-t border-primary-dark flex items-center justify-between select-none pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-green-100 font-medium">
            {formatCases(totalCases, lang)}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold">
              {formatINR(quote?.payable)}
            </span>
            <span className="text-[11px] font-normal text-green-100">
              {lang === 'hi' ? 'जीएसटी सहित' : 'incl. GST'}
            </span>
          </div>
        </div>

        {/* White "Place order →" button matching "View cart" button standard size */}
        <button
          type="button"
          disabled={orderPlacing || totalCases === 0 || quoteLoading}
          onClick={handlePlaceOrder}
          className="min-tap px-4 py-2 rounded-xl bg-white text-primary font-bold text-sm flex items-center space-x-1.5 focus:outline-none hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none shrink-0"
        >
          {orderPlacing ? (
            <>
              <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>{t.placing_order}</span>
            </>
          ) : (
            <>
              <span>{t.place_order_btn}</span>
              <span>→</span>
            </>
          )}
        </button>
      </div>

      {/* Order Success Modal */}
      {orderSuccess && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-border rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="w-14 h-14 rounded-full bg-primary-50 border border-primary/20 flex items-center justify-center text-primary mx-auto">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div className="text-center">
              <h2 className="text-lg font-bold text-ink">
                {orderSuccess.status === 'credit_hold'
                  ? t.order_credit_hold_title
                  : t.order_success_title}
              </h2>
              {orderSuccess.status === 'credit_hold' ? (
                <p className="text-xs text-amber-700 mt-1">
                  {lang === 'hi'
                    ? 'आपका क्रेडिट लिमिट पार हो गया है। वितरक से संपर्क करें।'
                    : 'Credit limit reached. Distributor approval required.'}
                </p>
              ) : (
                <p className="text-xs text-ink-muted mt-1">
                  {lang === 'hi'
                    ? 'आपका ऑर्डर दर्ज कर लिया गया है।'
                    : 'Your order has been recorded successfully.'}
                </p>
              )}
            </div>

            <div className="bg-surface border border-border rounded-xl p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.order_id_label}</span>
                <span className="font-bold text-ink">#{orderSuccess.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.order_status_label}</span>
                <span className="font-bold capitalize text-primary">
                  {orderSuccess.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.order_total_label}</span>
                <span className="font-bold text-ink">
                  {formatINR(orderSuccess.total)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setOrderSuccess(null);
                onBackToCatalogue();
              }}
              className="min-tap w-full h-12 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-dark transition-colors"
            >
              {t.return_to_catalogue}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
