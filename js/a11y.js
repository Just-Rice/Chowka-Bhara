/* Chowka-Bhara — accessibility settings.
 *
 * Four things, all remembered per browser and all reachable mid-game, because
 * discovering you need one of them usually happens while you are playing.
 *
 *   text     how large everything reads
 *   contrast a scrim over the board so the pieces stand off it
 *   motion   whether pieces slide and cowries tumble, or simply arrive
 *   messages whether passing notices clear themselves or wait to be dismissed
 *
 * Anything the operating system already asks for is honoured as the default, so
 * somebody who has set their machine up once does not have to set this up too.
 */
"use strict";

var A11Y = {
  defaults: { text: "normal", contrast: "off", motion: "full", messages: "auto" },
  settings: null,

  load: function () {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("chowka:a11y") || "{}"); } catch (e) {}

    var s = {};
    Object.keys(A11Y.defaults).forEach(function (k) {
      s[k] = saved[k] || A11Y.defaults[k];
    });

    // Fall in behind the operating system when nothing has been chosen here.
    if (!saved.contrast && window.matchMedia &&
        window.matchMedia("(prefers-contrast: more)").matches) s.contrast = "on";
    if (!saved.motion && window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) s.motion = "reduced";

    A11Y.settings = s;
    A11Y.apply();
    return s;
  },

  save: function () {
    try { localStorage.setItem("chowka:a11y", JSON.stringify(A11Y.settings)); } catch (e) {}
  },

  get: function (key) { return A11Y.settings[key]; },

  set: function (key, value) {
    if (A11Y.settings[key] === value) return;
    A11Y.settings[key] = value;
    A11Y.save();
    A11Y.apply();
  },

  /* Every font size in the stylesheets is in rem, so moving the root size
     moves all of them together and nothing has to be adjusted individually. */
  SCALE: { normal: "100%", large: "115%", largest: "132%" },

  apply: function () {
    var s = A11Y.settings;
    var root = document.documentElement;

    root.style.fontSize = A11Y.SCALE[s.text] || "100%";
    root.classList.toggle("hc", s.contrast === "on");
    root.classList.toggle("no-motion", s.motion === "reduced");

    // The game times its own animations, so tell it too rather than only
    // freezing them in CSS.
    if (typeof state !== "undefined" && state) {
      state.reducedMotion = s.motion === "reduced";
    }

    A11Y.syncControls();
  },

  syncControls: function () {
    Object.keys(A11Y.settings).forEach(function (key) {
      var chosen = A11Y.settings[key];
      var group = document.querySelectorAll('[data-a11y="' + key + '"] button');
      Array.prototype.forEach.call(group, function (b) {
        var on = b.getAttribute("data-value") === chosen;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    });
  },

  /* Build the rows from the table below so the markup and the behaviour cannot
     drift apart. */
  ROWS: [
    { key: "text", label: "a11y.text", hint: "a11y.textHint",
      options: [["normal", "a11y.textNormal"], ["large", "a11y.textLarge"], ["largest", "a11y.textLargest"]] },
    { key: "contrast", label: "a11y.contrast", hint: "a11y.contrastHint",
      options: [["off", "a11y.contrastOff"], ["on", "a11y.contrastOn"]] },
    { key: "motion", label: "a11y.motion", hint: "a11y.motionHint",
      options: [["full", "a11y.motionFull"], ["reduced", "a11y.motionReduced"]] },
    { key: "messages", label: "a11y.messages", hint: "a11y.messagesHint",
      options: [["auto", "a11y.messagesAuto"], ["stay", "a11y.messagesStay"]] }
  ],

  build: function () {
    var host = document.getElementById("a11y-rows");
    if (!host) return;
    host.innerHTML = "";

    A11Y.ROWS.forEach(function (row) {
      var wrap = document.createElement("div");
      wrap.className = "a11y-row";

      var head = document.createElement("div");
      head.className = "a11y-head";
      var label = document.createElement("span");
      label.className = "a11y-label";
      label.textContent = I18N.t(row.label);
      head.appendChild(label);
      wrap.appendChild(head);

      var hint = document.createElement("p");
      hint.className = "a11y-hint";
      hint.textContent = I18N.t(row.hint);
      wrap.appendChild(hint);

      var group = document.createElement("div");
      group.className = "a11y-options";
      group.setAttribute("data-a11y", row.key);
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", I18N.t(row.label));

      row.options.forEach(function (opt) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "a11y-opt";
        b.setAttribute("data-value", opt[0]);
        b.textContent = I18N.t(opt[1]);
        b.addEventListener("click", function () { A11Y.set(row.key, opt[0]); });
        group.appendChild(b);
      });

      wrap.appendChild(group);
      host.appendChild(wrap);
    });

    A11Y.syncControls();
  },

  open: function () {
    A11Y.build();
    document.getElementById("a11y-drawer").classList.remove("hidden");
  },

  close: function () {
    document.getElementById("a11y-drawer").classList.add("hidden");
  }
};
