require("dotenv").config();
var express = require("express");
var cors = require("cors");
var cron = require("node-cron");
var fetch = require("node-fetch");
var supabase = require("@supabase/supabase-js").createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

var app = express();
app.use(cors());
app.use(express.json());

var NEWS_API_KEY = process.env.NEWS_API_KEY;

var REGIONS = [
  { id: "all",      q: "geopolitics war diplomacy",        label: "הכל" },
  { id: "mideast",  q: "Israel Iran Gaza Middle East",     label: "מזה״ת" },
  { id: "europe",   q: "Ukraine Russia NATO Europe",       label: "אירופה" },
  { id: "asia",     q: "China Taiwan Korea Asia",          label: "אסיה" },
  { id: "americas", q: "USA Trump Americas foreign policy",label: "אמריקה" },
];

var ANALYSIS = {
  all:      "העולם נמצא בנקודת מפנה גיאופוליטית: מספר מוקדי מתח פעילים בו-זמנית יוצרים לחץ על המעצמות הגדולות.\n\nהדינמיקה המרכזית היא התחרות בין ארה״ב, סין ורוסיה על עיצוב הסדר העולמי החדש.",
  mideast:  "המזרח התיכון עובר תמורות עמוקות: מצד אחד לחץ צבאי ומדיני על איראן, מצד שני ניסיונות נרמול בין ישראל ומדינות ערב.\n\nהשאלה המרכזית היא האם יתגבש סדר אזורי חדש או שהאזור יישאר בחוסר יציבות כרוני.",
  europe:   "אירופה מתעוררת מעשורים של שינה ביטחונית. המלחמה באוקראינה שינתה את חישובי הביטחון של כל מדינות הברית.\n\nנאט״ו מתחזק, גרמניה מתחמשת, ופוטין מגלה שהחישובים שלו היו שגויים.",
  asia:     "המתח סביב טייוואן הוא הניצוץ המסוכן ביותר כרגע. סין בוחנת את גבולות הסבולת האמריקאית.\n\nיפן וקוריאה מגיבות בהגברת ההוצאות הביטחוניות — האזור נכנס למרוץ חימוש שקט.",
  americas: "ארה״ב תחת טראמפ מנהלת מדיניות חוץ של עסקות — כל ברית נשקלת מחדש.\n\nבעלות הברית מתחילות להסתמך פחות על וושינגטון ולבנות יכולות עצמאיות.",
};

async function fetchNews(region) {
  var url = "https://newsapi.org/v2/everything?q=" + encodeURIComponent(region.q) +
    "&language=en&sortBy=publishedAt&pageSize=5&apiKey=" + NEWS_API_KEY;
  var res = await fetch(url);
  var data = await res.json();
  if (!data.articles) return [];
  return data.articles.slice(0, 5).map(function(a, i) {
    var urgency = i === 0 ? "high" : i < 3 ? "medium" : "low";
    var emojis = ["🌍","⚔️","🕊️","📊","🗳️","💥","🤝","🚨","🪖","📉"];
    return {
      title: a.title ? a.title.substring(0, 80) : "Breaking News",
      source: a.source ? a.source.name : "Reuters",
      urgency: urgency,
      emoji: emojis[i % emojis.length],
      region: region.label,
      lat: 0,
      lng: 0,
      summary: a.description ? a.description.substring(0, 200) : a.title,
      tag: i % 2 === 0 ? "ביטחון" : "דיפלומטיה",
      img: a.urlToImage || "",
      url: a.url || "",
    };
  });
}

async function refreshRegion(region) {
  console.log("Refreshing: " + region.id);
  var news = await fetchNews(region);
  if (news.length === 0) { console.log("No news for " + region.id); return; }
  var urgencyCount = { high: 0, medium: 0, low: 0 };
  var tagCount = {};
  news.forEach(function(n) {
    urgencyCount[n.urgency] = (urgencyCount[n.urgency] || 0) + 1;
    tagCount[n.tag] = (tagCount[n.tag] || 0) + 1;
  });
  await supabase.from("geowatch_feeds").upsert({
    region_id: region.id,
    news: news,
    analysis: ANALYSIS[region.id] || ANALYSIS.all,
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
      await new Promise(function(r) { setTimeout(r, 1000); });
    } catch(e) {
      console.log("Error " + REGIONS[i].id + ": " + e.message);
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
