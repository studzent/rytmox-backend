const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "RYTMOX backend is working" });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`RYTMOX backend running on port ${PORT}`);
});