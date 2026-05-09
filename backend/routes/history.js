"use strict";

const express = require("express");

const router = express.Router();

router.get("/history", (req, res) => {
  res.status(501).json({ success: false, error: "Not implemented yet" });
});

module.exports = router;
