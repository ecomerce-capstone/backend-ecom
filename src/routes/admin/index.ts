// -------------------------
// File: src/routes/admin/index.ts
// -------------------------

import express from "express";
import usersAdmin from "./users";
import vendorsAdmin from "./vendors";
import productsAdmin from "./products";
import ordersAdmin from "./orders";
import reportsAdmin from "./reports";
import seederAdmin from "./seeder";
import { authenticate, authorizeRole } from "../../middleware/auth";

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorizeRole("admin"));

router.use("/users", usersAdmin);
router.use("/vendors", vendorsAdmin);
router.use("/products", productsAdmin);
router.use("/orders", ordersAdmin);
router.use("/reports", reportsAdmin);
// Seeder should be protected additionally by NODE_ENV check inside the router
router.use("/seeder", seederAdmin);

export default router;
