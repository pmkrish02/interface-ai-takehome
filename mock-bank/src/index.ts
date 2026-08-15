import express from "express";
import cookieSession from "cookie-session";
import path from "path";
import authRoutes from "./routes/auth";
import searchRoutes from "./routes/search";
import memberRoutes from "./routes/member";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: false }));
app.use(
  cookieSession({
    name: "session",
    keys: ["mock-bank-dev-secret"],
    maxAge: 24 * 60 * 60 * 1000,
  })
);

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.session || !req.session.loggedIn) {
    res.redirect("/login");
    return;
  }
  next();
}

app.use(authRoutes);
app.use("/search", requireAuth, searchRoutes);
app.use("/member", requireAuth, memberRoutes);

app.get("/", (_req, res) => {
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`mock-bank listening on http://localhost:${PORT}`);
});
