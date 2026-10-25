import { useState, useCallback, useEffect } from 'react';
import { Card, Button, Input, Badge, FeatureGate } from '@/components/ui';
import {
  ShoppingCart,
  Package,
  CreditCard,
  Coins,
  Users,
  AlertTriangle,
  Plus,
  Trash2,
  RefreshCw,
  List,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { shopAPI } from '@/api';
import type { PaymentMethod, Product, ProductCategory, Sale, SaleReceipt } from '@/types';

export interface CartItem {
  productId: string;
  quantity: number;
}

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  COMPLEMENT: 'Complément',
  ACCESSOIRE: 'Accessoire',
  BOISSON: 'Boisson',
  AUTRE: 'Autre',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  ESPECES: 'Espèces',
  CARTE: 'Carte bancaire',
  POINTS_FIDELITE: 'Points de fidélité',
};

const PAYMENT_ICONS: Record<PaymentMethod, React.ReactNode> = {
  ESPECES: <Coins size={16} />,
  CARTE: <CreditCard size={16} />,
  POINTS_FIDELITE: <Users size={16} />,
};

const CATEGORY_COLORS: Record<ProductCategory, string> = {
  COMPLEMENT: 'bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-500/30',
  ACCESSOIRE: 'bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-500/30',
  BOISSON: 'bg-green-900/20 text-green-800 dark:text-green-300 border border-green-500/30',
  AUTRE: 'bg-surface-overlay text-content border border-line-strong',
};

const LOW_STOCK_THRESHOLD = 5;

