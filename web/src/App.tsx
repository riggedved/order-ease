import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { CatalogueScreen } from './components/CatalogueScreen';
import { CartView } from './components/CartView';
import type { Language } from './i18n';
import type {
  UserMe,
  TokenResponse,
  CatalogueSKU,
  CartQuoteResponse,
} from './types';
import { fetchMe, fetchCatalogue, fetchCartQuote } from './api';

export function App() {
  // 1. Language State
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('orderease_lang');
    return saved === 'hi' ? 'hi' : 'en';
  });

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

  // 3. Navigation View State
  const [currentView, setCurrentView] = useState<'catalogue' | 'cart'>('catalogue');

  // 4. Catalogue State
  const [catalogue, setCatalogue] = useState<CatalogueSKU[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  // 5. Cart State & Debounced Quote
  const [cartQuantities, setCartQuantities] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const debounceTimerRef = useRef<any>(null);

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
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setCartQuantities({});
    setQuote(null);
    setCurrentView('catalogue');
    localStorage.removeItem('orderease_token');
    localStorage.removeItem('orderease_user');
  };

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
    setCartQuantities((prev) => {
      const updated = { ...prev };
      if (qty <= 0) {
        delete updated[skuCode];
      } else {
        updated[skuCode] = qty;
      }
      triggerDebouncedQuote(updated);
      return updated;
    });
  };

  return (
    <div className="w-full min-h-screen bg-white flex justify-center">
      {/* 420px mobile frame on desktop, 360px+ first */}
      <div className="w-full max-w-[420px] min-h-screen bg-white flex flex-col relative border-x border-border">
        {/* Header */}
        <Header
          user={user}
          lang={lang}
          onToggleLang={toggleLanguage}
          onLogout={handleLogout}
        />

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
              quote={quote}
            />
          ) : (
            <CartView
              lang={lang}
              quote={quote}
              quoteLoading={quoteLoading}
              catalogue={catalogue}
              onUpdateQty={handleUpdateQty}
              onBackToCatalogue={() => setCurrentView('catalogue')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
