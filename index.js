require("dotenv").config({ override: true });
console.log("LOAD ENV:", process.env.OPENAI_API_KEY ? "OK" : "NOT FOUND");

// Проверка обязательных переменных окружения
if (!process.env.JWT_SECRET) {
  console.error("ERROR: JWT_SECRET is not set in environment variables");
  console.error("Please set JWT_SECRET in your .env file");
  process.exit(1);
}

const express = require("express");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// ROUTES
const authRoutes = require("./routes/auth");
const aiRoutes = require("./routes/ai");
const userRoutes = require("./routes/user");
const workoutRoutes = require("./routes/workouts");
const profileRoutes = require("./routes/profile");
const exerciseRoutes = require("./routes/exercises");
const equipmentRoutes = require("./routes/equipment");
const userMetricsRoutes = require("./routes/userMetrics");
const locationsRoutes = require("./routes/locations");
const chatRoutes = require("./routes/chat");

app.use("/auth", authRoutes);
app.use("/ai", aiRoutes);
app.use("/user", userRoutes);
app.use("/workouts", workoutRoutes);
app.use("/profile", profileRoutes);
app.use("/exercises", exerciseRoutes);
app.use("/equipment", equipmentRoutes);
app.use("/metrics", userMetricsRoutes);
app.use("/locations", locationsRoutes);
app.use("/chat", chatRoutes);

// DEFAULT
app.get("/", (req, res) => {
  res.json({ status: "RYTM0X API is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RYTM0X backend running on port ${PORT}`);
});