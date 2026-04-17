// WooCommerce REST API helper voor hiphot.nl
// Gebruikt HIPHOT_WC_URL / HIPHOT_WC_KEY / HIPHOT_WC_SECRET env vars.

function getAuth() {
  const key = process.env.HIPHOT_WC_KEY;
  const secret = process.env.HIPHOT_WC_SECRET;
  if (!key || !secret) {
    throw new Error("HIPHOT_WC_KEY / HIPHOT_WC_SECRET ontbreken");
  }
  return Buffer.from(`${key}:${secret}`).toString("base64");
}

function getBaseUrl() {
  const url = process.env.HIPHOT_WC_URL;
  if (!url) throw new Error("HIPHOT_WC_URL ontbreekt");
  return url.replace(/\/$/, "");
}

export async function createWooOrder(payload) {
  const res = await fetch(`${getBaseUrl()}/wp-json/wc/v3/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${getAuth()}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `WC API fout ${res.status}`;
    const err = new Error(msg);
    err.wcStatus = res.status;
    err.wcCode = data?.code;
    err.wcData = data;
    throw err;
  }
  return data;
}

// Helper om een URL naar de WooCommerce admin order-pagina te maken
export function getWooOrderUrl(orderId) {
  return `${getBaseUrl()}/wp-admin/post.php?post=${orderId}&action=edit`;
}
