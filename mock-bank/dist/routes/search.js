"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fixtures_1 = require("../fixtures");
const router = (0, express_1.Router)();
router.get("/", (req, res) => {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    res.render("search", { error });
});
router.post("/", (req, res) => {
    const memberId = (req.body.memberId || "").trim();
    if (fixtures_1.members[memberId]) {
        res.redirect(`/member/${memberId}`);
        return;
    }
    res.redirect(`/search?error=not_found`);
});
exports.default = router;
