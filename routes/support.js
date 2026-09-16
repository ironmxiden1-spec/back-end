const express = require("express");
const router = express.Router();

router.post("/donate", async (req, res) => {
  try {
    const { reference, amount, email } = req.body || {};

    if (!reference || !amount || !email) {
      return res.status(400).json({ msg: "reference, amount, and email are required" });
    }

    return res.json({
      msg: "Donation recorded successfully",
      data: {
        reference,
        amount: Number(amount),
        email,
        status: "received"
      }
    });
  } catch (error) {
    console.error("SUPPORT DONATE ERROR:", error.message);
    return res.status(500).json({ msg: "Unable to record donation" });
  }
});

module.exports = router;
