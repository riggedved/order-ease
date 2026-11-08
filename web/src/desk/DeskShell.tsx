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
    <div className="min-w-[1280px] w-full min-h-screen bg-white text-ink flex flex-row">
      {/* Sidebar: Fixed 200px Width */}
      <aside className="w-[200px] shrink-0 min-h-screen bg-white border-r border-border flex flex-col justify-between z-30 select-none">
        <div className="flex flex-col">
          {/* Header Branding */}
          <div className="h-14 px-4 border-b border-border flex flex-col justify-center">
            <span className="text-[18px] font-bold text-ink leading-tight">
              {t.company_name}
            </span>
            <span className="text-[13px] text-ink-muted leading-tight">
              {t.order_desk}
            </span>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col py-2">
            <button
              type="button"
              className="h-12 flex items-center px-4 transition-colors border-l-4 border-primary text-primary font-semibold bg-primary-50 text-[14px]"
            >
              <OrdersIcon className="w-5 h-5 mr-3 text-primary" />
              <span>{t.nav_orders}</span>
            </button>
            <button
              type="button"
              className="h-12 flex items-center px-4 text-ink-muted hover:text-ink hover:bg-gray-50 transition-colors border-l-4 border-transparent text-[14px]"
            >
              <CaptureIcon className="w-5 h-5 mr-3 text-ink-muted" />
              <span>{t.nav_capture}</span>
            </button>
            <button
              type="button"
              className="h-12 flex items-center px-4 text-ink-muted hover:text-ink hover:bg-gray-50 transition-colors border-l-4 border-transparent text-[14px]"
            >
              <ExportIcon className="w-5 h-5 mr-3 text-ink-muted" />
              <span>{t.nav_export}</span>
            </button>
          </nav>
        </div>

        {/* Bottom Sidebar: Language Toggle & Logout */}
        <div className="p-4 border-t border-border flex flex-col gap-3">
          {/* Language Toggle: EN | हिं */}
          <div className="flex items-center border border-border rounded p-1 bg-gray-50">
            <button
              type="button"
              onClick={lang === 'en' ? undefined : onToggleLang}
              className={`flex-1 h-8 rounded text-[13px] font-semibold flex items-center justify-center transition-colors ${
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
              className={`flex-1 h-8 rounded text-[13px] font-semibold flex items-center justify-center transition-colors ${
                lang === 'hi'
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              हिं
            </button>
          </div>

          {/* Logout Button */}
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

      {/* Main Body (Top bar + Split view) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar: Only staff name from GET /me, plain text, no avatar button */}
        <header className="h-14 border-b border-border bg-white flex items-center justify-end px-6 shrink-0 z-20">
          <span className="text-[14px] font-medium text-ink">
            {user.name}
          </span>
        </header>

        {/* Split View: Left 60% Queue, Right 40% Detail */}
        <div className="flex-1 flex flex-row items-stretch">
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
        </div>
      </div>
    </div>
  );
};

export default DeskShell;

