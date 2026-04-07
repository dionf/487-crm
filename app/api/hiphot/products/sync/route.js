import { supabase } from "@/lib/supabase";

const WC_URL = process.env.HIPHOT_WC_URL;
const WC_KEY = process.env.HIPHOT_WC_KEY;
const WC_SECRET = process.env.HIPHOT_WC_SECRET;

async function fetchAllWcProducts() {
  const products = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${WC_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=publish`;
    const res = await fetch(url, {
      headers: {
        Authorization: "Basic " + btoa(`${WC_KEY}:${WC_SECRET}`),
      },
    });

    if (!res.ok) {
      throw new Error(`WooCommerce API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.length === 0) break;
    products.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return products;
}

function mapCategory(wcProduct) {
  const cats = (wcProduct.categories || []).map((c) => c.name.toLowerCase());
  const joined = cats.join(" ");
  const name = (wcProduct.name || "").toLowerCase();
  const all = `${joined} ${name}`;

  const has30 = /factor\s*30|spf\s*30/.test(all);
  const has50 = /factor\s*50|spf\s*50/.test(all);

  if (has30 && has50) return "beide";
  if (has30) return "spf30";
  if (has50) return "spf50";

  if (
    joined.includes("toebehoren") ||
    joined.includes("accessoire") ||
    joined.includes("geen categorie") ||
    /dispenser|sticker|rakel|achterplaat|navul/.test(name)
  ) {
    return "accessoire";
  }

  return "beide";
}

function getInkoopPrice(wcProduct) {
  const meta = wcProduct.meta_data || [];
  const costMeta = meta.find((m) => m.key === "_alg_wc_cog_cost");
  return costMeta ? parseFloat(costMeta.value) || null : null;
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");

  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }
  if (role !== "admin") {
    return Response.json({ error: "Admin-only functie" }, { status: 403 });
  }

  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    return Response.json(
      { error: "WooCommerce credentials niet geconfigureerd" },
      { status: 500 }
    );
  }

  try {
    const wcProducts = await fetchAllWcProducts();
    const now = new Date().toISOString();
    let synced = 0;
    let errors = [];

    for (const wc of wcProducts) {
      const article = {
        wc_product_id: wc.id,
        sku: wc.sku || null,
        name: wc.name,
        description: wc.short_description || wc.description || null,
        category: mapCategory(wc),
        inkoop_price: getInkoopPrice(wc),
        verkoop_price: parseFloat(wc.regular_price) || null,
        sale_price: parseFloat(wc.sale_price) || null,
        is_active: wc.status === "publish",
        tenant: "hiphot",
        synced_at: now,
      };

      const { error } = await supabase
        .from("hiphot_articles")
        .upsert(article, { onConflict: "wc_product_id" });

      if (error) {
        errors.push({ product: wc.name, error: error.message });
      } else {
        synced++;
      }
    }

    return Response.json({
      message: `${synced} artikelen gesynchroniseerd`,
      synced,
      total_wc: wcProducts.length,
      errors: errors.length > 0 ? errors : undefined,
      synced_at: now,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
