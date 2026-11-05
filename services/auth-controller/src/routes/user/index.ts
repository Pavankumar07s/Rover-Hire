import { Router, type Router as ExpressRouter } from "express";
import { requireUserDetails } from "../../middlewares/require-user-details.js";

const userRouter: ExpressRouter = Router();

userRouter.post("/details", requireUserDetails, (req, res) => {
  return res.status(200).json({ user: res.locals.user });
});

export default userRouter;
