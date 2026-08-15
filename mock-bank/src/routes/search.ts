import { Router } from "express";
import { members } from "../fixtures";

const router = Router();

router.get("/", (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  res.render("search", { error });
});

router.post("/", (req, res) => {
  const memberId = (req.body.memberId || "").trim();

  if (members[memberId]) {
    res.redirect(`/member/${memberId}`);
    return;
  }

  res.redirect(`/search?error=not_found`);
});

export default router;
