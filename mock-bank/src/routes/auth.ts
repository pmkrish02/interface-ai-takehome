import { Router } from "express";
import { validCredentials } from "../fixtures";

const router = Router();

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === validCredentials.username &&
    password === validCredentials.password
  ) {
    if (req.session) {
      req.session.loggedIn = true;
    }
    res.redirect("/search");
    return;
  }

  res.render("login", { error: "Invalid username or password" });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.redirect("/login");
});

export default router;
