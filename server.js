// ======================================================
// THRIFT FASHION BACKEND v2
// Trending + Search + Lookup + Recommendation
// ======================================================

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// =============================
// TOKEN MANAGEMENT (AUTO REFRESH)
// =============================
let accessToken = null;
let accessTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && now < accessTokenExpiresAt) return accessToken;

  console.log("🔄 Refreshing eBay access token...");

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body,
  });

  const data = await resp.json();

  if (!resp.ok || !data.access_token) {
    console.error("❌ Cannot refresh eBay token:", data);
    const msg =
      data?.error_description ||
      data?.errors?.[0]?.message ||
      JSON.stringify(data);
    throw new Error("Cannot refresh eBay token: " + msg);
  }

  accessToken = data.access_token;
  accessTokenExpiresAt = now + (data.expires_in - 60) * 1000;

  console.log("✅ Token refreshed");
  return accessToken;
}

// =============================
// MARKET MAP
// =============================
const MARKET_MAP = {
  US: "EBAY_US",
  UK: "EBAY_GB",
  GB: "EBAY_GB",
  CA: "EBAY_CA",
  AU: "EBAY_AU",
  DE: "EBAY_DE",
  FR: "EBAY_FR",
  IT: "EBAY_IT",
  ES: "EBAY_ES",
};

function resolveMarketplace(country = "US") {
  return MARKET_MAP[country.toUpperCase()] || "EBAY_US";
}

// =============================
// CACHE (IN-MEMORY)
// =============================
const cacheStore = new Map();

function setCache(key, val, ttlMs) {
  cacheStore.set(key, { val, exp: Date.now() + ttlMs });
}
function getCache(key) {
  const d = cacheStore.get(key);
  if (!d) return null;
  if (Date.now() > d.exp) {
    cacheStore.delete(key);
    return null;
  }
  return d.val;
}

// =============================
// FASHION CATEGORY IDs
// =============================
const FASHION_CATS = [
  "11450",   // Clothing, Shoes & Accessories
  "57988",   // Sneakers
  "15724",   // Men's Shoes
  "3034",    // Women's Bags
  "169291",  // Vintage Clothing
  "24087",   // Streetwear
];

// =============================
// BLOCK WORDS (KHUSUS THRIFT FASHION)
// =============================
const BLOCK_WORDS = [
  // Non-fashion / bukan pakaian
  "lego", "funko", "toy", "poster", "print", "painting", "frame",
  "manual", "booklet", "guide", "pattern",

  // Barang kecil / aksesori kecil non-core
  "keychain", "key chain", "pin", "badge", "patch", "magnet", "sticker",

  // Promo / lot / bundling (kurang cocok sebagai single item thrift)
  "bundle", "joblot", "job lot", "bulk", "wholesale", "lots",

  // Electronics / gadget
  "charger", "case", "cover", "phone", "iphone", "ipad", "airpods", "camera",

  // Cards / collectibles non-fashion
  "pokemon", "yugioh", "yu-gi-oh", "mtg", "trading card", "tcg",

  // Barang rumah tangga
  "mug", "cup", "glass", "lamp", "furniture", "sofa", "chair", "table",
  "canvas", "print set",

  // Digital / template
  "pdf", "digital download", "template"
];

// =============================
// FASHION FILTER
// =============================
function isFashion(item) {
  if (!item?.title) return false;

  const t = item.title.toLowerCase();

  // blokir kata yang tidak diinginkan
  if (BLOCK_WORDS.some(w => t.includes(w))) return false;

  // indikator fashion
  const fashionHint =
    t.includes("vintage") ||
    t.includes("thrift") ||
    t.includes("y2k") ||
    t.includes("streetwear") ||
    t.includes("jacket") ||
    t.includes("coat") ||
    t.includes("jeans") ||
    t.includes("denim") ||
    t.includes("shirt") ||
    t.includes("t-shirt") ||
    t.includes("tee") ||
    t.includes("dress") ||
    t.includes("skirt") ||
    t.includes("hoodie") ||
    t.includes("sweatshirt") ||
    t.includes("pants") ||
    t.includes("trousers") ||
    t.includes("cargo") ||
    t.includes("sweater") ||
    t.includes("nike") ||
    t.includes("adidas") ||
    t.includes("jordan") ||
    t.includes("new balance") ||
    t.includes("sneaker") ||
    t.includes("trainers") ||
    t.includes("bag") ||
    t.includes("tote");

  const inFashionCategory = (item.categories || []).some(c =>
    FASHION_CATS.includes(c.categoryId)
  );

  return fashionHint || inFashionCategory;
}

