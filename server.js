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
  AU: "EBAY_AU",
  CA: "EBAY_CA",
  DE: "EBAY_DE",
  FR: "EBAY_FR",
  IT: "EBAY_IT",
  ES: "EBAY_ES"
};

function mapCountry(country) {
  if (!country) return "EBAY_US";
  return MARKET_MAP[country.toUpperCase()] || "EBAY_US";
}

// ==========================================
// NORMALIZER (Fashion Only)
// ==========================================
function normalize(item) {
  if (!item) return null;

  return {
    id: item.itemId,
    title: item.title,
    price: item.price?.value || null,
    currency: item.price?.currency || null,
    image: item.thumbnailImages?.[0]?.imageUrl || null,
    condition: item.condition || null,
    brand: item.brand || null,
    popularity_score: Number(item.watchCount || 0),
    url: item.itemWebUrl || null,
    categories: item.categories || [],
    seller: item.seller?.username || null
  };
}

// ==========================================
// CATEGORIES khusus Fashion Thrift
// ==========================================
const FASHION_CAT = [
  "11450", // Clothing, Shoes & Accessories
  "15724", // Men's Shoes
  "3034",  // Women's Bags
  "169291", // Vintage Clothing
  "24087", // Streetwear
  "57988" // Sneakers
];

// ==========================================
// ENDPOINT: POPULAR FASHION THRIFT
// ==========================================
app.get("/thrift-popular", async (req, res) => {
  try {
    const country = req.query.country || "US";
    const q = req.query.q || "vintage"; // default trending

    const marketplace = mapCountry(country);

    // ==========================================
    // KEYWORD fokus thrift fashion populer
    // ==========================================
    const keywords = `${q} thrift fashion vintage y2k streetwear`;

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?
      q=${encodeURIComponent(keywords)}
      &category_ids=${FASHION_CAT.join(",")}
      &sort=BEST_MATCH
      &limit=20`.replace(/\s+/g, "");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${EBAY_TOKEN}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace
      }
    });

    const json = await response.json();
    const items = json.itemSummaries || [];

    // Filter tambahan: hanya item populer
    const popularOnly = items
      .filter((i) => Number(i.watchCount || 0) > 5) // minimal ramai
      .map(normalize);

    return res.json({
      query_used: q,
      total_items: popularOnly.length,
      country,
      marketplace,
      items: popularOnly
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROOT
// ==========================================
app.get("/", (req, res) => {
  res.send("🔥 Thrift Fashion Popular Backend is running.");
});

// ==========================================
// LISTEN
// ==========================================
app.listen(PORT, () =>
  console.log(`Server ready on port ${PORT}`)
);
