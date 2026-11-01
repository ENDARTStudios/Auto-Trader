/* pages/index.js — route registry */
import { overview } from "./overview.js";
import { markets, token } from "./markets.js";
import { portfolio, position } from "./portfolio.js";
import { strategy } from "./strategy.js";
import { backtest } from "./backtest.js";
import { analytics } from "./analytics.js";
import { journal } from "./journal.js";
import { risk } from "./risk.js";
import { copilot } from "./copilot.js";
import { alerts, data, settings, billing, admin } from "./ops.js";
import { landing, login, signup, reset, onboarding } from "./public.js";
import { design } from "./design.js";
import { icon } from "../icons.js";
import { pageHead, card } from "../ui.js";

const stub = (title, crumb) => ({
  title,
  crumb,
  html: () =>
    pageHead({ title, sub: "This screen is being finalised." }) +
    card({ body: `<div class="empty"><h3>Wiring in progress</h3><p>The concept for ${title} is documented in design/docs/03-PAGES.md.</p></div>` }),
});

export const routes = {
  overview,
  markets,
  token,
  portfolio,
  position,
  strategy,
  backtest,
  analytics,
  journal,
  risk,
  copilot,
  alerts,
  data,
  settings,
  billing,
  admin,
  landing,
  login,
  signup,
  reset,
  onboarding,
  design,
  notfound: {
    title: "Not found",
    crumb: ["System", "404"],
    html: () =>
      `<div style="min-height:60vh;display:grid;place-items:center">${card({
        body: `<div class="empty"><h3>Page not found</h3><p>The route you tried does not exist in this concept.</p><div class="empty-actions"><a class="btn btn-primary" href="#/overview">Back to overview</a></div></div>`,
      })}</div>`,
  },
};
