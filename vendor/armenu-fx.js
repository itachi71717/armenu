/* ARMenu FX — tiny dependency-free effects library (React-Bits-inspired).
   window.ArmenuFX. Auto-inits from data-fx="..." on DOMContentLoaded.
   Call ArmenuFX.scan(root) after rendering new content dynamically.
   Every effect: no-op if elements missing, disabled under
   prefers-reduced-motion, cheap when unused. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  var coarsePointer = window.matchMedia
    ? window.matchMedia("(pointer: coarse)")
    : { matches: false };

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) {
      try { fn(list[i]); } catch (e) { /* never throw */ }
    }
  }

  var WEAK = typeof WeakSet !== "undefined" ? WeakSet : null;
  var initedSpotlight = WEAK ? new WEAK() : null;
  var initedMagnetic = WEAK ? new WEAK() : null;
  var initedTilt = WEAK ? new WEAK() : null;
  var initedCountup = WEAK ? new WEAK() : null;
  var revealObserver = null;

  function seen(set, el) {
    if (!set) return false;
    if (set.has(el)) return true;
    set.add(el);
    return false;
  }

  /* ---------------- spotlight ---------------- */
  function initSpotlight(root) {
    each(root.querySelectorAll('[data-fx="spotlight"]'), function (el) {
      if (seen(initedSpotlight, el)) return;
      el.addEventListener("pointermove", function (e) {
        if (coarsePointer.matches) return;
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (e.clientX - r.left) + "px");
        el.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
      el.addEventListener("pointerleave", function () {
        el.classList.remove("fx-active");
      });
      el.addEventListener("pointerenter", function () {
        el.classList.add("fx-active");
      });
    });
  }

  /* ---------------- reveal ---------------- */
  function initReveal(root) {
    var els = root.querySelectorAll('[data-fx="reveal"]:not(.fx-in)');
    if (!els.length) return;
    if (reduceMotion.matches || typeof IntersectionObserver === "undefined") {
      each(els, function (el) { el.classList.add("fx-in"); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var delay = el.getAttribute("data-fx-delay");
          if (delay) el.style.setProperty("--fx-delay", delay + "ms");
          el.classList.add("fx-in");
          obs.unobserve(el);
        });
      }, { threshold: 0.15 });
    }
    each(els, function (el) { revealObserver.observe(el); });
  }

  /* ---------------- countup ---------------- */
  function parseNum(str) {
    var m = String(str).match(/-?[\d,]*\.?\d+/);
    if (!m) return null;
    return parseFloat(m[0].replace(/,/g, ""));
  }

  function runCountup(el) {
    if (seen(initedCountup, el)) return;
    var target = parseNum(el.textContent);
    if (target === null || isNaN(target)) return;
    if (reduceMotion.matches) return; // leave final value as-is
    var original = el.textContent;
    var prefix = original.match(/^[^\d\-]*/)[0];
    var suffix = original.match(/[^\d]*$/)[0];
    var decimals = (original.split(".")[1] || "").replace(/\D/g, "").length;
    var duration = 900;
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = prefix + val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = original;
    }
    requestAnimationFrame(frame);
  }

  function initCountup(root) {
    var els = root.querySelectorAll('[data-fx="countup"]');
    if (!els.length) return;
    if (typeof IntersectionObserver === "undefined") {
      each(els, runCountup);
      return;
    }
    var obs = new IntersectionObserver(function (entries, o) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          runCountup(entry.target);
          o.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    each(els, function (el) { obs.observe(el); });
  }

  /* ---------------- magnetic ---------------- */
  function initMagnetic(root) {
    if (coarsePointer.matches || reduceMotion.matches) return;
    each(root.querySelectorAll('[data-fx="magnetic"]'), function (el) {
      if (seen(initedMagnetic, el)) return;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = "translate(" + (dx * 0.18).toFixed(1) + "px," + (dy * 0.28).toFixed(1) + "px)";
      });
      el.addEventListener("pointerleave", function () {
        el.style.transform = "translate(0,0)";
      });
    });
  }

  /* ---------------- tilt ---------------- */
  function initTilt(root) {
    if (coarsePointer.matches || reduceMotion.matches) return;
    each(root.querySelectorAll('[data-fx="tilt"]'), function (el) {
      if (seen(initedTilt, el)) return;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform =
          "perspective(600px) rotateX(" + (-py * 6).toFixed(2) + "deg) rotateY(" + (px * 6).toFixed(2) + "deg)";
      });
      el.addEventListener("pointerleave", function () {
        el.style.transform = "perspective(600px) rotateX(0) rotateY(0)";
      });
    });
  }

  /* ---------------- toast ---------------- */
  var toastHost = null;
  function getToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement("div");
    toastHost.className = "armenu-fx-toast-host";
    toastHost.setAttribute("aria-live", "polite");
    toastHost.setAttribute("aria-atomic", "true");
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function toast(msg, opts) {
    opts = opts || {};
    try {
      var host = getToastHost();
      var el = document.createElement("div");
      el.className = "armenu-fx-toast";
      el.setAttribute("role", "status");
      el.setAttribute("data-type", opts.type || "info");
      var dot = document.createElement("span");
      dot.className = "fx-dot";
      dot.setAttribute("aria-hidden", "true");
      var text = document.createElement("span");
      text.textContent = msg;
      el.appendChild(dot);
      el.appendChild(text);
      host.appendChild(el);
      var duration = opts.duration || 3200;
      setTimeout(function () {
        el.classList.add("fx-out");
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }, duration);
      return el;
    } catch (e) { return null; }
  }

  /* ---------------- scan / init ---------------- */
  function scan(root) {
    root = root || document;
    initSpotlight(root);
    initReveal(root);
    initCountup(root);
    initMagnetic(root);
    initTilt(root);
  }

  window.ArmenuFX = { scan: scan, toast: toast };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { scan(document); });
  } else {
    scan(document);
  }
})();