export default function ShopPage() {
  const [activeTab, setActiveTab] = useState<'catalogue' | 'pos' | 'history'>('catalogue');

  // --- Catalogue ---
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // --- Formulaire ajout produit ---
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    sku: '',
    description: '',
    price: '',
    category: 'COMPLEMENT' as ProductCategory,
    isService: false,
  });

  // --- POS / Panier ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [posClientId, setPosClientId] = useState('');
  const [posPaymentMethod, setPosPaymentMethod] = useState<PaymentMethod>('ESPECES');
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [posSuccess, setPosSuccess] = useState<string | null>(null);
  const [posReceipt, setPosReceipt] = useState<SaleReceipt | null>(null);

  // --- Historique ---
  const [sales, setSales] = useState<Sale[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setCatalogueLoading(true);
    setCatalogueError(null);
    try {
      const response = await shopAPI.getProducts();
      setProducts(response.data);
    } catch (err: any) {
      setCatalogueError(err.response?.data?.message ?? 'Impossible de charger le catalogue');
    } finally {
      setCatalogueLoading(false);
    }
  }, []);

  const fetchSales = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await shopAPI.getSales();
      setSales(response.data);
    } catch (err: any) {
      setHistoryError(err.response?.data?.message ?? 'Impossible de charger l\'historique');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchSales();
  }, [fetchProducts, fetchSales]);

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const lowStockProducts = products.filter(
    (p) =>
      p.isActive !== false &&
      !p.isService &&
      p.stockQuantity <= LOW_STOCK_THRESHOLD,
  );

  const cartTotal = cart.reduce(
    (acc, item) => {
      const product = products.find((p) => p.id === item.productId);
      return acc + (product ? product.price * item.quantity : 0);
    },
    0,
  );

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await shopAPI.createProduct({
        name: newProduct.name,
        sku: newProduct.sku,
        description: newProduct.description || undefined,
        price: parseFloat(newProduct.price),
        category: newProduct.category,
        isService: newProduct.isService,
      });
      setShowAddProduct(false);
      setNewProduct({ name: '', sku: '', description: '', price: '', category: 'COMPLEMENT', isService: false });
      await fetchProducts();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erreur lors de la création du produit');
    }
  };

  const handleAddToCart = (product: Product) => {
    if (product.isActive === false) {
      alert('Produit inactif : il ne peut plus être vendu');
      return;
    }
    if (!product.isService && product.stockQuantity <= 0) {
      alert('Produit en rupture de stock');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { productId: product.id, quantity: 1 }];
    });
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const handleChangeQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.productId === productId) {
          const newQty = i.quantity + delta;
          if (newQty <= 0) return { ...i, quantity: 1 };
          return { ...i, quantity: newQty };
        }
        return i;
      }),
    );
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setPosLoading(true);
    setPosError(null);
    setPosSuccess(null);
    setPosReceipt(null);
    try {
      const response = await shopAPI.processSale({
        clientId: posClientId || undefined,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        paymentMethod: posPaymentMethod,
      });
      setPosReceipt(response.data);
      setPosSuccess(
        `Ticket #${response.data.saleId.slice(0, 8)} — ${response.data.totalAmount.toFixed(2)} €`,
      );
      setCart([]);
      setPosClientId('');
      setPosPaymentMethod('ESPECES');
      await fetchProducts();
      await fetchSales();
    } catch (err: any) {
      setPosError(err.response?.data?.message ?? 'Erreur lors de la validation de la vente');
    } finally {
      setPosLoading(false);
    }
  };

  const tabs = [
    { id: 'catalogue', label: 'Catalogue & Stock', icon: <Package size={18} /> },
    { id: 'pos', label: 'Caisse (POS)', icon: <ShoppingCart size={18} /> },
    { id: 'history', label: 'Historique des Ventes', icon: <List size={18} /> },
  ];

  const renderPaymentButton = (method: PaymentMethod) => (
    <button
      key={method}
      type="button"
      onClick={() => setPosPaymentMethod(method)}
      className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded border text-sm font-medium transition-colors ${
        posPaymentMethod === method
          ? 'bg-brand-600/20 border-brand-500 text-brand-700 dark:text-brand-300'
          : 'bg-surface-raised border-line-strong text-content-muted hover:border-line-strong hover:text-content'
      }`}
    >
      {PAYMENT_ICONS[method]}
      <span>{PAYMENT_LABELS[method]}</span>
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-content">Boutique & Point de Vente</h1>
        <p className="text-content-muted">Gestion des produits, stocks et ventes en temps réel.</p>
      </div>

      {/* Barre d'onglets */}
      <div className="flex gap-1 mb-4 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-brand-500 text-brand-700 dark:text-brand-400 bg-brand-500/10'
                : 'border-transparent text-content-muted hover:text-content hover:bg-surface-overlay/50'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ================= ONGLET CATALOGUE ================= */}
      {activeTab === 'catalogue' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" data-dense>
          <div className="lg:col-span-8">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-content">Catalogue des produits</h2>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowAddProduct(true)}
                  icon={<Plus size={16} />}
                >
                  Nouveau produit
                </Button>
              </div>

              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-3 text-content-subtle" />
                <Input
                  placeholder="Rechercher un produit ou SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              {catalogueLoading && <div className="text-content-muted text-sm italic">Chargement...</div>}
              {catalogueError && (
                <div className="rounded-md bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-800 dark:text-red-400 mb-4">
                  {catalogueError}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-content-muted">
                      <th className="pb-2">Produit</th>
                      <th className="pb-2">SKU</th>
                      <th className="pb-2">Catégorie</th>
                      <th className="pb-2 text-right">Prix</th>
                      <th className="pb-2 text-right">Stock</th>
                      <th className="pb-2 text-center">Type</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => (
                      <tr key={p.id} className="border-b border-line/50 hover:bg-surface-raised/30 transition-colors">
                        <td className="py-3">
                          <div className="font-medium text-content">{p.name}</div>
                          {p.description && (
                            <div className="text-xs text-content-subtle mt-1">{p.description}</div>
                          )}
                        </td>
                        <td className="py-3 text-content-muted font-mono">{p.sku}</td>
                        <td className="py-3">
                          <Badge
                            variant="default"
                            className={CATEGORY_COLORS[p.category]}
                          >
                            {CATEGORY_LABELS[p.category]}
                          </Badge>
                        </td>
                        <td className="py-3 text-right text-content">
                          {p.price.toFixed(2)} €
                        </td>
                        <td className="py-3 text-right">
                          <Badge
                            variant={
                              p.stockQuantity === 0
                                ? 'danger'
                                : p.stockQuantity <= LOW_STOCK_THRESHOLD
                                  ? 'warning'
                                  : 'success'
                            }
                            className="text-[10px] px-2"
                          >
                            {p.stockQuantity}
                          </Badge>
                        </td>
                        <td className="py-3 text-center">
                          <Badge
                            variant={p.isActive === false ? 'danger' : 'default'}
                            className={
                              p.isActive === false
                                ? 'bg-red-500/10 text-red-800 dark:text-red-300 text-[10px] px-2 border border-red-500/30'
                                : p.isService
                                  ? 'bg-surface-strong text-content text-[10px] px-2'
                                  : 'bg-brand-600/20 text-brand-700 dark:text-brand-300 text-[10px] px-2 border border-brand-500/30'
                            }
                          >
                            {p.isActive === false
                              ? 'Inactif'
                              : p.isService
                                ? 'Service'
                                : 'Physique'}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={p.isActive === false}
                            onClick={() => handleAddToCart(p)}
                          >
                            <ShoppingBag size={14} className="mr-1" />
                            Ajouter
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-content-subtle">
                          Aucun produit trouvé
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {lowStockProducts.length > 0 && (
                <div className="mt-4 rounded-md bg-amber-900/20 border border-amber-500/30 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={16} className="text-amber-800 dark:text-amber-400" />
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Stock bas ({lowStockProducts.length} produit(s))
                    </span>
                  </div>
                  <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                    {lowStockProducts.map((p) => (
                      <li key={p.id}>
                        {p.name} — {p.stockQuantity} restant(s)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {showAddProduct && (
              <Card className="mt-6">
                <h2 className="font-semibold text-content mb-4">Ajouter un produit</h2>
                <form onSubmit={handleAddProduct} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">Nom</label>
                    <Input
                      value={newProduct.name}
                      onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                      placeholder="Nom du produit"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">SKU</label>
                    <Input
                      value={newProduct.sku}
                      onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                      placeholder="Référence SKU"
                      required
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-medium text-content-muted">Description</label>
                    <Input
                      value={newProduct.description}
                      onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                      placeholder="Description (optionnel)"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">Prix (€)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">Catégorie</label>
                    <select
                      value={newProduct.category}
                      onChange={(e) =>
                        setNewProduct({ ...newProduct, category: e.target.value as ProductCategory })
                      }
                      className="w-full rounded-md border border-line-strong bg-card px-3 py-2 text-content focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={newProduct.isService}
                        onChange={(e) =>
                          setNewProduct({ ...newProduct, isService: e.target.checked })
                        }
                        className="rounded border-line-strong bg-card accent-brand-600 focus:ring-brand-500"
                      />
                      Service immatériel (pas de gestion de stock)
                    </label>
                  </div>
                  <div className="md:col-span-2 flex gap-2">
                    <Button type="submit" variant="default">
                      Créer le produit
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowAddProduct(false)}
                    >
                      Annuler
                    </Button>
                  </div>
                </form>
              </Card>
            )}
          </div>

          <div className="lg:col-span-4">
            <Card>
              <h2 className="font-semibold text-content mb-4">Résumé du stock</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded bg-surface-raised/50">
                  <span className="text-content-muted text-sm">Produits en stock</span>
                  <span className="text-content font-mono">
                    {products.filter((p) => !p.isService).length}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded bg-surface-raised/50">
                  <span className="text-content-muted text-sm">Valeur du stock</span>
                  <span className="text-content font-mono">
                    {
                      products
                        .filter((p) => !p.isService)
                        .reduce((acc, p) => acc + p.price * p.stockQuantity, 0)
                        .toFixed(2)
                    } €
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded bg-amber-900/20 border border-amber-500/30">
                  <span className="text-amber-800 dark:text-amber-300 text-sm">Alertes stock bas</span>
                  <span className="text-amber-800 dark:text-amber-400 font-mono">
                    {lowStockProducts.length}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= ONGLET POS ================= */}
      {activeTab === 'pos' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" data-dense>
          <div className="lg:col-span-7">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-content">Panier d'achat</h2>
                <span className="text-xl font-bold text-brand-700 dark:text-brand-400">{cartTotal.toFixed(2)} €</span>
              </div>

              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-content-subtle">
                  <ShoppingCart size={48} className="mb-3 opacity-50" />
                  <p>Panier vide</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                  {cart.map((item) => {
                    const product = products.find((p) => p.id === item.productId);
                    if (!product) return null;
                    return (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between p-3 border border-line rounded bg-surface-raised/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-surface-overlay flex items-center justify-center">
                            <Package size={16} className="text-content-muted" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-content">{product.name}</div>
                            <div className="text-xs text-content-subtle">{product.sku}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleChangeQuantity(product.id, -1)}
                            className="w-8 h-8 p-0"
                          >
                            −
                          </Button>
                          <span className="w-8 text-center text-content font-mono">
                            {item.quantity}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleChangeQuantity(product.id, 1)}
                            className="w-8 h-8 p-0"
                          >
                            +
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFromCart(product.id)}
                            className="w-8 h-8 p-0 text-red-800 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-content">
                            {(product.price * item.quantity).toFixed(2)} €
                          </div>
                          <div className="text-xs text-content-subtle">
                            {product.price.toFixed(2)} € / unité
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-line">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-content">Total</span>
                  <span className="text-xl font-bold text-content">{cartTotal.toFixed(2)} €</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">Client (optionnel)</label>
                    <Input
                      value={posClientId}
                      onChange={(e) => setPosClientId(e.target.value)}
                      placeholder="ID du client"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">Mode de paiement</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['ESPECES', 'CARTE'] as PaymentMethod[]).map(
                        renderPaymentButton,
                      )}
                      <FeatureGate feature="loyalty">
                        {renderPaymentButton('POINTS_FIDELITE')}
                      </FeatureGate>
                    </div>
                  </div>

                  {posError && (
                    <div className="rounded-md bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-800 dark:text-red-400">
                      {posError}
                    </div>
                  )}
                  {posSuccess && (
                    <div className="rounded-md bg-green-900/20 border border-green-500/30 p-3 text-sm text-green-800 dark:text-green-400">
                      {posSuccess}
                    </div>
                  )}

                  {posReceipt && (
                    <div className="rounded-md border border-green-500/30 bg-green-900/10 p-3 text-sm">
                      <div className="flex items-center justify-between font-semibold text-green-800 dark:text-green-300">
                        <span>Ticket #{posReceipt.saleId.slice(0, 8)}</span>
                        <span>{posReceipt.paymentMethod}</span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {posReceipt.items.map((item) => (
                          <div
                            key={item.productId}
                            className="flex items-center justify-between gap-3 text-xs text-content-muted"
                          >
                            <span className="truncate">
                              {item.quantity} × {item.name} ({item.sku})
                            </span>
                            <span className="shrink-0 font-mono text-content">
                              {item.totalPrice.toFixed(2)} €
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-green-500/20 pt-2 font-semibold text-content">
                        <span>Total</span>
                        <span>{posReceipt.totalAmount.toFixed(2)} €</span>
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="default"
                    className="w-full py-3"
                    disabled={cart.length === 0 || posLoading}
                    onClick={handleCheckout}
                  >
                    {posLoading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw size={16} className="animate-spin" />
                        Validation...
                      </span>
                    ) : cart.length === 0 ? (
                      'Ajouter des articles'
                    ) : (
                      'Valider la vente'
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-5">
            <Card>
              <h2 className="font-semibold text-content mb-4">Produits disponibles</h2>
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-3 text-content-subtle" />
                <Input
                  placeholder="Rechercher un produit à ajouter..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                {filteredProducts.filter((p) => !p.isService && p.isActive !== false && p.stockQuantity > 0).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 border border-line rounded bg-surface-raised/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-brand-600/20 flex items-center justify-center">
                        <Package size={16} className="text-brand-700 dark:text-brand-400" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-content">{p.name}</div>
                        <div className="text-xs text-content-subtle">{p.sku}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-content">
                        {p.price.toFixed(2)} €
                      </span>
                      <Badge
                        variant="default"
                        className="text-[10px] px-2"
                      >
                        Stock: {p.stockQuantity}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAddToCart(p)}
                      >
                        <Plus size={14} className="mr-1" />
                        Ajouter
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= ONGLET HISTORIQUE ================= */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-content">Historique des ventes</h2>
              <p className="text-content-muted text-sm">
                Liste des tickets de caisse et transactions passées.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchSales}>
              <RefreshCw size={16} className="mr-2" />
              Actualiser
            </Button>
          </div>

          {historyLoading && <div className="text-content-muted text-sm italic">Chargement...</div>}
          {historyError && (
            <div className="rounded-md bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-800 dark:text-red-400">
              {historyError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-content-muted">
                  <th className="pb-2">Ticket</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">Paiement</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2 text-right">Détails</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-line/50 hover:bg-surface-raised/30 transition-colors">
                    <td className="py-3">
                      <div className="font-mono text-content-muted text-xs">#{s.id.slice(0, 8)}</div>
                    </td>
                    <td className="py-3 text-content">
                      {s.clientId ?? 'Client invité'}
                    </td>
                    <td className="py-3">
                      <Badge variant="default" className="text-[10px] px-2">
                        {PAYMENT_LABELS[s.paymentMethod]}
                      </Badge>
                    </td>
                    <td className="py-3 text-right text-content font-mono">
                      {s.totalAmount.toFixed(2)} €
                    </td>
                    <td className="py-3 text-content-muted text-xs">
                      {new Date(s.createdAt).toLocaleString('fr-FR')}
                    </td>
                    <td className="py-3 text-right">
                      <Button variant="ghost" size="sm">
                        <List size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-content-subtle">
                      Aucune vente enregistrée
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
