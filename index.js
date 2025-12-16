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
// #region agent log
console.log("[DEBUG] index.js:29 - Before require chatRoutes");
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:29',message:'Before require chatRoutes',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion
let chatRoutes;
try {
  chatRoutes = require("./routes/chat");
  // #region agent log
  console.log("[DEBUG] index.js:33 - chatRoutes loaded successfully", { hasChatRoutes: !!chatRoutes, type: typeof chatRoutes });
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:33',message:'chatRoutes loaded successfully',data:{hasChatRoutes:!!chatRoutes,type:typeof chatRoutes},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
} catch (err) {
  // #region agent log
  console.error("[DEBUG] index.js:37 - Error loading chatRoutes", { error: err.message, stack: err.stack });
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:37',message:'Error loading chatRoutes',data:{error:err.message,stack:err.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.error("Failed to load chatRoutes:", err);
  chatRoutes = null;
}

app.use("/auth", authRoutes);
app.use("/ai", aiRoutes);
app.use("/user", userRoutes);
app.use("/workouts", workoutRoutes);
app.use("/profile", profileRoutes);
app.use("/exercises", exerciseRoutes);
app.use("/equipment", equipmentRoutes);
app.use("/metrics", userMetricsRoutes);
app.use("/locations", locationsRoutes);
// #region agent log
console.log("[DEBUG] index.js:50 - Before registering /chat route", { hasChatRoutes: !!chatRoutes });
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:50',message:'Before registering /chat route',data:{hasChatRoutes:!!chatRoutes},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
// #endregion
if (chatRoutes) {
  try {
    app.use("/chat", chatRoutes);
    // #region agent log
    console.log("[DEBUG] index.js:54 - /chat route registered successfully");
    fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:54',message:'/chat route registered successfully',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    // #region agent log
    console.error("[DEBUG] index.js:58 - Error registering /chat route", { error: err.message });
    fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:58',message:'Error registering /chat route',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error("Failed to register /chat route:", err);
  }
} else {
  // #region agent log
  console.warn("[DEBUG] index.js:63 - chatRoutes is null, skipping /chat route registration");
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:63',message:'chatRoutes is null, skipping /chat route registration',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  console.warn("chatRoutes is null, /chat route will not be available");
}

// DEFAULT
app.get("/", (req, res) => {
  res.json({ status: "RYTM0X API is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RYTM0X backend running on port ${PORT}`);
  // #region agent log
  console.log("[DEBUG] index.js:68 - Server started, listing all registered routes", { routes: ['/auth', '/ai', '/user', '/workouts', '/profile', '/exercises', '/equipment', '/metrics', '/locations', '/chat'], hasChatRoute: !!chatRoutes });
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:68',message:'Server started, listing all registered routes',data:{routes:['/auth','/ai','/user','/workouts','/profile','/exercises','/equipment','/metrics','/locations','/chat'],hasChatRoute:!!chatRoutes},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
});