import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { UserMe, OrderResponse } from '../types';
import { fetchMyOrders, cancelOrder, payOutstanding } from '../api';
import { formatINR, formatDate, getSkuDisplayName } from '../utils';
import { ProductImage } from './ProductImage';

export interface ProfilePanelProps {
  user: UserMe;
  token: string;
  lang: Language;
  scrollToCredit?: boolean;
  isOpen?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  onToggleLang: () => void;
  onLogout: () => void;
  onOrderCancelled?: () => void;
  onCreditUpdated?: () => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  user,
  token,
  lang,
  scrollToCredit,
  onBack,
  onClose,
  onToggleLang,
  onLogout,
  onOrderCancelled,
  onCreditUpdated,
}) => {
  const t = translations[lang];
  const creditCardRef = useRef<HTMLDivElement>(null);

  // Orders State: limit=3 by default, or full list if "View all orders" clicked
  const [orders, setOrders] = useState<OrderResponse[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [isViewingAllOrders, setIsViewingAllOrders] = useState(false);

  // Selected Order for viewing detail inline
  const [selectedOrder, setSelectedOrder] = useState<OrderResponse | null>(null);

  // Order cancellation state
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [cancelSuccessMessage, setCancelSuccessMessage] = useState<string | null>(null);

  // Payment state
  const [isPayingOutstanding, setIsPayingOutstanding] = useState(false);
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const handleBackToCatalogue = useCallback(() => {
    (onBack || onClose)?.();
  }, [onBack, onClose]);

  const handleBackToProfile = useCallback(() => {
    setSelectedOrder(null);
    setCancelSuccessMessage(null);
  }, []);

  // 1. Fetch Orders from GET /orders/mine
  const loadOrders = useCallback(
    async (viewAll: boolean = false) => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const data = await fetchMyOrders(token, viewAll ? undefined : 3);
        setOrders(data);
      } catch (err: any) {
        setOrdersError(err.message || t.orders_load_error);
      } finally {
        setOrdersLoading(false);
      }
    },
    [token, t.orders_load_error]
  );

  useEffect(() => {
    loadOrders(isViewingAllOrders);
  }, [isViewingAllOrders, loadOrders]);

  // 2. Scroll to credit card section if opened via the credit pill
  useEffect(() => {
    if (scrollToCredit && creditCardRef.current) {
      const timer = setTimeout(() => {
        creditCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [scrollToCredit]);

  // 3. Cancel Order handler
  const handleCancelOrder = async (orderId: number) => {
    setCancellingOrderId(orderId);
    setCancelSuccessMessage(null);
    try {
      const updated = await cancelOrder(orderId, token);
      setSelectedOrder(updated);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o))
      );
      setCancelSuccessMessage(t.order_cancelled_msg.replace('{id}', String(orderId)));
      onOrderCancelled?.();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel order');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // 4. Pay Outstanding handler
  const handlePayOutstanding = async () => {
    if (outstandingNum <= 0 || isPayingOutstanding) return;
    setIsPayingOutstanding(true);
    setPaymentSuccessMessage(null);
    setPaymentError(null);
    try {
      const res = await payOutstanding(token);
      setPaymentSuccessMessage(
        t.payment_success.replace('{amount}', formatINR(res.amount_paid))
      );
      onCreditUpdated?.();
      onOrderCancelled?.();
    } catch (err: any) {
      setPaymentError(err.message || 'Payment failed');
    } finally {
      setIsPayingOutstanding(false);
    }
  };

  // Credit calculations
  const creditLimitNum = parseFloat(String(user.credit_limit || 0));
  const outstandingNum = parseFloat(String(user.outstanding || 0));
  const availableCreditNum =
    user.available_credit != null
      ? parseFloat(String(user.available_credit))
      : Math.max(0, creditLimitNum - outstandingNum);
  const usedRatio = creditLimitNum > 0 ? Math.min(1, Math.max(0, outstandingNum / creditLimitNum)) : 0;

  return (
    <div className="w-full flex-1 flex flex-col bg-surface select-none pb-12">
      {/* Top Header Bar:
          - When an order is opened: ONLY show "Go back to profile" button (NO "Back to catalogue" button).
          - When on main profile: show "Back to catalogue" button.
          - EN | हिं Language Toggle at the very top right in the go back to catalogue zone.
      */}
      <div className="flex items-center justify-between p-3.5 border-b border-border sticky top-0 bg-surface z-10">
        {selectedOrder ? (
          <button
            type="button"
            onClick={handleBackToProfile}
            className="min-tap -ml-2 px-2 flex items-center text-body font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
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
            <span>{t.back_to_profile}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleBackToCatalogue}
            className="min-tap -ml-2 px-2 flex items-center text-body font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
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
        )}

        {selectedOrder && (
          <h2 id="profile-panel-title" className="text-body font-bold text-ink truncate px-2 tabular-nums">
            {t.order_number_label} #{selectedOrder.id}
          </h2>
        )}

        {/* Language selector EN | हिं at the very top in the go back to catalogue zone */}
        <div
          className="border border-border rounded-xl p-0.5 inline-flex items-center bg-white h-9 select-none shrink-0"
          role="group"
          aria-label="Language selector"
        >
          <button
            type="button"
            onClick={() => {
              if (lang !== 'en') onToggleLang();
            }}
            className={`min-w-[36px] h-8 px-2 flex items-center justify-center text-body font-bold rounded-lg transition-colors ${
              lang === 'en'
                ? 'bg-primary text-white'
                : 'text-ink-muted hover:text-ink bg-transparent'
            }`}
            aria-pressed={lang === 'en'}
          >
            EN
          </button>
          <span className="text-border px-0.5 text-small select-none">|</span>
          <button
            type="button"
            onClick={() => {
              if (lang !== 'hi') onToggleLang();
            }}
            className={`min-w-[36px] h-8 px-2 flex items-center justify-center text-body font-bold rounded-lg transition-colors ${
              lang === 'hi'
                ? 'bg-primary text-white'
                : 'text-ink-muted hover:text-ink bg-transparent'
            }`}
            aria-pressed={lang === 'hi'}
          >
            हिं
          </button>
        </div>
      </div>

      {/* If viewing single order detail */}
      {selectedOrder ? (
        <div className="p-4 space-y-4">
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center border-b border-border pb-2.5">
              <span className="text-small text-ink-muted tabular-nums">
                {t.order_number_label} #{selectedOrder.id}
              </span>
              <span
                className={`text-small font-bold px-2.5 py-0.5 rounded-full capitalize ${
                  selectedOrder.status === 'approved'
                    ? 'bg-[#E8F5E9] text-[#0C6B1A]'
                    : selectedOrder.status === 'credit_hold'
                    ? 'bg-amber-100 text-amber-800'
                    : selectedOrder.status === 'cancelled'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                {selectedOrder.status === 'cancelled' ? t.order_cancelled_badge : selectedOrder.status}
              </span>
            </div>

            <div className="flex justify-between text-small">
              <span className="text-ink-muted">{t.order_date_label}</span>
              <span className="font-medium text-ink tabular-nums">
                {formatDate(selectedOrder.created_at, lang)}
              </span>
            </div>

            <div className="flex justify-between items-baseline pt-1 border-t border-border">
              <span className="text-body font-bold text-ink">{t.order_total_label}</span>
              <span className="text-price font-bold tabular-nums text-primary">{formatINR(selectedOrder.total)}</span>
            </div>

            {/* Order Items: Shows image along with name, breakdown & line total */}
            {selectedOrder.lines && selectedOrder.lines.length > 0 && (
              <div className="pt-2 border-t border-border space-y-2">
                <span className="text-small font-bold uppercase tracking-wider text-ink-muted tabular-nums">
                  {t.order_lines_label} ({selectedOrder.lines.length})
                </span>
                <div className="space-y-2">
                  {selectedOrder.lines.map((l, idx) => {
                    const displayName = getSkuDisplayName(l.sku_code, l.name);
                    return (
                      <div
                        key={l.id || idx}
                        className="flex items-center gap-3 p-2 rounded-xl bg-white border border-border/60"
                      >
                        {/* 44px Product Thumbnail */}
                        <div className="w-11 h-11 rounded-lg border border-border/80 bg-gray-50 p-1 flex items-center justify-center shrink-0">
                          <ProductImage
                            skuCode={l.sku_code}
                            alt={displayName}
                            className="w-full h-full object-contain"
                          />
                        </div>

                        {/* Product Info: Name, Cases count & free goods */}
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-semibold text-ink text-body truncate">
                            {displayName}
                          </span>
                          <div className="text-small text-ink-muted flex items-center gap-1.5 flex-wrap tabular-nums">
                            <span>
                              {l.qty_cases} {l.qty_cases === 1 ? t.case_singular : t.cases}
                            </span>
                            {l.free_cases > 0 && (
                              <span className="text-[#0C6B1A] font-semibold">
                                (+{l.free_cases} {lang === 'hi' ? 'मुफ़्त' : 'free'})
                              </span>
                            )}
                            {l.price_per_case != null && (
                              <span>· {formatINR(l.price_per_case)} / {t.case_singular}</span>
                            )}
                          </div>
                        </div>

                        {/* Line Total */}
                        <span className="text-price font-bold tabular-nums text-ink shrink-0 text-right">
                          {formatINR(l.line_total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cancel Order Option for pending or credit_hold orders */}
            {(selectedOrder.status === 'pending' || selectedOrder.status === 'credit_hold') && (
              <div className="pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  disabled={cancellingOrderId === selectedOrder.id}
                  className="w-full min-tap h-12 rounded-xl border border-error text-error font-bold text-body flex items-center justify-center hover:bg-error-bg active:bg-error-bg transition-colors focus:outline-none disabled:opacity-50"
                >
                  {cancellingOrderId === selectedOrder.id ? (
                    <span>{t.cancelling_order}</span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {t.cancel_order}
                    </span>
                  )}
                </button>
              </div>
            )}

            {cancelSuccessMessage && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-small font-semibold text-[#0C6B1A]">
                {cancelSuccessMessage}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* b) Circular Profile Logo + Shop name & login phone number beside it */}
          <div className="p-4 border-b border-border bg-white flex items-center gap-3.5">
            {/* Circular Profile Logo */}
            <div className="w-12 h-12 rounded-full bg-primary-50 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>

            {/* Shop name & login phone number beside the logo */}
            <div className="min-w-0 flex-1">
              <div className="text-small font-semibold text-ink-muted leading-tight">
                {t.retailer_label}
              </div>
              <div className="text-body font-bold text-ink truncate leading-snug">
                {user.retailer_name || user.name || t.retailer_label}
              </div>
              <div className="text-small text-ink-muted truncate tabular-nums">
                {user.phone || t.mobile_number}
              </div>
            </div>
          </div>

          {/* c) "Your salesman: Name" with a "Call" tel: link, only if assigned */}
          {user.salesman_name && (
            <div className="p-4 border-b border-border bg-gray-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-small font-medium text-ink-muted">
                  {t.your_salesman}
                </div>
                <div className="text-body font-bold text-ink truncate">
                  {user.salesman_name}
                </div>
              </div>
              {user.salesman_phone && (
                <a
                  href={`tel:${user.salesman_phone}`}
                  className="min-tap px-3 py-2 rounded-xl bg-primary text-white text-body font-bold flex items-center gap-1.5 hover:bg-primary-dark active:bg-primary-dark transition-colors shrink-0 select-none"
                  aria-label={`${t.call_btn} ${user.salesman_name}`}
                >
                  <svg
                    className="w-3.5 h-3.5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  <span>{t.call_btn}</span>
                </a>
              )}
            </div>
          )}

          {/* d) Credit card: Credit limit, Outstanding, Available, thin progress bar */}
          <div ref={creditCardRef} className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-small font-bold uppercase tracking-wider text-ink-muted">
                {t.credit_card_title}
              </span>
              {user.credit_low && (
                <span className="text-small font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  Credit Low
                </span>
              )}
            </div>

            <div className="bg-white border border-border rounded-xl p-3.5 space-y-2.5">
              <div className="flex justify-between items-center text-small">
                <span className="text-ink-muted">{t.credit_limit_label}</span>
                <span className="text-price font-bold tabular-nums text-ink">{formatINR(creditLimitNum)}</span>
              </div>
              <div className="flex justify-between items-center text-small">
                <span className="text-ink-muted">{t.outstanding_label}</span>
                <span className="text-price font-bold tabular-nums text-ink">{formatINR(outstandingNum)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-1 border-t border-border">
                <span className="text-body font-bold text-ink">{t.available_label}</span>
                <span className={`text-price font-bold tabular-nums ${user.credit_low ? 'text-amber-700' : 'text-primary'}`}>
                  {formatINR(availableCreditNum)}
                </span>
              </div>

              {/* Thin progress bar of used credit */}
              <div className="pt-1">
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      user.credit_low ? 'bg-amber-500' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.round(usedRatio * 100)}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(usedRatio * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <div className="text-small text-ink-muted mt-1 tabular-nums">
                  <span>{Math.round(usedRatio * 100)}% {t.used_credit}</span>
                </div>
              </div>
            </div>

            {/* Pay Outstanding Amount Button */}
            <div className="pt-1">
              {outstandingNum > 0 ? (
                <button
                  type="button"
                  onClick={handlePayOutstanding}
                  disabled={isPayingOutstanding}
                  className="w-full min-tap h-12 rounded-xl bg-primary text-white font-bold text-body flex items-center justify-center gap-2 hover:bg-primary-dark active:bg-primary-dark transition-colors focus:outline-none disabled:opacity-50 select-none shadow-none cursor-pointer"
                >
                  {isPayingOutstanding ? (
                    <span>{t.paying_outstanding}</span>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <rect x="2" y="6" width="20" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="6" y1="12" x2="6.01" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="18" y1="12" x2="18.01" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{t.pay_outstanding_btn} ({formatINR(outstandingNum)})</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="w-full h-11 rounded-xl bg-gray-50 border border-border flex items-center justify-center text-small font-semibold text-ink-muted gap-1.5">
                  <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{t.no_outstanding_due}</span>
                </div>
              )}

              {paymentSuccessMessage && (
                <div className="mt-2.5 p-3 bg-green-50 border border-green-200 rounded-xl text-small font-semibold text-[#0C6B1A] flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{paymentSuccessMessage}</span>
                </div>
              )}
              {paymentError && (
                <div className="mt-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-small font-semibold text-error flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-error" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{paymentError}</span>
                </div>
              )}
            </div>
          </div>

          {/* e) Recent orders from GET /orders/mine?limit=3 with small product images side by side */}
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-small font-bold uppercase tracking-wider text-ink-muted">
                {isViewingAllOrders ? (lang === 'hi' ? 'सभी ऑर्डर' : 'All Orders') : t.recent_orders}
              </span>
            </div>

            {ordersLoading ? (
              <div className="flex items-center justify-center py-6 text-small text-ink-muted">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                <span>{t.loading}</span>
              </div>
            ) : ordersError ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2 text-center">
                <p className="text-small text-error font-medium">{ordersError}</p>
                <button
                  type="button"
                  onClick={() => loadOrders(isViewingAllOrders)}
                  className="min-tap px-4 py-1.5 text-body font-bold rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors inline-block"
                >
                  {t.retry}
                </button>
              </div>
            ) : orders.length === 0 ? (
              <div className="py-6 text-center text-small text-ink-muted bg-gray-50 rounded-xl border border-dashed border-border">
                {t.no_orders_yet}
              </div>
            ) : (
              <div className="space-y-2.5">
                {orders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => {
                      setSelectedOrder(order);
                      setCancelSuccessMessage(null);
                    }}
                    className="w-full text-left p-3.5 rounded-xl border border-border bg-white hover:border-primary focus:border-primary focus:outline-none transition-colors select-none space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-body font-bold text-ink tabular-nums">
                        {t.order_number_label} #{order.id}
                      </span>
                      <span
                        className={`text-small font-bold px-2 py-0.5 rounded-full capitalize ${
                          order.status === 'approved'
                            ? 'bg-[#E8F5E9] text-[#0C6B1A]'
                            : order.status === 'credit_hold'
                            ? 'bg-amber-100 text-amber-800'
                            : order.status === 'cancelled'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {order.status === 'cancelled' ? t.order_cancelled_badge : order.status}
                      </span>
                    </div>

                    {/* Small product images side by side */}
                    {order.lines && order.lines.length > 0 && (
                      <div className="flex items-center gap-1.5 py-1 overflow-x-auto no-scrollbar">
                        {order.lines.map((l, idx) => (
                          <div
                            key={l.id || idx}
                            className="w-9 h-9 rounded-lg border border-border bg-gray-50 p-1 flex items-center justify-center shrink-0"
                            title={getSkuDisplayName(l.sku_code, l.name)}
                          >
                            <ProductImage
                              skuCode={l.sku_code}
                              alt={l.sku_code}
                              className="w-full h-full object-contain"
                            />
                          </div>
                        ))}
                        <span className="text-small text-ink-muted pl-1 shrink-0 tabular-nums">
                          {order.lines.length} {order.lines.length === 1 ? (lang === 'hi' ? 'सामान' : 'item') : (lang === 'hi' ? 'सामान' : 'items')}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-small text-ink-muted pt-1 border-t border-border/40">
                      <span className="tabular-nums">{formatDate(order.created_at, lang)}</span>
                      <span className="text-price font-bold tabular-nums text-ink">
                        {formatINR(order.total)}
                      </span>
                    </div>
                  </button>
                ))}

                {/* View all orders button below the 3 most recent orders */}
                {!isViewingAllOrders && orders.length >= 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsViewingAllOrders(true);
                      loadOrders(true);
                    }}
                    className="w-full min-tap h-11 rounded-xl border border-border bg-white hover:bg-gray-50 active:bg-gray-100 text-primary text-body font-bold flex items-center justify-center gap-1.5 transition-colors focus:outline-none cursor-pointer"
                  >
                    <span>{t.view_all_orders}</span>
                    <svg
                      className="w-4 h-4 text-primary"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* g) Full-width outlined "Log out" button */}
          <div className="p-4 mt-auto">
            <button
              type="button"
              onClick={() => {
                handleBackToCatalogue();
                onLogout();
              }}
              className="w-full min-tap h-12 rounded-xl border border-error text-error font-bold text-body flex items-center justify-center hover:bg-error-bg active:bg-error-bg transition-colors focus:outline-none"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              {t.logout}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ProfilePanel;
