import { supabase } from "@/lib/supabase";
import { createWooOrder, getWooOrderUrl } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userName = decodeURIComponent(request.headers.get("x-auth-name") || "");
  const { id } = await params;

  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { platform, billing, shipping, customer_reference } = body || {};

  if (platform !== "woocommerce") {
    return Response.json({ error: "Platform niet ondersteund in v1 (alleen WooCommerce)" }, { status: 400 });
  }

  // Fetch quote + lead + line items
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("*, leads(*)")
    .eq("id", id)
    .single();

  if (quoteErr || !quote) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }
  if (quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  if (quote.external_order_id) {
    return Response.json(
      { error: "Offerte is al omgezet naar order", external_order_id: quote.external_order_id, external_order_url: quote.external_order_url },
      { status: 409 }
    );
  }
  if (quote.status !== "geaccepteerd") {
    return Response.json({ error: "Offerte moet status 'geaccepteerd' hebben om om te zetten" }, { status: 409 });
  }

  const { data: lineItems, error: lineErr } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", id)
    .order("sort_order");

  if (lineErr) {
    return Response.json({ error: "Kon line items niet ophalen" }, { status: 500 });
  }
  if (!lineItems || lineItems.length === 0) {
    return Response.json({ error: "Offerte heeft geen regels" }, { status: 400 });
  }

  const lead = quote.leads;

  // Split contact name into first/last for WC billing
  const firstName = lead.contact_first_name || (lead.contact_person?.split(" ")[0] || "");
  const lastName =
    lead.contact_last_name ||
    (lead.contact_person ? lead.contact_person.split(" ").slice(1).join(" ") : "");

  // Normalize addresses — prefer body-overrides, fallback to lead
  const b = billing || {};
  const s = shipping || {};
  // Order-updates e-mail (billing.email in WC) — default lead.email
  const orderUpdateEmail = b.email ?? lead.email ?? "";
  // Factuur e-mail (meta _factuur_email) — default lead.billing_email; leeg = WC plugins vallen zelf terug op billing.email
  const invoiceEmail = (b.invoice_email ?? lead.billing_email ?? "").toString().trim();
  const billingBlock = {
    first_name: b.first_name ?? firstName,
    last_name: b.last_name ?? lastName,
    company: b.company ?? (lead.company_name || ""),
    address_1: [b.street ?? lead.billing_street, b.house_number ?? lead.billing_house_number]
      .filter(Boolean)
      .join(" ") || "",
    postcode: b.postal_code ?? lead.billing_postal_code ?? "",
    city: b.city ?? lead.billing_city ?? "",
    country: b.country ?? lead.billing_country ?? "NL",
    email: orderUpdateEmail,
    phone: b.phone ?? lead.phone ?? "",
  };

  const useSameAsBilling = s?.same_as_billing ?? (lead.delivery_same_as_billing !== false);
  const shippingBlock = useSameAsBilling
    ? {
        first_name: billingBlock.first_name,
        last_name: billingBlock.last_name,
        company: billingBlock.company,
        address_1: billingBlock.address_1,
        postcode: billingBlock.postcode,
        city: billingBlock.city,
        country: billingBlock.country,
      }
    : {
        first_name: s.first_name ?? firstName,
        last_name: s.last_name ?? lastName,
        company: s.company ?? (lead.company_name || ""),
        address_1: [s.street ?? lead.delivery_street, s.house_number ?? lead.delivery_house_number]
          .filter(Boolean)
          .join(" ") || "",
        postcode: s.postal_code ?? lead.delivery_postal_code ?? "",
        city: s.city ?? lead.delivery_city ?? "",
        country: s.country ?? lead.delivery_country ?? "NL",
      };

  // Map line items naar WooCommerce format
  const wcLineItems = lineItems.map((i) => {
    const qty = Number(i.quantity || 1);
    const unit = Number(i.unit_price || 0);
    const item = {
      name: i.name,
      quantity: qty,
      subtotal: String((unit * qty).toFixed(2)),
      total: String(Number(i.line_total || unit * qty).toFixed(2)),
    };
    if (i.wc_product_id) item.product_id = Number(i.wc_product_id);
    if (i.sku) item.sku = i.sku;
    if (i.description) item.meta_data = [{ key: "Beschrijving", value: i.description }];
    return item;
  });

  const ref = (customer_reference ?? lead.customer_reference ?? "").toString().trim();

  const metaData = [
    { key: "_crm_quote_id", value: quote.id },
    { key: "_quote_reference", value: quote.quote_number },
  ];
  if (invoiceEmail) {
    metaData.push({ key: "_factuur_email", value: invoiceEmail });
  }
  if (ref) {
    metaData.push({ key: "_customer_reference", value: ref });
    metaData.push({ key: "po_reference", value: ref });
  }

  const payload = {
    status: "on-hold",
    billing: billingBlock,
    shipping: shippingBlock,
    line_items: wcLineItems,
    customer_note: `CRM Offerte ${quote.quote_number}${ref ? ` — Ref: ${ref}` : ""}`,
    meta_data: metaData,
  };

  if (quote.shipping_cost && Number(quote.shipping_cost) > 0) {
    payload.shipping_lines = [
      {
        method_id: "flat_rate",
        method_title: "Verzending",
        total: String(Number(quote.shipping_cost).toFixed(2)),
      },
    ];
  }

  // POST naar WooCommerce
  let wcOrder;
  try {
    wcOrder = await createWooOrder(payload);
  } catch (err) {
    return Response.json(
      { error: "WooCommerce fout", detail: err.message, code: err.wcCode || null, status: err.wcStatus || null },
      { status: 502 }
    );
  }

  const orderUrl = getWooOrderUrl(wcOrder.id);

  // Update quote met order-koppeling
  await supabase
    .from("quotes")
    .update({
      external_order_id: String(wcOrder.id),
      external_order_platform: "woocommerce",
      external_order_url: orderUrl,
      external_order_created_at: new Date().toISOString(),
      order_customer_reference: ref || null,
    })
    .eq("id", id);

  // Activity log
  await supabase.from("activities").insert({
    lead_id: quote.lead_id,
    activity_type: "quote_converted_to_order",
    description: `Offerte ${quote.quote_number} omgezet naar WC order #${wcOrder.id}`,
    created_by: userName || null,
    tenant,
  });

  return Response.json({
    success: true,
    order_id: String(wcOrder.id),
    order_url: orderUrl,
    order_number: wcOrder.number || String(wcOrder.id),
    platform: "woocommerce",
  });
}
