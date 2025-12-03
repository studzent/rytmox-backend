require("dotenv").config({ override: true });
const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === "") {
  console.error("❌ OPENAI_API_KEY is missing or empty");
  throw new Error("Missing OPENAI_API_KEY. Check .env file and dotenv config.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = openai;

