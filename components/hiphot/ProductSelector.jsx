"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, RefreshCw, Plus, Package } from "lucide-react";
import { apiFetch, isAdminFromSession } from "@/lib/api";

const CATEGORIES = ["Alle", "SPF30", "SPF50", "Accessoire"];

export default function ProductSelector({ onAddProduct }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Alle");
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [error, setError] = useState("");
  const isAdmin = isAdminFromSession();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/hiphot/products");
      if (!res.ok) throw new Error("Producten ophalen mislukt");
      const data = await res.json();
      setProducts(data.products || []);
      if (data.synced_at) setSyncedAt(data.synced_at);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      const res = await apiFetch("/api/hiphot/products/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync mislukt");
      const data = await res.json();
      if (data.synced_at) setSyncedAt(data.synced_at);
      await fetchProducts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const filtered = products.filter((p) => {
    const matchesSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      category === "Alle" ||
      p.category?.toLowerCase() === category.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-amber-600" />
          <h3 className="font-semibold text-sm">Producten</h3>
          {syncedAt && (
            <span className="text-[11px] text-gray-400">
              Sync: {new Date(syncedAt).toLocaleDateString("nl-NL")}
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            Sync met webshop
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek product..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="px-4 pt-3 flex gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              category === cat
                ? "bg-amber-100 text-amber-800"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product list */}
      <div className="px-4 py-3 max-h-64 overflow-y-auto space-y-1">
        {error && (
          <p className="text-xs text-red-600 py-2">{error}</p>
        )}

        {loading ? (
          <p className="text-xs text-gray-400 py-4 text-center">Laden...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">Geen producten gevonden</p>
        ) : (
          filtered.map((product) => (
            <div
              key={product.id || product.sku}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 group transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                <div className="flex items-center gap-3 text-[11px] text-gray-400">
                  <span>{product.sku}</span>
                  <span>Inkoop: {formatPrice(product.inkoop_price)}</span>
                  <span className="text-amber-700 font-medium">
                    Verkoop: {formatPrice(product.verkoop_price)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onAddProduct?.(product)}
                className="ml-2 p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatPrice(price) {
  if (price == null) return "-";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(price);
}