// =============================
// NORMALIZER
// =============================
function normalizeThriftItem(item) {
  return {
    itemId: item.itemId,
    title: item.title,
    price: item.price || null,
    image:
      item.thumbnailImages?.[0]?.imageUrl ||
      item.image?.imageUrl ||
      null,
    url: item.itemWebUrl,
    condition: item.condition || null,
    brand: item.brand || null,
  };
}

// =============================
// GENERIC EBAY SEARCH WRAPPER (WITH BETTER ERROR)
// =============================
async function ebaySearch({ q, country = "US", extra = "" }) {
  const marketplace = resolveMarketplace(country);
  const cacheKey = `s|${marketplace}|${q}|${extra}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const token = await getAccessToken();

  const url =
    `https://api.ebay.com/buy/browse/v1/item_summary/search` +
    `?q=${encodeURIComponent(q)}` +
    `&category_ids=${FASHION_CATS.join(",")}` +
    extra;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
    },
  });

  const json = await resp.json();

  if (!resp.ok) {
    console.error("❌ eBay search error:", JSON.stringify(json, null, 2));
    const msg =
      json?.errors?.[0]?.message ||
      json?.error_description ||
      JSON.stringify(json);
    throw new Error("eBay search failed: " + msg);
  }

  setCache(cacheKey, json, 5 * 60 * 1000); // 5 menit cache
  return json;
}

