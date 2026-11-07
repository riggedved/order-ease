import React from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { CartQuoteResponse, CatalogueSKU } from '../types';
import { formatINR } from '../utils';

interface CartViewProps {
  lang: Language;
  quote: CartQuoteResponse | null;
  quoteLoading: boolean;
  catalogue: CatalogueSKU[];
  onUpdateQty: (skuCode: string, qty: number) => void;
  onBackToCatalogue: () => void;
}

export const CartView: React.FC<CartViewProps> = ({
  lang,
  quote,
  quoteLoading,
  catalogue,
  onUpdateQty,
  onBackToCatalogue,
}) => {
  const t = translations[lang];

  // Helper to find SKU info from catalogue for piece breakdown
  const getSkuInfo = (skuCode: string) => {
    return catalogue.find((s) => s.code === skuCode);
  };

  const lines = quote?.lines || [];
  // Filter lines that have requested_cases > 0 or are present in quote
  const activeLines = lines.filter((l) => l.requested_cases > 0);
  const totalItemCount = activeLines.length;

  if (activeLines.length === 0) {
    return (
      <div className="flex flex-col flex-1 px-4 py-8 bg-surface">
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
    <div className="flex flex-col flex-1 px-4 py-4 pb-24 bg-surface">
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

      {/* Screen Title */}
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
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              ></path>
            </svg>
            <span>Updating...</span>
          </span>
        )}
      </div>

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
              {/* Line Header: Product Name & Breakdown */}
              <div className="flex justify-between items-start gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-ink leading-tight">
                    {line.name}
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

              {/* Stepper Control */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center border border-border rounded-xl h-11 bg-surface">
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.sku_code, Math.max(0, line.requested_cases - 1))}
                    className="min-tap w-11 h-11 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-50 rounded-l-xl transition-colors select-none focus:outline-none"
                    aria-label={`Decrease ${line.name}`}
                  >
                    −
                  </button>
                  <span className="px-3 min-w-[60px] text-center text-sm font-bold text-ink select-none">
                    {line.requested_cases} {t.cases}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(line.sku_code, line.requested_cases + 1)}
                    disabled={isBlocked}
                    className="min-tap w-11 h-11 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-50 rounded-r-xl transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
                    aria-label={`Increase ${line.name}`}
                  >
                    +
                  </button>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => onUpdateQty(line.sku_code, 0)}
                  className="text-xs text-ink-muted hover:text-error underline py-1 px-2"
                >
                  Remove
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

              {/* Nudges from server quote */}
              {line.nudges && line.nudges.length > 0 && (
                <div className="space-y-1 pt-1">
                  {line.nudges.map((nudge, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 p-2 rounded-lg bg-primary-50 border border-primary/20 text-xs font-medium text-primary"
                    >
                      <svg
                        className="w-3.5 h-3.5 text-primary shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                      <span>{nudge}</span>
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

      {/* Bill Summary Card */}
      {/* Constraints:
          - Remove delivery banner, delivery fee row, "B2B Mandi Rates" chip,
            "Invoice estimate" and the GST-invoice note.
          - Display: Bill Summary, Item Subtotal, Applicable GST, Payable Amount.
      */}
      <div className="p-4 bg-white border border-border rounded-xl space-y-3">
        <h2 className="text-sm font-bold text-ink pb-2 border-b border-border">
          {t.bill_summary}
        </h2>

        {/* Item Subtotal */}
        <div className="flex justify-between items-center text-sm text-ink-muted">
          <span>{t.subtotal}</span>
          <span className="font-semibold text-ink">
            {formatINR(quote?.subtotal)}
          </span>
        </div>

        {/* Applicable GST */}
        <div className="flex justify-between items-center text-sm text-ink-muted">
          <span>{t.gst}</span>
          <span className="font-semibold text-ink">
            {formatINR(quote?.gst_amount)}
          </span>
        </div>

        {/* Divider */}
        <div className="h-px bg-border my-1" />

        {/* Payable Amount */}
        <div className="flex justify-between items-baseline pt-1">
          <span className="text-base font-bold text-ink">
            {t.payable}
          </span>
          <span className="text-xl font-bold text-primary">
            {formatINR(quote?.payable)}
          </span>
        </div>
      </div>
    </div>
  );
};
