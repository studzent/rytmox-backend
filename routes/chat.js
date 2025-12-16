const express = require("express");
const router = express.Router();
// #region agent log
console.log("[DEBUG] routes/chat.js:3 - Loading chatController");
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:3',message:'Loading chatController',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
// #endregion
let chatController;
try {
  chatController = require("../controllers/chatController");
  // #region agent log
  console.log("[DEBUG] routes/chat.js:8 - chatController loaded", { hasSendMessage: !!chatController.sendMessage, hasGetThread: !!chatController.getThread });
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:8',message:'chatController loaded',data:{hasSendMessage:!!chatController.sendMessage,hasGetThread:!!chatController.getThread},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
} catch (err) {
  // #region agent log
  console.error("[DEBUG] routes/chat.js:12 - Error loading chatController", { error: err.message });
  fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:12',message:'Error loading chatController',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  console.error("Failed to load chatController:", err);
  throw err;
}
const { authOptional } = require("../middleware/authMiddleware");

// Chat routes
// #region agent log
console.log("[DEBUG] routes/chat.js:20 - Registering POST /send route", { hasSendMessage: !!chatController.sendMessage });
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:20',message:'Registering POST /send route',data:{hasSendMessage:!!chatController.sendMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
// #endregion
router.post("/send", authOptional, chatController.sendMessage);
// #region agent log
console.log("[DEBUG] routes/chat.js:22 - Registering GET /thread/:threadId route", { hasGetThread: !!chatController.getThread });
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:22',message:'Registering GET /thread/:threadId route',data:{hasGetThread:!!chatController.getThread},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
// #endregion
router.get("/thread/:threadId", authOptional, chatController.getThread);

// #region agent log
console.log("[DEBUG] routes/chat.js:26 - Exporting router", { routerType: typeof router });
fetch('http://127.0.0.1:7242/ingest/86651f4e-7edb-4c82-8bb6-6d7d57651902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/chat.js:26',message:'Exporting router',data:{routerType:typeof router},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
// #endregion
module.exports = router;


