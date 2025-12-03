require("dotenv").config({ override: true });
console.log("LOAD ENV:", process.env.OPENAI_API_KEY ? "OK" : "NOT FOUND");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// ROUTES
const aiRoutes = require("./routes/ai");
const userRoutes = require("./routes/user");

app.use("/ai", aiRoutes);
app.use("/user", userRoutes);

// DEFAULT
app.get("/", (req, res) => {
  res.json({ status: "RYTM0X API is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RYTM0X backend running on port ${PORT}`);
});