import React, { useState, useMemo } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type {
  CatalogueSKU,
  ParsedLine,
  OrderResponse,
  CartQuoteLineResponse,
} from '../types';
import { captureOrder, createOrder, fetchCartQuote, ApiError } from '../api';
import {
  formatINR,
  cleanProductName,
  getProductImage,
  getPackSize,
  toSentenceCase,
} from '../utils';

interface OrderByMessageProps {
  lang: Language;
  retailerId: number;
  token: string;
  catalogue: CatalogueSKU[];
  draftText?: string;
  onDraftChange?: (text: string) => void;
  onBackToCatalogue: () => void;
  onAddToCart: (items: { sku_code: string; qty: number }[]) => void;
}

export const OrderByMessage: React.FC<OrderByMessageProps> = ({
  lang,
  retailerId,
  token,
  catalogue,
  draftText = '',
  onDraftChange,
  onBackToCatalogue,
  onAddToCart,
}) => {
  const t = translations[lang];

  // Flow State
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [orderText, setOrderText] = useState(draftText);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync draftText if updated from parent
  React.useEffect(() => {
    if (draftText && draftText !== orderText && !orderText) {
      setOrderText(draftText);
    }
  }, [draftText]);

  const handleTextChange = (val: string) => {
    setOrderText(val);
    if (onDraftChange) {
      onDraftChange(val);
    }
    if (error) setError(null);
  };

  // Capture & Review State
  const [editableLines, setEditableLines] = useState<ParsedLine[]>([]);
  const [quoteLines, setQuoteLines] = useState<CartQuoteLineResponse[]>([]);
  const [quoteSubtotal, setQuoteSubtotal] = useState<string | number>('0.00');
  const [quoteGst, setQuoteGst] = useState<string | number>('0.00');
  const [quotePayable, setQuotePayable] = useState<string | number>('0.00');
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Order Placement State
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<OrderResponse | null>(null);

  // Helper to look up SKU details from catalogue
  const getSku = (code: string | null) => {
    if (!code) return null;
    return catalogue.find((s) => s.code === code) || null;
  };

  // Sample prompt for quick testing
  const sampleOrder =
    'bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti';

  const handleUseSample = () => {
    handleTextChange(sampleOrder);
    setError(null);
  };

  // Remove a parsed line
  const handleRemoveLine = (index: number) => {
    const updated = editableLines.filter((_, i) => i !== index);
    setEditableLines(updated);
    refreshQuote(updated);
  };

  // Recalculate quote whenever user adjusts quantities or units
  const refreshQuote = async (linesToQuote: ParsedLine[]) => {
    const validLines = linesToQuote
      .filter((l) => {
        const skuInfo = getSku(l.sku_code);
        return (
          l.sku_code &&
          l.unit === 'case' &&
          (l.qty || 0) > 0 &&
          !l.flags.includes('out_of_stock') &&
          !l.flags.includes('needs_unit') &&
          !l.flags.includes('no_match') &&
          skuInfo?.stock_status !== 'out'
        );
      })
      .map((l) => ({
        sku_code: l.sku_code!,
        qty_cases: l.qty || 1,
      }));

    if (validLines.length === 0) {
      setQuoteLines([]);
      setQuoteSubtotal('0.00');
      setQuoteGst('0.00');
      setQuotePayable('0.00');
      return;
    }

    setQuoteLoading(true);
    try {
      const q = await fetchCartQuote(retailerId, validLines, token);
      setQuoteLines(q.lines);
      setQuoteSubtotal(q.subtotal);
      setQuoteGst(q.gst_amount);
      setQuotePayable(q.payable);
    } catch {
      // keep existing
    } finally {
      setQuoteLoading(false);
    }
  };

  // Parse text using backend /capture endpoint
  const handleParseOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!orderText.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await captureOrder(retailerId, orderText.trim(), token);
      setEditableLines(res.lines);

      if (res.preview_quote) {
        setQuoteLines(res.preview_quote.lines);
        setQuoteSubtotal(res.preview_quote.subtotal);
        setQuoteGst(res.preview_quote.gst_amount);
        setQuotePayable(res.preview_quote.payable);
      } else {
        setQuoteLines([]);
        setQuoteSubtotal('0.00');
        setQuoteGst('0.00');
        setQuotePayable('0.00');
      }

      setStep('review');
    } catch {
      setError(t.capture_error_msg);
    } finally {
      setLoading(false);
    }
  };

  // Line adjustment handlers
  const handleUpdateLineQty = (index: number, newQty: number) => {
    const updated = [...editableLines];
    updated[index] = { ...updated[index], qty: Math.max(1, newQty) };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  const handleSelectUnit = (index: number, unit: 'case' | 'piece') => {
    const updated = [...editableLines];
    const newFlags = (updated[index].flags || []).filter((f) => f !== 'needs_unit');
    updated[index] = { ...updated[index], unit, flags: newFlags };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  const handleSelectAlternative = (index: number, altSkuCode: string) => {
    const updated = [...editableLines];
    const currentCode = updated[index].sku_code;
    const newAlternatives = (updated[index].alternatives || []).filter((c) => c !== altSkuCode);
    if (currentCode && !newAlternatives.includes(currentCode)) {
      newAlternatives.push(currentCode);
    }

    const skuInfo = getSku(altSkuCode);
    const newFlags = (updated[index].flags || []).filter(
      (f) => f !== 'no_match' && f !== 'out_of_stock'
    );
    if (skuInfo && skuInfo.stock_status === 'out') {
      newFlags.push('out_of_stock');
    }

    updated[index] = {
      ...updated[index],
      sku_code: altSkuCode,
      alternatives: newAlternatives,
      confidence: 'high',
      flags: newFlags,
    };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  // Add parsed items to standard cart
  const handleAddAllToCart = () => {
    const items = editableLines
      .filter((l) => {
        const skuInfo = getSku(l.sku_code);
        return (
          l.sku_code &&
          l.unit === 'case' &&
          (l.qty || 0) > 0 &&
          !l.flags.includes('out_of_stock') &&
          !l.flags.includes('needs_unit') &&
          !l.flags.includes('no_match') &&
          skuInfo?.stock_status !== 'out'
        );
      })
      .map((l) => ({
        sku_code: l.sku_code!,
        qty: l.qty || 1,
      }));

    if (items.length > 0) {
      onAddToCart(items);
    }
  };

  // Count of items included in quote/order
  const validItemsCount = useMemo(() => {
    return editableLines.filter((l) => {
      const skuInfo = getSku(l.sku_code);
      return (
        l.sku_code &&
        l.unit === 'case' &&
        (l.qty || 0) > 0 &&
        !l.flags.includes('out_of_stock') &&
        !l.flags.includes('needs_unit') &&
        !l.flags.includes('no_match') &&
        skuInfo?.stock_status !== 'out'
      );
    }).length;
  }, [editableLines, catalogue]);

  const excludedCount = useMemo(() => {
    return editableLines.filter((l) => {
      const skuInfo = getSku(l.sku_code);
      return (
        l.flags.includes('out_of_stock') ||
        skuInfo?.stock_status === 'out' ||
        l.flags.includes('needs_unit') ||
        l.unit === 'unknown' ||
        !l.sku_code
      );
    }).length;
  }, [editableLines, catalogue]);

  const hasUnansweredQuestion = useMemo(() => {
    return editableLines.some(
      (l) => l.flags.includes('needs_unit') || l.flags.includes('no_match') || !l.sku_code || l.unit === 'unknown'
    );
  }, [editableLines]);

  const isConfirmDisabled =
    hasUnansweredQuestion || validItemsCount === 0 || quoteLoading || placingOrder;

  // Confirm order directly with source: retailer_capture
  const handleConfirmOrder = async () => {
    setOrderError(null);

    const validLines = editableLines
      .filter((l) => {
        const skuInfo = getSku(l.sku_code);
        return (
          l.sku_code &&
          l.unit === 'case' &&
          (l.qty || 0) > 0 &&
          !l.flags.includes('out_of_stock') &&
          !l.flags.includes('needs_unit') &&
          !l.flags.includes('no_match') &&
          skuInfo?.stock_status !== 'out'
        );
      })
      .map((l) => ({
        sku_code: l.sku_code!,
        qty_cases: l.qty || 1,
        original_words: l.original_words || null,
        unit: l.unit || 'case',
      }));

    if (validLines.length === 0) {
      setOrderError(
        lang === 'hi'
          ? 'ऑर्डर करने के लिए कोई मान्य सामान नहीं है।'
          : 'No valid items to order. Please ensure items are in stock.'
      );
      return;
    }

    setPlacingOrder(true);
    try {
      const order = await createOrder(
        {
          retailer_id: retailerId,
          lines: validLines,
          source: 'retailer_capture',
          client_request_id: `cap-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        },
        token
      );
      setOrderSuccess(order);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setOrderError(err.message);
      } else {
        setOrderError(err.message || 'Could not place order. Please try again.');
      }
    } finally {
      setPlacingOrder(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 px-4 py-4 pb-24 bg-surface">
      {/* ================= STEP 1: INPUT PAGE ================= */}
      {step === 'input' && (
        <div className="flex flex-col w-full pb-28">
          {/* 2. "Back to catalogue" link */}
          <div className="mb-3">
            <button
              type="button"
              onClick={onBackToCatalogue}
              className="min-tap -ml-1 inline-flex items-center text-sm font-semibold text-ink-muted hover:text-ink transition-colors focus:outline-none"
              aria-label={t.back_to_catalogue}
            >
              <svg
                className="w-4 h-4 mr-1.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>{t.back_to_catalogue}</span>
            </button>
          </div>

          {/* 3. Heading "Order by message" and one grey line */}
          <div className="mb-4">
            <h1 className="text-xl font-bold text-ink leading-tight">
              {t.order_by_msg_title}
            </h1>
            <p className="text-sm text-ink-muted mt-1 leading-snug">
              {t.order_by_msg_subline}
            </p>
          </div>

          {/* 4. Large textarea (min 8 lines, 16px text, autofocus, placeholder "Type or paste your order") */}
          <div className="w-full">
            <textarea
              id="order-message-input"
              rows={8}
              autoFocus
              disabled={loading}
              value={orderText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={t.order_input_placeholder}
              className="w-full p-3.5 bg-white text-ink text-[16px] border border-border rounded-xl outline-none resize-y min-h-[192px] leading-relaxed placeholder:text-ink-muted focus:border-primary disabled:bg-gray-50 disabled:text-ink-muted transition-colors"
            />
          </div>

          {/* 7. On error, keep the text and show "Could not read the order. Please try again." with a Retry button */}
          {error && (
            <div
              className="mt-3 p-3.5 bg-error-bg/30 border border-error/30 rounded-xl flex items-center justify-between gap-3 text-xs text-error"
              role="alert"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="font-medium">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => handleParseOrder()}
                className="px-3 py-1.5 rounded-lg bg-error text-white font-bold text-xs hover:bg-red-700 transition-colors shrink-0 focus:outline-none"
              >
                {t.retry}
              </button>
            </div>
          )}

          {/* 5. Complete example before the try this example button */}
          <p className="text-xs text-ink-muted mt-2.5 leading-relaxed">
            <span>{t.example_preview_label} · </span>
            <button
              type="button"
              onClick={handleUseSample}
              disabled={loading}
              className="text-primary font-semibold hover:underline focus:outline-none disabled:opacity-50 whitespace-nowrap"
            >
              {t.try_this_example}
            </button>
          </p>

          {/* 6. A fixed bottom bar (respecting the safe area) with a full-width green "Read my order" button, 56px tall */}
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[420px] bg-white border-t border-border p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] z-30 select-none">
            <button
              type="button"
              onClick={() => handleParseOrder()}
              disabled={loading || !orderText.trim()}
              className="w-full h-14 min-h-[56px] rounded-xl font-bold text-base flex items-center justify-center transition-colors disabled:bg-gray-200 disabled:text-ink-muted disabled:cursor-not-allowed bg-primary text-white hover:bg-primary-dark active:bg-primary-dark focus:outline-none"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 text-white mr-2.5"
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
                  <span>{t.reading_order}</span>
                </>
              ) : (
                <span>{t.read_order_btn}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================= STEP 2: REVIEW PAGE ================= */}
      {step === 'review' && (
        <div className="flex flex-col w-full pb-44">
          {/* Back link */}
          <div className="mb-2">
            <button
              type="button"
              onClick={() => {
                setOrderError(null);
                setStep('input');
              }}
              className="min-tap -ml-2 px-2 inline-flex items-center text-sm font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
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
              <span>{t.edit_text_btn}</span>
            </button>
          </div>

          {/* Heading & Subtitle */}
          <div className="mb-4">
            <h1 className="text-xl font-bold text-ink">
              {t.review_title}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">
              {t.review_subline}
            </p>
          </div>

          {/* Inline Order Error (if any) */}
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
                onClick={handleConfirmOrder}
                className="min-tap text-xs font-bold text-red-700 underline shrink-0"
              >
                {t.retry}
              </button>
            </div>
          )}

          {/* Parsed Items List */}
          <div className="space-y-3 mb-5">
            {editableLines.map((line, idx) => {
              const sku = getSku(line.sku_code);
              const ql = quoteLines.find((q) => q.sku_code === line.sku_code);
              const isOutOfStock =
                line.flags.includes('out_of_stock') || (sku && sku.stock_status === 'out');
              const needsUnit = line.flags.includes('needs_unit') || line.unit === 'unknown';
              const isNoMatch = line.flags.includes('no_match') || !line.sku_code;

              // 5. No match card: no image, text "Not found", product picker, Remove button
              if (isNoMatch) {
                return (
                  <div
                    key={idx}
                    className="p-3.5 bg-white border border-border rounded-xl flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-ink-muted truncate">
                        {line.original_words ? `“${line.original_words}”` : ''}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="min-tap text-sm text-ink-muted hover:text-red-600 underline font-medium focus:outline-none shrink-0"
                      >
                        {t.remove}
                      </button>
                    </div>

                    <div className="text-sm font-semibold text-red-600">
                      {t.not_found}
                    </div>

                    <div>
                      <label htmlFor={`picker-${idx}`} className="sr-only">
                        {t.select_product}
                      </label>
                      <select
                        id={`picker-${idx}`}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleSelectAlternative(idx, e.target.value);
                          }
                        }}
                        className="min-tap w-full h-12 px-3 bg-white border border-border rounded-lg text-sm text-ink focus:outline-none focus:border-primary"
                      >
                        <option value="">{t.select_product}</option>
                        {catalogue.map((catSku) => (
                          <option key={catSku.code} value={catSku.code}>
                            {cleanProductName(catSku.name)} (
                            {catSku.stock_status === 'out'
                              ? lang === 'hi'
                                ? 'आउट ऑफ स्टॉक'
                                : 'Out of stock'
                              : formatINR(catSku.case_price)}
                            )
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              }

              // Matched SKU Card
              return (
                <div
                  key={idx}
                  className="p-3.5 bg-white border border-border rounded-xl flex flex-col gap-2.5"
                >
                  {/* Top: 48px square thumbnail on left, words/confidence + name/total + case/price on right */}
                  <div className="flex items-start gap-3">
                    <img
                      src={sku?.image_url || (line.sku_code ? getProductImage(line.sku_code) : '/products/placeholder.svg')}
                      alt=""
                      loading="lazy"
                      className={`w-12 h-12 rounded-lg bg-gray-50 border border-border shrink-0 object-contain p-1 ${
                        isOutOfStock ? 'filter grayscale opacity-60' : ''
                      }`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/products/placeholder.svg';
                      }}
                    />

                    <div className="flex-1 min-w-0">
                      {/* Original words in quotes & confidence label */}
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm text-ink-muted truncate font-normal">
                          {line.original_words ? `“${line.original_words}”` : ''}
                        </span>
                        {line.confidence === 'medium' && (
                          <span className="text-xs font-semibold text-amber-700 shrink-0">
                            {t.conf_please_check}
                          </span>
                        )}
                        {line.confidence === 'low' && (
                          <span className="text-xs font-semibold text-red-600 shrink-0">
                            {t.conf_not_sure}
                          </span>
                        )}
                      </div>

                      {/* Product Name (no case suffix) & Line Total */}
                      <div className="flex items-start justify-between gap-2 mt-0.5">
                        <div
                          className={`text-sm font-bold leading-snug line-clamp-2 ${
                            isOutOfStock ? 'line-through text-ink-muted' : 'text-ink'
                          }`}
                        >
                          {cleanProductName(sku?.name || line.sku_code || '')}
                        </div>
                        {!isOutOfStock && !needsUnit && ql && (
                          <div className="text-sm font-bold text-ink shrink-0 text-right">
                            {formatINR(ql.line_total)}
                          </div>
                        )}
                      </div>

                      {/* Case and Price Line */}
                      {sku && (
                        <div className="text-xs text-ink-muted mt-0.5">
                          {lang === 'hi' ? `केस ${sku.units_per_case}` : `Case of ${sku.units_per_case}`} ·{' '}
                          {formatINR(sku.case_price)} / {lang === 'hi' ? 'केस' : 'case'}{' '}
                          {sku.price_includes_gst
                            ? lang === 'hi'
                              ? 'जीएसटी सहित'
                              : 'incl. GST'
                            : '+ GST'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 4. Out of stock state */}
                  {isOutOfStock && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-red-600">
                          {t.out_of_stock_not_added}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="min-tap text-sm text-ink-muted hover:text-red-600 underline font-medium focus:outline-none"
                        >
                          {t.remove}
                        </button>
                      </div>

                      {/* Available instead chip for alternative */}
                      {line.alternatives && line.alternatives.length > 0 && (() => {
                        const altSku = getSku(line.alternatives[0]);
                        if (!altSku || altSku.stock_status === 'out') return null;
                        return (
                          <div>
                            <button
                              type="button"
                              onClick={() => handleSelectAlternative(idx, altSku.code)}
                              className="min-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary-50 text-xs font-semibold text-primary hover:bg-primary-100 transition-colors"
                            >
                              <span>{t.available_instead}:</span>
                              <span className="font-bold">
                                {cleanProductName(altSku.name)} ({getPackSize(altSku)})
                              </span>
                              <span>→</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* 3. Unit question: needs_unit */}
                  {needsUnit && !isOutOfStock && (
                    <div className="pt-2 border-t border-border flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-ink">
                          {t.cases_or_pieces}
                        </span>
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          {t.choose_one}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'case')}
                          className="min-tap h-12 rounded-lg border-2 border-border text-ink font-bold text-sm bg-white hover:border-primary hover:bg-primary-50 active:bg-primary-100 transition-colors flex items-center justify-center gap-1 select-none"
                        >
                          <span>
                            {line.qty || 1} {lang === 'hi' ? 'केस' : 'Cases'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'piece')}
                          className="min-tap h-12 rounded-lg border-2 border-border text-ink font-bold text-sm bg-white hover:border-primary hover:bg-primary-50 active:bg-primary-100 transition-colors flex items-center justify-center gap-1 select-none"
                        >
                          <span>
                            {line.qty || 1} {lang === 'hi' ? 'पीस' : 'Pieces'}
                          </span>
                        </button>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="min-tap text-sm text-ink-muted hover:text-red-600 underline font-medium focus:outline-none"
                        >
                          {t.remove}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 2. Alternatives side-by-side (if alternatives exist and in-stock & not needsUnit) */}
                  {!isOutOfStock && !needsUnit && line.alternatives && line.alternatives.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                      {/* Current match (selected) */}
                      <button
                        type="button"
                        className="min-tap flex items-center gap-2 p-1.5 rounded-lg border-2 border-primary bg-primary-50 text-ink text-left select-none"
                      >
                        <img
                          src={sku?.image_url || (line.sku_code ? getProductImage(line.sku_code) : '')}
                          alt=""
                          loading="lazy"
                          className="w-8 h-8 rounded bg-white object-contain p-0.5 border border-primary/20 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-primary truncate">
                            {getPackSize(sku)}
                          </div>
                        </div>
                        <div className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </button>

                      {/* Alternative match */}
                      {(() => {
                        const altSku = getSku(line.alternatives[0]);
                        if (!altSku) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => handleSelectAlternative(idx, altSku.code)}
                            className="min-tap flex items-center gap-2 p-1.5 rounded-lg border border-border bg-white text-ink text-left hover:border-primary/40 transition-colors select-none"
                          >
                            <img
                              src={altSku.image_url || getProductImage(altSku.code)}
                              alt=""
                              loading="lazy"
                              className="w-8 h-8 rounded bg-gray-50 object-contain p-0.5 border border-border shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-ink-muted truncate">
                                {getPackSize(altSku)}
                              </div>
                            </div>
                            <div className="w-4 h-4 rounded-full border border-border shrink-0" />
                          </button>
                        );
                      })()}
                    </div>
                  )}

                  {/* Stepper "- 5 cases +" (48px tall) and Remove text button */}
                  {!isOutOfStock && !needsUnit && (
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                      <div className="flex items-center border border-border rounded-lg bg-surface h-12">
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(idx, (line.qty || 1) - 1)}
                          disabled={(line.qty || 1) <= 1}
                          className="w-12 h-12 flex items-center justify-center text-ink text-lg font-bold hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none select-none"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <div className="px-3 min-w-[70px] text-center text-sm font-bold text-ink select-none">
                          {line.qty || 1} {lang === 'hi' ? 'केस' : 'cases'}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(idx, (line.qty || 1) + 1)}
                          className="w-12 h-12 flex items-center justify-center text-ink text-lg font-bold hover:bg-gray-100 active:bg-gray-200 transition-colors focus:outline-none select-none"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="min-tap text-sm text-ink-muted hover:text-red-600 underline font-medium focus:outline-none"
                      >
                        {t.remove}
                      </button>
                    </div>
                  )}

                  {/* Nudge as one line of green sentence-case text */}
                  {!isOutOfStock && !needsUnit && ql?.nudges && ql.nudges.length > 0 && (
                    <div className="text-xs text-primary font-medium flex items-center gap-1.5 pt-0.5">
                      <svg className="w-3.5 h-3.5 shrink-0 text-primary" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{toSentenceCase(ql.nudges[0])}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state if all items removed */}
          {editableLines.length === 0 && (
            <div className="p-8 text-center bg-white border border-border rounded-xl space-y-3 mb-5">
              <p className="text-sm text-ink-muted">
                {lang === 'hi' ? 'कोई सामान नहीं बचा।' : 'No items left in this order.'}
              </p>
              <button
                type="button"
                onClick={() => setStep('input')}
                className="min-tap px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"
              >
                {t.edit_text_btn}
              </button>
            </div>
          )}

          {/* 6. Summary card */}
          {editableLines.length > 0 && (
            <div className="p-4 bg-white border border-border rounded-xl space-y-2 mb-4">
              <div className="flex justify-between text-sm text-ink-muted">
                <span>{lang === 'hi' ? 'उप-कुल (सबटोटल)' : 'Subtotal'}</span>
                <span className="font-semibold text-ink">{formatINR(quoteSubtotal)}</span>
              </div>

              <div className="flex justify-between text-sm text-ink-muted">
                <span>{lang === 'hi' ? 'जीएसटी' : 'GST'}</span>
                <span className="font-semibold text-ink">{formatINR(quoteGst)}</span>
              </div>

              <div className="pt-2 border-t border-border flex justify-between text-base font-bold text-ink">
                <span>{t.total_incl_gst}</span>
                <span className="text-primary">{formatINR(quotePayable)}</span>
              </div>

              {excludedCount > 0 && (
                <div className="pt-2 border-t border-border text-xs text-red-600 font-medium">
                  {(excludedCount === 1 ? t.item_not_included : t.items_not_included).replace(
                    '{n}',
                    String(excludedCount)
                  )}
                </div>
              )}
            </div>
          )}

          {/* 7. Fixed bottom bar (safe-area aware) */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border z-30 shadow-none pb-[env(safe-area-inset-bottom,0px)]">
            <div className="max-w-[420px] mx-auto p-4 flex flex-col gap-2">
              <div className="text-center text-sm font-bold text-ink">
                {validItemsCount}{' '}
                {validItemsCount === 1
                  ? lang === 'hi'
                    ? 'सामान'
                    : 'item'
                  : lang === 'hi'
                  ? 'सामान'
                  : 'items'}{' '}
                · {formatINR(quotePayable)} {lang === 'hi' ? 'जीएसटी सहित' : 'incl. GST'}
              </div>

              <button
                type="button"
                disabled={isConfirmDisabled}
                onClick={handleConfirmOrder}
                className="min-tap w-full h-14 rounded-xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-dark active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none"
              >
                {placingOrder ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
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
                    <span>{t.placing_order}</span>
                  </>
                ) : (
                  <span>{t.confirm_order_btn}</span>
                )}
              </button>

              <p className="text-xs text-ink-muted text-center">
                {t.nothing_ordered_note}
              </p>

              <button
                type="button"
                disabled={validItemsCount === 0}
                onClick={handleAddAllToCart}
                className="min-tap text-xs font-semibold text-primary hover:underline text-center disabled:opacity-40 disabled:no-underline"
              >
                {t.add_to_cart_and_keep_shopping}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ORDER SUCCESS MODAL ================= */}
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
              <p className="text-xs text-ink-muted mt-1">
                Order source: <span className="font-semibold text-ink">{orderSuccess.source}</span>
              </p>
            </div>

            {/* Order details summary including free items */}
            <div className="bg-gray-50 border border-border rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.order_id_label}</span>
                <span className="font-bold text-ink">#{orderSuccess.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.order_status_label}</span>
                <span
                  className={`font-bold capitalize ${
                    orderSuccess.status === 'credit_hold' ? 'text-warning' : 'text-primary'
                  }`}
                >
                  {orderSuccess.status.replace('_', ' ')}
                </span>
              </div>

              {/* List of ordered items and free cases */}
              {orderSuccess.lines && orderSuccess.lines.length > 0 && (
                <div className="border-t border-border pt-2 space-y-1">
                  <div className="font-semibold text-ink text-[11px] mb-1">Items Booked:</div>
                  {orderSuccess.lines.map((l: any, i: number) => (
                    <div key={i} className="flex justify-between items-center text-[11px] text-ink-muted">
                      <span className="truncate mr-2 max-w-[180px]">
                        {l.name || l.sku_code} ({l.qty_cases} cases)
                      </span>
                      <span className="shrink-0 font-medium text-ink">
                        {l.free_cases > 0 && (
                          <span className="text-primary font-bold mr-1">
                            +{l.free_cases} free!
                          </span>
                        )}
                        {formatINR(l.line_total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between border-t border-border pt-1.5 font-bold">
                <span className="text-ink">{t.order_total_label}</span>
                <span className="text-primary text-sm">
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
