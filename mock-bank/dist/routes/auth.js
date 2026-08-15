"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fixtures_1 = require("../fixtures");
const router = (0, express_1.Router)();
router.get("/login", (req, res) => {
    res.render("login", { error: null });
});
router.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username === fixtures_1.validCredentials.username &&
        password === fixtures_1.validCredentials.password) {
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
exports.default = router;
