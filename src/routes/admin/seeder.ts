// -------------------------
// File: src/routes/admin/seeder.ts
// -------------------------

import express from "express";

const router = express.Router();

// Dev-only: run seed script (ensure NODE_ENV=development)
router.post("/run", async (req, res) => {
  try {
    if (process.env.NODE_ENV !== "development") {
      return res
        .status(403)
        .json({ error: "Seeder can only be run in development environment" });
    }
    // You can call seeder logic here or spawn a process to run your TS seeder
    // e.g., call a function from seed module: await runSeeds();
    res.json({
      ok: true,
      note: "Seeder endpoint placeholder - implement seeder runner",
    });
  } catch (err: any) {
    console.error("admin/seeder run error", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
