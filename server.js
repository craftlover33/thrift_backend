import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const EBAY_TOKEN = process.env.EBAY_TOKEN;

// ==========================================
// MARKETPLACE MAP
// ==========================================
const MARKET_MAP = {
  US: "EBAY_US",
  UK: "EBAY_GB",
  GB: "EBAY_GB",
  AU: "EBAY_AU",
  CA: "EBAY_CA",
  DE: "EBAY_DE",
  FR: "EBAY_FR",
  IT: "EBAY_IT",
  ES: "EBAY_ES",
  AT: "EBAY_AT",
  NL: "EBAY_NL",
  CH: "EBAY_CH",
  IE: "EBAY_IE",
  PL: "EBAY_PL",
  SG: "EBAY_SG",
  HK: "EBAY_HK",
  MY: "EBAY_MY",
  PH: "EBAY_PH"
};

function mapCountry(country) {
  if (!country) return "EBAY_US";
  const upper = country.toUpperCase();
  return MARKET_MAP[upper] || "EBAY_US";
}

// ==========================================
// NORMALIZER — untuk fashion items
// ==========================================
function normalizeFashionItem(item) {
  if (!item) return null;

  return {
    id: item.itemId,
    title: item.title,
    price: item.price?.value || null,
    currency: item.price?.currency || null,
    image: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || null,
    condition: item.condition || null,
    brand: item.brand || null,
    seller: item.seller?.username || null,
    authenticity: item.authenticityGuarantee?.eligible ? "Guaranteed" : "Not guaranteed",
    url: item.itemWebUrl || null
  };
}

// ==========================================
// ENDPOINT: THRIFT FASHION SEARCH
// ==========================================
app.get("/thrift-fashion", async (req, res) => {
  try {
    const q = req.query.q;      // nama produk
    const code = req.query.code; // UPC / EAN / GTIN
    const country = req.query.country || "US";

    if (!q && !code) {
      return res.status(400).json({
        error: "Parameter 'q' (nama produk) atau 'code' (barcode) wajib diisi"
      });
    }

    const market = mapCountry(country);

    // ==========================================
    // BUILD QUERY
    // Gunakan kategori khusus fashion:
    // 11450 = Clothing & Accessories
    // 15724 = Men's Shoes
    // 3034 = Women's Bags
    // ==========================================
    const queryText = code
      ? `gtin:${code}`
      : `${q} fashion thrift vintage streetwear`;

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?
        q=${encodeURIComponent(queryText)}
        &category_ids=11450,15724,3034
        &limit=20`.replace(/\s+/g, "");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${EBAY_TOKEN}`,
        "X-EBAY-C-MARKETPLACE-ID": market,
        "Content-Type": "application/json"
      }
    });

    const raw = await response.json();
    const items = raw.itemSummaries || [];

    const normalized = items.map(normalizeFashionItem);

    return res.json({
      query_used: queryText,
      country,
      marketplace: market,
      result_count: normalized.length,
      items: normalized
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROOT
// ==========================================
app.get("/", (req, res) => {
  res.send("Thrift Fashion Backend is running ✔");
});

// ==========================================
// RUN SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
