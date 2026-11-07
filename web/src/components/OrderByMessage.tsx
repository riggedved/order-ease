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
import { formatINR, formatTitleCase } from '../utils';

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

  // Recalculate quote whenever user adjusts quantities or units
  const refreshQuote = async (linesToQuote: ParsedLine[]) => {
    const validLines = linesToQuote
      .filter((l) => l.sku_code && l.unit === 'case' && (l.qty || 0) > 0 && !l.flags.includes('out_of_stock'))
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
    updated[index] = { ...updated[index], qty: Math.max(0, newQty) };
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
    const newAlternatives = (updated[index].alternatives || [])
      .filter((c) => c !== altSkuCode);
    if (currentCode) {
      newAlternatives.push(currentCode);
    }

    const skuInfo = getSku(altSkuCode);
    const newFlags = (updated[index].flags || []).filter((f) => f !== 'no_match');
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
      .filter((l) => l.sku_code && l.unit === 'case' && (l.qty || 0) > 0 && !l.flags.includes('out_of_stock'))
      .map((l) => ({
        sku_code: l.sku_code!,
        qty: l.qty || 1,
      }));

    if (items.length > 0) {
      onAddToCart(items);
    }
  };

  // Total free cases calculated from live quote
  const totalFreeCases = useMemo(() => {
    return quoteLines.reduce((acc, q) => acc + (q.free_cases || 0), 0);
  }, [quoteLines]);

  // Confirm order directly with source: retailer_capture
  const handleConfirmOrder = async () => {
    setOrderError(null);

    const validLines = editableLines
      .filter((l) => l.sku_code && (l.qty || 0) > 0 && !l.flags.includes('out_of_stock'))
      .map((l) => ({
        sku_code: l.sku_code!,
        qty_cases: l.qty || 1,
        original_words: l.original_words,
        unit: l.unit || 'case',
      }));

    if (validLines.length === 0) {
      setOrderError('No valid items to order. Please ensure items are in stock.');
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
        setOrderError(`Order error: ${err.message}`);
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

          {/* 5. Under it, one grey line: "Example: 5 peti biscuit, 2 peti washing powder" with a "Try this example" link */}
          <p className="text-xs text-ink-muted mt-2.5 leading-relaxed">
            <span>{t.example_preview_label} · </span>
            <button
              type="button"
              onClick={handleUseSample}
              disabled={loading}
              className="text-primary font-semibold hover:underline focus:outline-none disabled:opacity-50"
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
        <div className="flex flex-col w-full">
          {/* Top Header & Step Indicator */}
          <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
            <button
              type="button"
              onClick={() => {
                setOrderError(null);
                setStep('input');
              }}
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
              <span>{t.edit_text_btn}</span>
            </button>

            <span className="text-xs font-bold text-primary px-2.5 py-1 rounded-full bg-primary-50 border border-primary/20">
              {t.step_2_title}
            </span>
          </div>

          {/* Heading */}
          <div className="mb-4">
            <h1 className="text-xl font-bold text-ink">
              {t.step_2_title}
            </h1>
            <p className="text-xs text-ink-muted mt-1">
              {t.review_subtitle}
            </p>
          </div>

          {/* Parsed Items List */}
          <div className="space-y-3 mb-6">
            {editableLines.map((line, idx) => {
              const sku = getSku(line.sku_code);
              const ql = quoteLines.find((q) => q.sku_code === line.sku_code);
              const isOutOfStock = line.flags.includes('out_of_stock') || (sku && sku.stock_status === 'out');
              const needsUnit = line.flags.includes('needs_unit') || line.unit === 'unknown';
              const isNoMatch = line.flags.includes('no_match') || !line.sku_code;

              return (
                <div
                  key={idx}
                  className={`p-3.5 bg-white border rounded-xl flex flex-col space-y-2.5 transition-colors ${
                    needsUnit
                      ? 'border-primary ring-1 ring-primary'
                      : isOutOfStock
                      ? 'border-error/40 bg-error-bg/5'
                      : 'border-border'
                  }`}
                >
                  {/* Original Words & Match Badge Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs text-ink-muted font-serif italic truncate">
                        "{line.original_words}"
                      </span>
                    </div>

                    {/* Match Badge */}
                    {isNoMatch ? (
                      <span className="px-2 py-0.5 rounded-full border border-error/40 text-error text-[11px] font-semibold bg-error-bg/20 shrink-0">
                        {t.no_match}
                      </span>
                    ) : needsUnit ? (
                      <span className="px-2 py-0.5 rounded-full border border-primary text-primary text-[11px] font-bold bg-primary-50 shrink-0">
                        {t.action_required}
                      </span>
                    ) : isOutOfStock ? (
                      <span className="px-2 py-0.5 rounded-full border border-error/50 text-error text-[11px] font-semibold bg-error-bg/30 shrink-0">
                        {t.out_of_stock}
                      </span>
                    ) : line.confidence === 'high' ? (
                      <span className="px-2 py-0.5 rounded-full border border-primary/30 text-primary text-[11px] font-semibold bg-primary-50 shrink-0 flex items-center gap-1">
                        <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span>{t.high_match}</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full border border-border text-ink-muted text-[11px] font-semibold bg-gray-50 shrink-0">
                        {t.medium_match}
                      </span>
                    )}
                  </div>

                  {/* SKU Name & Price Row */}
                  <div className="pt-1 border-t border-border flex items-start justify-between gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className={`text-sm font-semibold leading-tight ${
                          isOutOfStock ? 'text-ink-muted line-through' : 'text-ink'
                        }`}
                      >
                        {sku?.name || (isNoMatch ? 'Item not found in catalog' : line.sku_code)}
                      </span>
                      {sku && (
                        <span className="text-[11px] text-ink-muted mt-0.5">
                          {sku.code} · {formatINR(sku.case_price)} / {t.per_case}
                        </span>
                      )}
                    </div>

                    {/* Line Total */}
                    <div className="text-right shrink-0">
                      {isOutOfStock ? (
                        <span className="text-xs font-bold text-error block">
                          {t.out_of_stock_tag}
                        </span>
                      ) : ql ? (
                        <span className="text-sm font-bold text-ink block">
                          {formatINR(ql.line_total)}
                        </span>
                      ) : (
                        <span className="text-sm font-bold text-ink block">
                          {line.qty || 1} {line.unit === 'case' ? t.cases : line.unit}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Free Goods Badge (from scheme evaluation) */}
                  {ql && ql.free_cases > 0 && (
                    <div className="flex items-center gap-1.5 text-primary text-xs font-bold pt-1">
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
                        +{ql.free_cases}{' '}
                        {ql.free_cases === 1
                          ? t.free_cases_badge
                          : t.free_cases_plural_badge}
                      </span>
                    </div>
                  )}

                  {/* Scheme Discount Badge */}
                  {ql && parseFloat(ql.discount?.toString() || '0') > 0 && (
                    <div className="flex items-center gap-1.5 text-primary text-xs font-semibold pt-0.5">
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
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        />
                      </svg>
                      <span>
                        {formatINR(ql.discount)} {t.discount_applied}
                      </span>
                    </div>
                  )}

                  {/* Nudges from server quote */}
                  {ql && ql.nudges && ql.nudges.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {Array.from(new Set(ql.nudges)).slice(0, 1).map((nudge, nIdx) => (
                        <div
                          key={nIdx}
                          className="flex items-center gap-1.5 p-1.5 rounded-lg bg-primary-50 border border-primary/20 text-xs font-medium text-primary"
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
                          <span className="capitalize">{formatTitleCase(nudge)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unit Choice Option: If unit is unknown or needs_unit */}
                  {needsUnit && (
                    <div className="pt-2 border-t border-primary/20 space-y-1.5">
                      <p className="text-xs font-bold text-primary flex items-center gap-1">
                        <svg
                          className="w-4 h-4 text-primary"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                          />
                        </svg>
                        <span>{t.cases_or_pieces}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'case')}
                          className={`min-tap px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center transition-colors ${
                            line.unit === 'case'
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-ink border-border hover:bg-gray-50'
                          }`}
                        >
                          {t.cases_option.replace('{qty}', (line.qty || 1).toString())}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'piece')}
                          className={`min-tap px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center transition-colors ${
                            line.unit === 'piece'
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-ink border-border hover:bg-gray-50'
                          }`}
                        >
                          {t.pieces_option.replace('{qty}', (line.qty || 1).toString())}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quantity Stepper (if matched and in stock) */}
                  {!isOutOfStock && !isNoMatch && (
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center border border-border rounded-xl h-10 bg-surface">
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(idx, (line.qty || 1) - 1)}
                          className="min-tap w-10 h-10 flex items-center justify-center text-primary text-lg font-bold hover:bg-gray-50 rounded-l-xl transition-colors select-none focus:outline-none"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="px-2.5 min-w-[50px] text-center text-xs font-bold text-ink select-none">
                          {line.qty || 1} {line.unit === 'case' ? t.cases : line.unit}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateLineQty(idx, (line.qty || 1) + 1)}
                          className="min-tap w-10 h-10 flex items-center justify-center text-primary text-lg font-bold hover:bg-gray-50 rounded-r-xl transition-colors select-none focus:outline-none"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>

                      <span className="text-[11px] font-semibold text-primary flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{t.ready_to_pack}</span>
                      </span>
                    </div>
                  )}

                  {/* Alternatives (Did you mean) */}
                  {line.alternatives && line.alternatives.length > 0 && (
                    <div className="pt-2 border-t border-border space-y-1.5">
                      <span className="text-[11px] font-semibold text-ink-muted">
                        {t.did_you_mean}
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {line.alternatives.map((altCode) => {
                          const altSku = getSku(altCode);
                          return (
                            <button
                              key={altCode}
                              type="button"
                              onClick={() => handleSelectAlternative(idx, altCode)}
                              className="w-full min-tap p-2 rounded-lg border border-border bg-gray-50 hover:bg-primary-50 hover:border-primary text-left text-xs flex items-center justify-between transition-colors"
                            >
                              <span className="font-medium text-ink truncate mr-2">
                                {altSku?.name || altCode}
                              </span>
                              {altSku && (
                                <span className="font-bold text-primary shrink-0">
                                  {formatINR(altSku.case_price)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Estimated Summary Card */}
          <div className="p-4 bg-white border border-border rounded-xl space-y-2.5 mb-5">
            {/* Free cases total banner if any free cases were awarded */}
            {totalFreeCases > 0 && (
              <div className="p-2.5 rounded-lg bg-primary-50 border border-primary/20 text-xs font-bold text-primary flex items-center gap-2">
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
                    d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V4a2 2 0 10-2 2h2m0 13l4-4m-4 4l-4-4"
                  />
                </svg>
                <span>
                  {totalFreeCases} {totalFreeCases === 1 ? t.free_cases_badge : t.free_cases_plural_badge}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center text-xs text-ink-muted">
              <span>{t.subtotal}</span>
              <span className="font-semibold text-ink">
                {formatINR(quoteSubtotal)}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs text-ink-muted">
              <span>{t.gst}</span>
              <span className="font-semibold text-ink">
                {formatINR(quoteGst)}
              </span>
            </div>

            <div className="h-px bg-border my-1" />

            <div className="flex justify-between items-baseline pt-1">
              <span className="text-sm font-bold text-ink">
                {t.estimated_total}
              </span>
              <div className="text-right">
                <span className="text-lg font-bold text-primary">
                  {formatINR(quotePayable)}
                </span>
                <span className="block text-[10px] text-ink-muted">
                  {t.incl_gst}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-ink-muted text-center pt-1 border-t border-border flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>{t.nothing_ordered_note}</span>
            </p>
          </div>

          {/* Inline Order Error (if any) */}
          {orderError && (
            <div
              className="mb-4 p-3 bg-error-bg/30 border border-error/30 rounded-xl flex items-start gap-2 text-error text-xs"
              role="alert"
            >
              <svg
                className="w-4 h-4 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{orderError}</span>
            </div>
          )}

          {/* Actions: Confirm Order OR Add to Cart */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={placingOrder || quoteLoading}
              onClick={handleConfirmOrder}
              className="min-tap w-full h-13 rounded-xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-dark active:bg-primary-dark transition-colors disabled:opacity-50 select-none"
            >
              {placingOrder ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Placing order...</span>
                </>
              ) : (
                <>
                  <span>{t.confirm_order_btn}</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleAddAllToCart}
              className="min-tap w-full h-12 rounded-xl bg-white border border-primary text-primary font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-primary-50 transition-colors select-none"
            >
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <span>{t.add_to_cart}</span>
            </button>
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
