const router = require("express").Router();
const equipmentController = require("../controllers/equipmentController");

router.get("/", equipmentController.listEquipment);

module.exports = router;

