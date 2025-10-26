import express from "express";
import dotenv from "dotenv";
import authRoutes from "./routes/auth"; //route authentication
import userRoutes from "./routes/users"; //route users
import categoriesRouter from "./routes/categories";
import vendorsRouter from "./routes/vendors";
import productReviewsRouter from "./routes/productReviews";
import ordersRouter from "./routes/orders";
import paymentsRouter from "./routes/payments";
import bannersRouter from "./routes/banners";
import recomonddationRoutes from "./routes/recommendations";
import cartRoutes from "./routes/cart";
import "./lib/db"; //initialize db connection
import { authenticate, authorizeRole } from "./middleware/auth";

dotenv.config();
const app = express();
app.use(express.json()); //utk support json body
//routes
app.use(authenticate, authorizeRole("admin")); /// all admin children require admin
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/categories", categoriesRouter);
app.use("/vendors", vendorsRouter);
app.use("/", productReviewsRouter);
app.use("/orders", ordersRouter);
app.use("/", paymentsRouter);
app.use("/banners", bannersRouter);
app.use("/recommendations", recomonddationRoutes);
app.use("/cart", cartRoutes);

//health check
app.get("/", (req, res) =>
  res.json({ ok: true, message: "MVP Multivendor API" })
);

const port = Number(process.env.PORT || 4000);
app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`)
);