// ======================================================
// 1) AUTO TRENDING THRIFT FASHION
// ======================================================
app.get("/thrift-trending", async (req, res) => {
  try {
    const { country = "US", limit = 40 } = req.query;

    const queries = [
      // Sneakers
      "nike dunk",
      "nike air force 1",
      "adidas samba",
      "new balance 550",
      "jordan 1",

      // Vintage
      "vintage jacket",
      "vintage jeans",
      "vintage sweatshirt",
      "90s jacket",
      "y2k top",

      // Streetwear
      "streetwear hoodie",
      "supreme hoodie",
      "carhartt jacket",
      "stussy t shirt",
    ];

    let found = [];

    for (const q of queries) {
      try {
        const json = await ebaySearch({
          q,
          country,
          extra: "&limit=50&sort=BEST_MATCH",
        });
        found.push(...(json.itemSummaries || []).filter(isFashion));
      } catch (innerErr) {
        console.error("⚠️ Trending query failed:", q, innerErr.message);
        // skip query yang error, lanjut query lain
      }
    }

    // Unik by title
    const map = new Map();
    for (const it of found) {
      if (!map.has(it.title)) map.set(it.title, it);
    }

    const unique = [...map.values()];

    // Trending score = harga + random kecil
    const enriched = unique.map(it => ({
      ...normalizeThriftItem(it),
      score: Number(it.price?.value || 0) + Math.random() * 10,
    }));

    enriched.sort((a, b) => b.score - a.score);

    res.json({
      country,
      total: enriched.length,
      items: enriched.slice(0, Number(limit)),
    });
  } catch (e) {
    console.error("🔥 thrift-trending error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ======================================================
// 2) ADVANCED SEARCH THRIFT FASHION
// ======================================================
app.get("/thrift-search", async (req, res) => {
  try {
    const {
      q = "",
      country = "US",
      page = 1,
      limit = 20,
      sort = "best", // best | price_low | price_high | newest
    } = req.query;

    const raw = await ebaySearch({
      q,
      country,
      extra: "&limit=200",
    });

    let items = (raw.itemSummaries || []).filter(isFashion);

    // Sorting
    if (sort === "price_low") {
      items.sort((a, b) => Number(a.price?.value || 0) - Number(b.price?.value || 0));
    } else if (sort === "price_high") {
      items.sort((a, b) => Number(b.price?.value || 0) - Number(a.price?.value || 0));
    } else if (sort === "newest") {
      items.sort(
        (a, b) =>
          new Date(b.itemCreationDate || 0) - new Date(a.itemCreationDate || 0)
      );
    }

    // Pagination
    const start = (Number(page) - 1) * Number(limit);
    const paged = items.slice(start, start + Number(limit));

    res.json({
      country,
      query: q,
      total: items.length,
      page: Number(page),
      limit: Number(limit),
      items: paged.map(normalizeThriftItem),
    });
  } catch (e) {
    console.error("🔥 thrift-search error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ======================================================
// 3) BARCODE LOOKUP (UPC / EAN / GTIN)
// ======================================================
app.get("/lookup", async (req, res) => {
  try {
    const code = req.query.code;
    const country = req.query.country || "US";

    if (!code) {
      return res.status(400).json({ error: "Parameter 'code' wajib diisi" });
    }

    const token = await getAccessToken();
    const marketplace = resolveMarketplace(country);

    const url =
      `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?gtin=${encodeURIComponent(code)}` +
      `&category_ids=${FASHION_CATS.join(",")}` +
      `&limit=20`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Content-Type": "application/json",
      },
    });

    const json = await resp.json();
    let items = (json.itemSummaries || []).filter(isFashion);

    // Fallback: jika tidak ada hasil dari gtin, coba pakai q=code
    if (items.length === 0) {
      const fallback = await ebaySearch({
        q: code,
        country,
        extra: "&limit=20",
      });
      items = (fallback.itemSummaries || []).filter(isFashion);

      return res.json({
        code,
        fallback: true,
        total_items: items.length,
        items: items.map(normalizeThriftItem),
      });
    }

    res.json({
      code,
      fallback: false,
      total_items: items.length,
      items: items.map(normalizeThriftItem),
    });
  } catch (e) {
    console.error("🔥 lookup error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ======================================================
// 4) RECOMMENDATION ENDPOINT (/recommend)
// ======================================================
app.get("/recommend", async (req, res) => {
  try {
    const { id, country = "US", limit = 20 } = req.query;
    let { q = "" } = req.query;

    const token = await getAccessToken();
    const marketplace = resolveMarketplace(country);

    let baseTitle = "";
    let baseBrand = "";
    let basePrice = 0;

    // Jika ada id, ambil detail item sebagai basis rekomendasi
    if (id) {
      const itemUrl = `https://api.ebay.com/buy/browse/v1/item/${id}`;
      const itemResp = await fetch(itemUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplace,
          "Content-Type": "application/json",
        },
      });

      const itemJson = await itemResp.json();
      if (itemResp.ok && itemJson.title) {
        baseTitle = itemJson.title || "";
        baseBrand = itemJson.brand || "";
        basePrice = Number(itemJson.price?.value || 0);

        if (!q) {
          q = `${baseBrand ? baseBrand + " " : ""}${baseTitle}`;
        }
      } else {
        console.warn("⚠️ Failed to fetch base item for recommend:", itemJson);
      }
    }

    if (!q) {
      q = "vintage jacket";
    }

    const raw = await ebaySearch({
      q,
      country,
      extra: "&limit=200",
    });

    let items = (raw.itemSummaries || []).filter(isFashion);

    if (id) {
      items = items.filter(it => it.itemId !== id);
    }

    const baseWords = baseTitle
      ? baseTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      : [];

    const recommended = items.map(it => {
      const normalized = normalizeThriftItem(it);
      const priceVal = Number(it.price?.value || 0);

      let score = 0;

      if (
        baseBrand &&
        normalized.brand &&
        normalized.brand.toLowerCase() === baseBrand.toLowerCase()
      ) {
        score += 25;
      }

      if (basePrice > 0 && priceVal > 0) {
        const diff = Math.abs(priceVal - basePrice);
        const ratio = diff / basePrice;
        const priceScore = Math.max(0, 15 - ratio * 20);
        score += priceScore;
      }

      if (baseWords.length && normalized.title) {
        const titleWords = normalized.title.toLowerCase().split(/\s+/);
        let overlap = 0;
        baseWords.forEach(w => {
          if (titleWords.includes(w)) overlap++;
        });
        score += overlap * 2;
      }

      score += Math.random() * 3;

      return {
        ...normalized,
        recommend_score: Number(score.toFixed(2)),
      };
    });

    recommended.sort((a, b) => b.recommend_score - a.recommend_score);

    res.json({
      base: {
        id: id || null,
        query_used: q,
        base_title: baseTitle || null,
        base_brand: baseBrand || null,
        base_price: basePrice || null,
      },
      country,
      total_items: recommended.length,
      items: recommended.slice(0, Number(limit)),
    });
  } catch (e) {
    console.error("🔥 recommend error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send(
    "🔥 Thrift Fashion Backend v2 (Trending + Search + Lookup + Recommend) is running."
  );
});

// START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Thrift Fashion Backend v2 running on port ${PORT}`);
});
