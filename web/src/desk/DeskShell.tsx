import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type {
  DeskOrderSummary,
  DeskOrdersCounts,
  DeskOrderDetail,
  DeskCatalogueSKU,
} from './types';
import {
  fetchDeskOrders,
  fetchDeskOrderDetail,
  fetchDeskCatalogue,
  patchDeskOrder,
  DeskApiError,
} from './api';
import { getDefaultDateRange } from './formatters';
import { OrderQueue } from './OrderQueue';
import { OrderDetailPane } from './OrderDetailPane';
import { CaptureView } from './CaptureView';
import { ExportView } from './ExportView';
import { OrdersIcon, CaptureIcon, ExportIcon, LogoutIcon } from './icons';

export interface DeskShellProps {
  user: {
    id: number;
    name: string;
    role: string;
  };
  token: string;
  lang: DeskLanguage;
  onToggleLang: () => void;
  onLogout: () => void;
}

export const DeskShell: React.FC<DeskShellProps> = ({
  user,
  token,
  lang,
  onToggleLang,
  onLogout,
}) => {
  const t = deskTranslations[lang];

  // Shell Layout Lockdown: html, body, and app root are 100dvh with overflow hidden
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlH = html.style.height;
    const prevHtmlO = html.style.overflow;
    const prevBodyH = body.style.height;
    const prevBodyO = body.style.overflow;
    const prevRootH = root?.style.height;
    const prevRootO = root?.style.overflow;

    html.style.height = '100dvh';
    html.style.overflow = 'hidden';
    body.style.height = '100dvh';
    body.style.overflow = 'hidden';
    if (root) {
      root.style.height = '100dvh';
      root.style.overflow = 'hidden';
    }

    return () => {
      html.style.height = prevHtmlH;
      html.style.overflow = prevHtmlO;
      body.style.height = prevBodyH;
      body.style.overflow = prevBodyO;
      if (root) {
        root.style.height = prevRootH || '';
        root.style.overflow = prevRootO || '';
      }
    };
  }, []);

  // Navigation State
  const [activeNav, setActiveNav] = useState<'orders' | 'capture' | 'export'>('orders');

  // Filters State
  const defaultDates = useRef(getDefaultDateRange());
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState(defaultDates.current.from_date);
  const [toDate, setToDate] = useState(defaultDates.current.to_date);
  const [statusTab, setStatusTab] = useState<string>('all');
  const [pageOffset, setPageOffset] = useState(0);
  const pageSize = 50;

  // Queue Data State
  const [orders, setOrders] = useState<DeskOrderSummary[]>([]);
  const [counts, setCounts] = useState<DeskOrdersCounts>({
    all: 0,
    pending: 0,
    credit_hold: 0,
    approved: 0,
  });
  const [totalOrders, setTotalOrders] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Catalogue State
  const [catalogue, setCatalogue] = useState<DeskCatalogueSKU[]>([]);

  // Selected Order & Detail State
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [activeOrder, setActiveOrder] = useState<DeskOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Mutation & Error State
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  // Ref for override input (for 'O' shortcut)
  const overrideInputRef = useRef<HTMLInputElement | null>(null);

  // 1. Fetch Catalogue SKUs on mount
  useEffect(() => {
    let isCancelled = false;
    async function loadCatalogue() {
      try {
        const cat = await fetchDeskCatalogue(token);
        if (!isCancelled) {
          setCatalogue(cat);
        }
      } catch (err: any) {
        console.error('Failed to load catalogue:', err);
      }
    }
    loadCatalogue();
    return () => {
      isCancelled = true;
    };
  }, [token]);

  // 2. Fetch Orders Queue List
  const loadOrders = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetchDeskOrders(token, {
        q: searchQuery || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        status: statusTab !== 'all' ? statusTab : undefined,
        sort: 'newest',
        limit: pageSize,
        offset: pageOffset,
      });
      setOrders(res.items);
      setCounts(res.counts);
      setTotalOrders(res.total);

      // Auto-select first order if none selected or current not in list
      if (res.items.length > 0) {
        setSelectedOrderId((prev) => {
          if (prev && res.items.some((item) => item.id === prev)) {
            return prev;
          }
          return res.items[0].id;
        });
      } else {
        setSelectedOrderId(null);
        setActiveOrder(null);
      }
    } catch (err: any) {
      setQueueError(err.message || t.error_orders);
    } finally {
      setQueueLoading(false);
    }
  }, [token, searchQuery, fromDate, toDate, statusTab, pageOffset, pageSize, t.error_orders]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // 3. Load Order Detail
  const loadOrderDetail = useCallback(
    async (orderId: number) => {
      setDetailLoading(true);
      setDetailError(null);
      setIsConflict(false);
      setActionError(null);
      try {
        const detail = await fetchDeskOrderDetail(token, orderId);
        setActiveOrder(detail);
      } catch (err: any) {
        setDetailError(err.message || t.error_details);
      } finally {
        setDetailLoading(false);
      }
    },
    [token, t.error_details]
  );

  // When selectedOrderId changes, load its detail
  useEffect(() => {
    if (selectedOrderId) {
      loadOrderDetail(selectedOrderId);
    }
  }, [selectedOrderId, loadOrderDetail]);

  // 4. Save Edits Action
  const handleSaveEdits = async (
    lines: Array<{ sku_code: string; qty_cases: number; original_words?: string | null }>
  ) => {
    if (!activeOrder) return;
    setActionLoading(true);
    setActionError(null);
    setIsConflict(false);

    try {
      const updated = await patchDeskOrder(token, activeOrder.id, {
        version: activeOrder.version,
        lines,
      });
      setActiveOrder(updated);
      // Refresh list to update total and status in table
      loadOrders();
    } catch (err: any) {
      if (err instanceof DeskApiError) {
        if (err.isConflict) {
          setIsConflict(true);
        } else if (err.isInsufficientStock && err.insufficientStockInfo) {
          const info = err.insufficientStockInfo;
          setActionError(
            `Insufficient stock for ${info.sku_code} (available: ${info.available}${
              info.needed ? `, needed: ${info.needed}` : ''
            })`
          );
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError(err.message || 'Failed to save edits');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Approve Action
  const handleApproveOrder = async (overrideFlag?: boolean, overrideReason?: string) => {
    if (!activeOrder) return;
    setActionLoading(true);
    setActionError(null);
    setIsConflict(false);

    try {
      const updated = await patchDeskOrder(token, activeOrder.id, {
        version: activeOrder.version,
        status: 'approved',
        override_flag: overrideFlag,
        override_reason: overrideReason,
      });
      setActiveOrder(updated);
      loadOrders();
    } catch (err: any) {
      if (err instanceof DeskApiError) {
        if (err.isConflict) {
          setIsConflict(true);
        } else if (err.isInsufficientStock && err.insufficientStockInfo) {
          const info = err.insufficientStockInfo;
          setActionError(
            `Insufficient stock for ${info.sku_code} (available: ${info.available}${
              info.needed ? `, needed: ${info.needed}` : ''
            })`
          );
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError(err.message || 'Failed to approve order');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // 6. Reload Order after Conflict
  const handleReloadOrder = () => {
    if (activeOrder) {
      loadOrderDetail(activeOrder.id);
    }
  };

  // 7. Global Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcuts do nothing while typing in an input, textarea, or select
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (orders.length === 0) return;
        const idx = orders.findIndex((o) => o.id === selectedOrderId);
        if (idx > 0) {
          setSelectedOrderId(orders[idx - 1].id);
        } else if (idx === -1) {
          setSelectedOrderId(orders[0].id);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (orders.length === 0) return;
        const idx = orders.findIndex((o) => o.id === selectedOrderId);
        if (idx >= 0 && idx < orders.length - 1) {
          setSelectedOrderId(orders[idx + 1].id);
        } else if (idx === -1) {
          setSelectedOrderId(orders[0].id);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedOrderId) {
          loadOrderDetail(selectedOrderId);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (activeOrder && activeOrder.status !== 'approved') {
          if (activeOrder.status === 'credit_hold') {
            if (overrideInputRef.current) {
              overrideInputRef.current.focus();
            }
          } else {
            handleApproveOrder(false);
          }
        }
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (overrideInputRef.current) {
          overrideInputRef.current.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orders, selectedOrderId, activeOrder, loadOrderDetail]);

  return (
    <div className="w-full h-dvh max-h-dvh overflow-hidden bg-white text-ink flex flex-row min-h-0">
      {/* Sidebar: Fixed 200px Width, 40px nav items */}
      <aside className="w-[200px] shrink-0 h-full bg-white border-r border-border flex flex-col justify-between z-30 select-none overflow-hidden min-h-0">
        <div className="flex flex-col">
          {/* Header Branding (about 56px) */}
          <div className="h-14 shrink-0 px-4 border-b border-border flex flex-col justify-center">
            <span className="text-[18px] font-bold text-ink leading-tight">
              {t.company_name}
            </span>
            <span className="text-[13px] text-ink-muted leading-tight">
              {t.order_desk}
            </span>
          </div>

          {/* Navigation Items (40px tall each) */}
          <nav className="flex flex-col py-2">
            <button
              type="button"
              onClick={() => setActiveNav('orders')}
              className={`h-10 flex items-center px-4 transition-colors border-l-4 text-[14px] ${
                activeNav === 'orders'
                  ? 'border-primary text-primary font-semibold bg-primary-50'
                  : 'border-transparent text-ink-muted hover:text-ink hover:bg-gray-50'
              }`}
            >
              <OrdersIcon className={`w-5 h-5 mr-3 ${activeNav === 'orders' ? 'text-primary' : 'text-ink-muted'}`} />
              <span>{t.nav_orders}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('capture')}
              className={`h-10 flex items-center px-4 transition-colors border-l-4 text-[14px] ${
                activeNav === 'capture'
                  ? 'border-primary text-primary font-semibold bg-primary-50'
                  : 'border-transparent text-ink-muted hover:text-ink hover:bg-gray-50'
              }`}
            >
              <CaptureIcon className={`w-5 h-5 mr-3 ${activeNav === 'capture' ? 'text-primary' : 'text-ink-muted'}`} />
              <span>{t.nav_capture}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('export')}
              className={`h-10 flex items-center px-4 transition-colors border-l-4 text-[14px] ${
                activeNav === 'export'
                  ? 'border-primary text-primary font-semibold bg-primary-50'
                  : 'border-transparent text-ink-muted hover:text-ink hover:bg-gray-50'
              }`}
            >
              <ExportIcon className={`w-5 h-5 mr-3 ${activeNav === 'export' ? 'text-primary' : 'text-ink-muted'}`} />
              <span>{t.nav_export}</span>
            </button>
          </nav>
        </div>

        {/* Bottom Sidebar: Staff Name, Language Toggle & Logout */}
        <div className="p-3 border-t border-border flex flex-col gap-2.5 shrink-0">
          {/* Staff name as plain text */}
          <div className="text-[14px] font-medium text-ink truncate px-1">
            {user.name}
          </div>

          {/* Language Toggle: EN | हिं */}
          <div className="flex items-center border border-border rounded p-0.5 bg-gray-50">
            <button
              type="button"
              onClick={lang === 'en' ? undefined : onToggleLang}
              className={`flex-1 h-7 rounded text-[13px] font-semibold flex items-center justify-center transition-colors ${
                lang === 'en'
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={lang === 'hi' ? undefined : onToggleLang}
              className={`flex-1 h-7 rounded text-[13px] font-semibold flex items-center justify-center transition-colors ${
                lang === 'hi'
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              हिं
            </button>
          </div>

          {/* Logout Button (40px tall) */}
          <button
            type="button"
            onClick={onLogout}
            className="h-10 flex items-center gap-2.5 text-[14px] text-ink-muted hover:text-ink transition-colors px-1"
          >
            <LogoutIcon className="w-5 h-5 text-ink-muted" />
            <span>{t.logout}</span>
          </button>
        </div>
      </aside>

      {/* Main Body Area: Flex row, no top bar, full height */}
      <main className="flex-1 flex flex-row min-w-0 h-full min-h-0 overflow-hidden">
        {activeNav === 'orders' ? (
          <>
            <OrderQueue
              lang={lang}
              orders={orders}
              counts={counts}
              total={totalOrders}
              loading={queueLoading}
              error={queueError}
              onRetry={loadOrders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={(id) => setSelectedOrderId(id)}
              searchQuery={searchQuery}
              onSearchChange={(q) => {
                setSearchQuery(q);
                setPageOffset(0);
              }}
              fromDate={fromDate}
              onFromDateChange={(d) => {
                setFromDate(d);
                setPageOffset(0);
              }}
              toDate={toDate}
              onToDateChange={(d) => {
                setToDate(d);
                setPageOffset(0);
              }}
              statusTab={statusTab}
              onStatusTabChange={(s) => {
                setStatusTab(s);
                setPageOffset(0);
              }}
              pageOffset={pageOffset}
              pageSize={pageSize}
              onPageChange={(offset) => setPageOffset(offset)}
            />

            <OrderDetailPane
              lang={lang}
              order={activeOrder}
              catalogue={catalogue}
              loading={detailLoading}
              error={detailError}
              onRetry={() => selectedOrderId && loadOrderDetail(selectedOrderId)}
              onSaveEdits={handleSaveEdits}
              onApprove={handleApproveOrder}
              onReloadOrder={handleReloadOrder}
              isConflict={isConflict}
              actionError={actionError}
              actionLoading={actionLoading}
              overrideInputRef={overrideInputRef}
            />
          </>
        ) : activeNav === 'capture' ? (
          <CaptureView
            token={token}
            lang={lang}
            onOrderCreated={(newId) => {
              loadOrders();
              setSelectedOrderId(newId);
              setActiveNav('orders');
            }}
          />
        ) : (
          <ExportView token={token} lang={lang} />
        )}
      </main>
    </div>
  );
};

export default DeskShell;

