require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const REGIONS = [
  { id: "all", query: "top 5 geopolitical news world today" },
  { id: "mideast", query: "top 5 geopolitical news Middle East Israel today" },
  { id: "europe", query: "top 5 geopolitical news Europe Ukraine Russia today" },
  { id: "asia", query: "top 5 geopolitical news Asia China Taiwan today" },
  { id: "americas", query: "top 5 geopolitical news USA Americas today" },
];

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("").trim();
}

async function refreshRegion(region) {
  console.log("Refreshing: " + region.id);
  var newsRaw = await callClaude(
    "Return ONLY a valid JSON array of 5 news objects. No markdown. Each object: { title: Hebrew headline, source: news source, urgency: high or medium or low, emoji: one emoji, region: Hebrew region name, lat: number, lng: number, summary: 2 sentences Hebrew, tag: one of diplomacy security military economy politics }",
    "Top 5 geopolitical news: " + region.query
  );
  var news = [];
  try { news = JSON.parse(newsRaw.trim()); } catch(e) {}
  if (!Array.isArray(news) || news.length === 0) {
    console.log("Parse failed for " + region.id);
    return;
  }
  var headlines = news.map(function(n, i) { return (i+1) + ". " + n.title; }).join("\n");
  var analysis = await callClaude(
    "Write 2 paragraphs geopolitical analysis in Hebrew. No headers.",
    "Headlines:\n" + headlines
  );
  var urgencyCount = { high: 0, medium: 0, low: 0 };
  var tagCount = {};
  news.forEach(function(n) {
    urgencyCount[n.urgency] = (urgencyCount[n.urgency] || 0) + 1;
    tagCount[n.tag] = (tagCount[n.tag] || 0) + 1;
  });
  await supabase.from("geowatch_feeds").upsert({
    region_id: region.id,
    news: news,
    analysis: analysis,
    urgency_count: urgencyCount,
    tag_count: tagCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "region_id" });
  console.log("Done: " + region.id);
}

async function refreshAll() {
  console.log("Starting refresh...");
  for (var i = 0; i < REGIONS.length; i++) {
    try {
      await refreshRegion(REGIONS[i]);
      await new Promise(function(r) { setTimeout(r, 2000); });
    } catch(e) {
      console.log("Error: " + e.message);
    }
  }
  console.log("Refresh complete.");
}

cron.schedule("0 * * * *", refreshAll);

app.get("/api/news/:regionId", async function(req, res) {
  try {
    var result = await supabase.from("geowatch_feeds").select("*").eq("region_id", req.params.regionId).single();
    if (result.error) return res.status(404).json({ error: "Not found" });
    res.json(result.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/news", async function(req, res) {
  try {
    var result = await supabase.from("geowatch_feeds").select("*").order("updated_at", { ascending: false });
    if (result.error) throw result.error;
    res.json(result.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async function(req, res) {
  var result = await supabase.from("geowatch_feeds").select("region_id, updated_at");
  res.json({ status: "ok", time: new Date().toISOString(), regions: result.data || [] });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("GeoWatch running on port " + PORT);
  refreshAll();
});
