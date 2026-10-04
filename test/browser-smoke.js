/* Opens the real page in a headless browser, at a phone size and a desktop
 * size, and fails on any console error, any sideways scroll, or any control
 * left without a name. Unlike the other suites this needs Node and
 * Playwright, so it is run on its own rather than from run.sh:
 *
 *   node test/browser-smoke.js                  # serves this checkout
 *   URL=https://just-rice.github.io/Chowka-Bhara/ node test/browser-smoke.js
 */
var http = require("http");
var fs = require("fs");
var path = require("path");
var chromium = require("playwright").chromium;

var ROOT = path.join(__dirname, "..");
var TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
              ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };

var VIEWPORTS = {
  phone:   { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  desktop: { viewport: { width: 1366, height: 900 } }
};

function serve() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (file.endsWith(path.sep)) file = path.join(file, "index.html");
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, function (err, body) {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

/* Runs in the page: sideways overflow, and focusable things with no name. */
function inspect() {
  var unnamed = [];
  document.querySelectorAll("button, input, [role=button], [role=tab]").forEach(function (e) {
    if (!e.getClientRects().length || e.closest(".hidden, [hidden]")) return;
    if (e.type === "radio") return;  // named by their visible <label for>
    var name = e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") ||
               (e.labels && e.labels.length) || (e.tagName !== "INPUT" && e.textContent.trim());
    if (!name) unnamed.push(e.id || e.className);
  });
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unnamed: unnamed
  };
}

(async function () {
  var server = process.env.URL ? null : await serve();
  var url = process.env.URL || "http://127.0.0.1:" + server.address().port + "/";
  var browser = await chromium.launch();
  var fails = [];

  for (var name of Object.keys(VIEWPORTS)) {
    var ctx = await browser.newContext(VIEWPORTS[name]);
    var page = await ctx.newPage();
    var errors = [];
    page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", function (e) { errors.push(String(e)); });

    await page.goto(url);
    await page.waitForSelector("#begin-btn:not(:empty)");
    var steps = [
      ["setup", null],
      ["join tab", "#tab-join"],
      ["host tab", "#tab-host"],
      ["settings", "#a11y-btn-setup"],
      ["game", async function () { await page.click("#a11y-close"); await page.click("#tab-local"); await page.click("#begin-btn"); }],
      ["thrown", "#roll-btn"],
      ["how to play", "#howto-btn"]
    ];
    for (var step of steps) {
      if (typeof step[1] === "string") await page.click(step[1]);
      else if (step[1]) await step[1]();
      await page.waitForTimeout(600);
      var r = await page.evaluate(inspect);
      if (r.overflow > 0) fails.push(name + " / " + step[0] + ": scrolls sideways by " + r.overflow + "px");
      if (r.unnamed.length) fails.push(name + " / " + step[0] + ": no accessible name on " + r.unnamed.join(", "));
    }
    errors.forEach(function (e) { fails.push(name + ": console error — " + e); });
    console.log((errors.length ? "❌ " : "✅ ") + name + " " + VIEWPORTS[name].viewport.width + "x" +
                VIEWPORTS[name].viewport.height + ": " + errors.length + " console errors");
    await ctx.close();
  }

  await browser.close();
  if (server) server.close();
  fails.forEach(function (f) { console.log("❌ " + f); });
  console.log(fails.length ? "\nsmoke test failed" : "\nsmoke test clean");
  process.exit(fails.length ? 1 : 0);
})();
