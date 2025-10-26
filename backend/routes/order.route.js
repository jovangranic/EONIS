import express from "express";
import Order from "../models/order.model.js";
// import protect from "../middleware/auth.js";
// import isAdmin from "../middleware/admin.js";

const router = express.Router();

// GET /api/orders/completed
// Returns only completed orders (admin usage)
router.get("/completed", async (req, res) => {
  try {
    // Temporarily remove status filter to show all orders
    const orders = await Order.find()
      .populate("user", "name email")
      .populate("products.product", "name")  // Add this to get product names
      .sort({ createdAt: -1 })
      .lean();
    
    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("GET /api/orders/completed:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/orders/all
// Returns all orders (admin)
router.get("/all", /* protect, isAdmin, */ async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("GET /api/orders/all:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;