require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const IMG_KEYWORDS = {
  "דיפלומטיה": "diplomacy summit meeting",
  "
