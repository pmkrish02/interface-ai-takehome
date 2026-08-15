"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cookie_session_1 = __importDefault(require("cookie-session"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const search_1 = __importDefault(require("./routes/search"));
const member_1 = __importDefault(require("./routes/member"));
const app = (0, express_1.default)();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.set("view engine", "ejs");
app.set("views", path_1.default.join(__dirname, "..", "views"));
app.use(express_1.default.urlencoded({ extended: false }));
app.use((0, cookie_session_1.default)({
    name: "session",
    keys: ["mock-bank-dev-secret"],
    maxAge: 24 * 60 * 60 * 1000,
}));
function requireAuth(req, res, next) {
    if (!req.session || !req.session.loggedIn) {
        res.redirect("/login");
        return;
    }
    next();
}
app.use(auth_1.default);
app.use("/search", requireAuth, search_1.default);
app.use("/member", requireAuth, member_1.default);
app.get("/", (_req, res) => {
    res.redirect("/login");
});
app.listen(PORT, () => {
    console.log(`mock-bank listening on http://localhost:${PORT}`);
});
