import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// ENV VARIABLES
// ================================
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN;

// ================================
// ACCESS TOKEN STORAGE
// ================================
let ACCESS_TOKEN = null;
let EXPIRES_AT = 0;

// ================================
// GENERATE ACCESS TOKEN
// ================================
async function generateAccessToken() {
  try {
    console.log("🔄 Refreshing eBay Access Token...");

    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      scope: "https://api.ebay.com/oauth/api_scope"
    });

    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const json = await response.json();

    if (json.access_token) {
      ACCESS_TOKEN = json.access_token;
      EXPIRES_AT = Date.now() + (json.expires_in - 60) * 1000; // refresh 1 min earlier

      console.log("✔ Access Token refreshed successfully.");
    } else {
      console.log("❌ Failed to refresh token:", json);
    }

  } catch (err) {
    console.log("🔥 ERROR refresh token:", err.message);
  }
}

// ================================
// TOKEN CHECKER (AUTO REFRESH)
// ================================
async function getAccessToken() {
  if (!ACCESS_TOKEN || Date.now() >= EXPIRES_AT) {
    await generateAccessToken();
  }
  return ACCESS_TOKEN;
}

// ================================
// MARKETPLACE MAP
// ================================
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

// ================================
// NORMALIZER
// ================================
function normalize(item) {
  return {
    id: item.itemId,
    title: item.title,
    price: item.price?.value || null,
    currency: item.price?.currency || null,
    image: item.thumbnailImages?.[0]?.imageUrl || null,
    condition: item.condition,
    brand: item.brand,
    popularity_score: Number(item.watchCount || 0),
    url: item.itemWebUrl,
    categories: item.categories || []
  };
}

// ================================
// FASHION CATEGORIES
// ================================
const FASHION_CAT = [
  "11450", // Clothing, Shoes & Accessories
  "15724", // Men's Shoes
  "3034",  // Women's Bags
  "169291", // Vintage Clothing
  "24087", // Streetwear
  "57988"  // Sneakers
];

// ================================
// ENDPOINT: THRIFT POPULAR
// ================================
app.get("/thrift-popular", async (req, res) => {
  try {
    const country = req.query.country || "US";
    const q = req.query.q || "vintage";
    const marketplace = mapCountry(country);

    const keywords = `${q} thrift fashion vintage y2k streetwear`;
    const accessToken = await getAccessToken();

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?
      q=${encodeURIComponent(keywords)}
      &category_ids=${FASHION_CAT.join(",")}
      &sort=BEST_MATCH
      &limit=20`.replace(/\s+/g, "");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace
      }
    });

    const json = await response.json();
    const items = json.itemSummaries || [];

    const popularOnly = items
      .filter(i => Number(i.watchCount || 0) > 5)
      .map(normalize);

    res.json({
      query_used: q,
      total_items: popularOnly.length,
      country,
      marketplace,
      items: popularOnly
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================
// ROOT
// ================================
app.get("/", (req, res) => {
  res.send("🔥 Thrift Fashion Backend with Auto Token Refresh is running.");
});

// ================================
// START SERVER
// ================================
app.listen(PORT, async () => {
  console.log(`🚀 Server ready on port ${PORT}`);
  await generateAccessToken(); // Refresh token at startup
});
