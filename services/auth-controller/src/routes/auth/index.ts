import { Router, type Router as ExpressRouter } from "express";
import loginRoute from "./login/index.js";
import signupRoute from "./isgnup/index.js";

const appRouter: ExpressRouter = Router();

appRouter.use("/login", loginRoute);
appRouter.use("/signup", signupRoute);

appRouter.get("/health", (req, res) => {
  res.status(200).json({ message: "All Good !!!" });
});

export default appRouter;
