const express = require("express");
const router = express.Router();
const locationController = require("../controllers/locationController");
const { authOptional } = require("../middleware/authMiddleware");

// Test route to verify router is working
router.get("/test", (req, res) => {
  res.json({ status: "locations router is working" });
});

// Location routes
router.get("/", authOptional, locationController.listLocations);
router.post("/", authOptional, locationController.createLocation);
router.put("/:id", authOptional, locationController.updateLocation);
router.put("/:id/activate", authOptional, locationController.activateLocation);
router.delete("/:id", authOptional, locationController.deleteLocation);

module.exports = router;

