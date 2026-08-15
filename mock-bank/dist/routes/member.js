"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fixtures_1 = require("../fixtures");
const router = (0, express_1.Router)();
router.get("/:id", (req, res) => {
    const { id } = req.params;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error === "server") {
        res.status(500).send("Internal Server Error");
        return;
    }
    if (error === "permission") {
        res.render("member", {
            member: null,
            error: "permission",
            memberId: id,
        });
        return;
    }
    const member = fixtures_1.members[id];
    const respond = () => {
        if (error === "slow") {
            setTimeout(() => {
                res.render("member", {
                    member: member || null,
                    error: member ? null : "not_found",
                    memberId: id,
                });
            }, 3000);
            return;
        }
        res.render("member", {
            member: member || null,
            error: member ? null : "not_found",
            memberId: id,
        });
    };
    respond();
});
router.get("/:id/sub-account", (req, res) => {
    const { id } = req.params;
    const member = fixtures_1.members[id];
    if (!member) {
        res.render("member", { member: null, error: "not_found", memberId: id });
        return;
    }
    res.render("sub-account", { member, error: null });
});
router.post("/:id/sub-account", (req, res) => {
    const { id } = req.params;
    const member = fixtures_1.members[id];
    if (!member) {
        res.render("member", { member: null, error: "not_found", memberId: id });
        return;
    }
    const { subAccountType, openingDeposit } = req.body;
    if (req.session) {
        req.session.pendingSubAccount = {
            memberId: id,
            subAccountType,
            openingDeposit,
        };
    }
    res.redirect(`/member/${id}/sub-account/confirm`);
});
router.get("/:id/sub-account/confirm", (req, res) => {
    const { id } = req.params;
    const member = fixtures_1.members[id];
    const pending = req.session ? req.session.pendingSubAccount : null;
    if (!member || !pending || pending.memberId !== id) {
        res.redirect(`/member/${id}/sub-account`);
        return;
    }
    res.render("sub-account-confirm", { member, pending });
});
router.post("/:id/sub-account/confirm", (req, res) => {
    const { id } = req.params;
    const member = fixtures_1.members[id];
    const pending = req.session ? req.session.pendingSubAccount : null;
    if (!member || !pending || pending.memberId !== id) {
        res.redirect(`/member/${id}/sub-account`);
        return;
    }
    if (req.session) {
        req.session.pendingSubAccount = null;
    }
    res.render("sub-account-success", { member, pending });
});
exports.default = router;
