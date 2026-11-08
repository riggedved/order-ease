import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { CatalogueScreen } from './components/CatalogueScreen';
import { CartView } from './components/CartView';
import { OrderByMessage } from './components/OrderByMessage';
import type { Language } from './i18n';
import { translations } from './i18n';
import type {
  UserMe,
  TokenResponse,
  CatalogueSKU,
  CartQuoteResponse,
  CartItem,
} from './types';
import { fetchMe, fetchCatalogue, fetchCartQuote } from './api';

// Lazy-load ProfilePanel overlay
const ProfilePanel = lazy(() => import('./components/ProfilePanel'));

export function App() {
  // 1. Language State
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('orderease_lang');
    return saved === 'hi' ? 'hi' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLanguage = () => {
    setLang((prev) => {
      const next = prev === 'en' ? 'hi' : 'en';
      localStorage.setItem('orderease_lang', next);
      return next;
    });
  };

  // 2. Auth State
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('orderease_token');
  });

  const [user, setUser] = useState<UserMe | null>(() => {
    const saved = localStorage.getItem('orderease_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  // 3. Navigation View State: 'catalogue' | 'cart' | 'order_by_message' | 'profile'
  const [currentView, setCurrentView] = useState<'catalogue' | 'cart' | 'order_by_message' | 'profile'>('catalogue');
  const [previousView, setPreviousView] = useState<'catalogue' | 'cart' | 'order_by_message'>('catalogue');

  // 4. Catalogue State
  const [catalogue, setCatalogue] = useState<CatalogueSKU[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  // 5. Cart State & Debounced Quote
  const [cartItems, setCartItems] = useState<Record<string, CartItem>>({});
  const [cartMessageNote, setCartMessageNote] = useState<string | null>(null);
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const debounceTimerRef = useRef<any>(null);

  // Derived simple quantities for CatalogueScreen
  const cartQuantities = useMemo(() => {
    const res: Record<string, number> = {};
    for (const [code, item] of Object.entries(cartItems)) {
      if (item.qty_cases > 0) {
        res[code] = item.qty_cases;
      }
    }
    return res;
  }, [cartItems]);

  // 6. Order by message draft text (persists when navigating back to catalogue and returning)
  const [orderMessageDraft, setOrderMessageDraft] = useState('');

  // 7. Profile Screen State
  const [profileScrollToCredit, setProfileScrollToCredit] = useState(false);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);

  // Preload ProfilePanel chunk when user is logged in
  useEffect(() => {
    if (token && user) {
      import('./components/ProfilePanel');
    }
  }, [token, user]);

  const handleOpenProfile = useCallback(() => {
    setProfileScrollToCredit(false);
    setPreviousView((prev) => (currentView !== 'profile' ? currentView : prev));
    setCurrentView('profile');
    if (window.history.state?.view !== 'profile') {
      window.history.pushState({ view: 'profile' }, '');
    }
  }, [currentView]);

  const handleOpenCredit = useCallback(() => {
    setProfileScrollToCredit(true);
    setPreviousView((prev) => (currentView !== 'profile' ? currentView : prev));
    setCurrentView('profile');
    if (window.history.state?.view !== 'profile') {
      window.history.pushState({ view: 'profile' }, '');
    }
  }, [currentView]);

  const handleBackFromProfile = useCallback(() => {
    setCurrentView(previousView || 'catalogue');
    if (window.history.state?.view === 'profile') {
      window.history.back();
    }
  }, [previousView]);

  // Listen to browser back button (popstate)
  useEffect(() => {
    const handlePopState = () => {
      if (currentView === 'profile') {
        setCurrentView(previousView || 'catalogue');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentView, previousView]);

  // Sync token / user state
  const handleLoginSuccess = (tokenData: TokenResponse) => {
    setToken(tokenData.access_token);
    localStorage.setItem('orderease_token', tokenData.access_token);

    const currentUser: UserMe = {
      id: tokenData.user_id,
      name: tokenData.name,
      user_name: tokenData.user_name,
      role: tokenData.role,
      retailer_id: tokenData.retailer_id,
      retailer_name: tokenData.retailer_name,
    };
    setUser(currentUser);
    localStorage.setItem('orderease_user', JSON.stringify(currentUser));

    // Also fetch full user from GET /me to populate credit & salesman
    fetchMe(tokenData.access_token)
      .then((fullUser) => {
        setUser(fullUser);
        localStorage.setItem('orderease_user', JSON.stringify(fullUser));
      })
      .catch(() => {});
  };

  const handleLogout = () => {
    if (window.history.state?.view === 'profile') {
      window.history.back();
    }
    setToken(null);
    setUser(null);
    setCartItems({});
    setQuote(null);
    setCartMessageNote(null);
    setOrderMessageDraft('');
    setCurrentView('catalogue');
    localStorage.removeItem('orderease_token');
    localStorage.removeItem('orderease_user');
  };

  const handleClearCart = () => {
    setCartItems({});
    setQuote(null);
    setCartMessageNote(null);
  };

  // Refresh user data with GET /me
  const refreshUser = useCallback(() => {
    if (token) {
      fetchMe(token)
        .then((userData) => {
          setUser(userData);
          localStorage.setItem('orderease_user', JSON.stringify(userData));
        })
        .catch(() => {});
    }
  }, [token]);

  // Refresh user data with GET /me if token is already present on initial mount
  useEffect(() => {
    if (token) {
      fetchMe(token)
        .then((userData) => {
          setUser(userData);
          localStorage.setItem('orderease_user', JSON.stringify(userData));
        })
        .catch(() => {
          // Token expired or invalid
          handleLogout();
        });
    }
  }, [token]);

  // Load Catalogue when user and token are ready
  const loadCatalogue = useCallback(async () => {
    if (!token || !user?.retailer_id) return;
    setCatalogueLoading(true);
    setCatalogueError(null);

    try {
      const data = await fetchCatalogue(user.retailer_id, token);
      setCatalogue(data);
    } catch (err: any) {
      setCatalogueError(err.message || 'Failed to load catalogue');
    } finally {
      setCatalogueLoading(false);
    }
  }, [token, user?.retailer_id]);

  useEffect(() => {
    if (token && user?.retailer_id) {
      loadCatalogue();
    }
  }, [token, user?.retailer_id, loadCatalogue]);

  // Debounced Cart Quote Fetch (300 ms)
  // Every price, free case, discount, nudge, GST and total comes from POST /cart/quote
  const triggerDebouncedQuote = useCallback(
    (quantities: Record<string, number>) => {
      if (!token || !user?.retailer_id) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const lines = Object.entries(quantities)
        .filter(([_, qty]) => qty > 0)
        .map(([sku_code, qty_cases]) => ({
          sku_code,
          qty_cases,
        }));

      if (lines.length === 0) {
        setQuote(null);
        setQuoteLoading(false);
        return;
      }

      setQuoteLoading(true);
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetchCartQuote(user.retailer_id!, lines, token);
          setQuote(res);
        } catch {
          // Keep existing quote or handle error gracefully
        } finally {
          setQuoteLoading(false);
        }
      }, 300);
    },
    [token, user?.retailer_id]
  );

  // Update Cart Quantity handler
  const handleUpdateQty = (skuCode: string, qty: number) => {
    setCartItems((prev) => {
      const updated = { ...prev };
      if (qty <= 0) {
        delete updated[skuCode];
      } else {
        const existing = updated[skuCode];
        updated[skuCode] = {
          sku_code: skuCode,
          qty_cases: qty,
          original_words: existing?.original_words || null,
          unit: existing?.unit || 'case',
        };
      }
      const newQuantities: Record<string, number> = {};
      for (const [code, item] of Object.entries(updated)) {
        if (item.qty_cases > 0) newQuantities[code] = item.qty_cases;
      }
      triggerDebouncedQuote(newQuantities);
      return updated;
    });
  };

  // Bulk add items from OrderByMessage into Cart
  // Requirement: sku_code, qty_cases, original_words. If already in cart, add quantities.
  // Show note: "2 items added from your message"
  const handleAddCapturedItemsToCart = (
    items: {
      sku_code: string;
      qty_cases: number;
      original_words?: string | null;
      unit?: string | null;
    }[]
  ) => {
    if (items.length === 0) return;

    setCartItems((prev) => {
      const updated = { ...prev };
      for (const item of items) {
        const existing = updated[item.sku_code];
        if (existing) {
          updated[item.sku_code] = {
            ...existing,
            qty_cases: existing.qty_cases + item.qty_cases,
            original_words: item.original_words || existing.original_words || null,
            unit: item.unit || existing.unit || 'case',
          };
        } else {
          updated[item.sku_code] = {
            sku_code: item.sku_code,
            qty_cases: item.qty_cases,
            original_words: item.original_words || null,
            unit: item.unit || 'case',
          };
        }
      }
      const newQuantities: Record<string, number> = {};
      for (const [code, item] of Object.entries(updated)) {
        if (item.qty_cases > 0) newQuantities[code] = item.qty_cases;
      }
      triggerDebouncedQuote(newQuantities);
      return updated;
    });

    const count = items.length;
    setCartMessageNote(
      count === 1
        ? translations[lang].item_added_from_message
        : translations[lang].items_added_from_message.replace('{count}', String(count))
    );
    setCurrentView('cart');
  };

  return (
    <div className="w-full min-h-screen bg-white flex justify-center">
      {/* 420px mobile frame on desktop, 360px+ first */}
      <div className="w-full max-w-[420px] min-h-screen bg-white flex flex-col relative border-x border-border">
        {/* Header - shown on all screens except the profile page */}
        {currentView !== 'profile' && (
          <Header
            user={user}
            lang={lang}
            onToggleLang={toggleLanguage}
            onLogout={handleLogout}
            onOpenProfile={handleOpenProfile}
            onOpenCredit={handleOpenCredit}
            profileButtonRef={profileButtonRef}
          />
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col">
          {!token || !user ? (
            <LoginScreen lang={lang} onLoginSuccess={handleLoginSuccess} />
          ) : currentView === 'catalogue' ? (
            <CatalogueScreen
              lang={lang}
              catalogue={catalogue}
              loading={catalogueLoading}
              error={catalogueError}
              onRetry={loadCatalogue}
              cartQuantities={cartQuantities}
              onUpdateQty={handleUpdateQty}
              onViewCart={() => setCurrentView('cart')}
              onOpenOrderByMessage={() => setCurrentView('order_by_message')}
              quote={quote}
            />
          ) : currentView === 'cart' ? (
            <CartView
              lang={lang}
              quote={quote}
              quoteLoading={quoteLoading}
              catalogue={catalogue}
              cartItems={cartItems}
              onUpdateQty={handleUpdateQty}
              onClearCart={handleClearCart}
              onBackToCatalogue={() => setCurrentView('catalogue')}
              cartMessageNote={cartMessageNote}
              onDismissMessageNote={() => setCartMessageNote(null)}
              retailerId={user.retailer_id!}
              token={token}
              onOrderPlaced={refreshUser}
            />
          ) : currentView === 'order_by_message' ? (
            <OrderByMessage
              lang={lang}
              retailerId={user.retailer_id!}
              token={token}
              catalogue={catalogue}
              draftText={orderMessageDraft}
              onDraftChange={setOrderMessageDraft}
              onBackToCatalogue={() => setCurrentView('catalogue')}
              onAddToCart={handleAddCapturedItemsToCart}
            />
          ) : (
            <Suspense fallback={null}>
              <ProfilePanel
                user={user}
                token={token}
                lang={lang}
                scrollToCredit={profileScrollToCredit}
                onBack={handleBackFromProfile}
                onToggleLang={toggleLanguage}
                onLogout={handleLogout}
                onOrderCancelled={refreshUser}
                onCreditUpdated={refreshUser}
              />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
