/* ARMenu CmdK — dependency-free command palette. window.ArmenuCmdK.
   ArmenuCmdK.register([{id,label,hint,keywords,run}]) then Ctrl/Cmd+K
   toggles, or call ArmenuCmdK.open()/.close(). Injects its own <style>
   once. Dark warm theme, mobile full-width sheet, focus trapped. */
(function () {
  "use strict";

  var STYLE_ID = "armenu-cmdk-style";
  var commands = [];
  var root = null, panel = null, input = null, list = null;
  var activeIndex = 0;
  var filtered = [];
  var lastFocused = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      ".armenu-cmdk-overlay{position:fixed;inset:0;z-index:100000;",
      "background:rgba(10,8,6,0.6);backdrop-filter:blur(4px);",
      "-webkit-backdrop-filter:blur(4px);display:flex;align-items:flex-start;",
      "justify-content:center;padding:12vh 16px 0;opacity:0;pointer-events:none;",
      "transition:opacity 0.15s ease-out;}",
      ".armenu-cmdk-overlay.on{opacity:1;pointer-events:auto;}",
      ".armenu-cmdk-panel{width:100%;max-width:560px;background:#14100b;",
      "border:1px solid rgba(232,197,138,0.22);border-radius:14px;",
      "box-shadow:0 30px 80px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.03) inset;",
      "overflow:hidden;transform:translateY(-8px) scale(0.98);opacity:0;",
      "transition:transform 0.16s cubic-bezier(.2,.7,.3,1),opacity 0.16s ease-out;",
      "font-family:inherit;color:#f5ecd8;}",
      ".armenu-cmdk-overlay.on .armenu-cmdk-panel{transform:translateY(0) scale(1);opacity:1;}",
      ".armenu-cmdk-input-wrap{display:flex;align-items:center;gap:10px;",
      "padding:14px 16px;border-bottom:1px solid rgba(245,236,216,0.08);}",
      ".armenu-cmdk-input-wrap svg{flex:none;opacity:0.6;}",
      ".armenu-cmdk-input{flex:1;background:none;border:none;outline:none;",
      "color:#f5ecd8;font-size:15px;font-family:inherit;}",
      ".armenu-cmdk-input::placeholder{color:rgba(245,236,216,0.4);}",
      ".armenu-cmdk-kbd{font-size:10.5px;color:rgba(245,236,216,0.45);",
      "border:1px solid rgba(245,236,216,0.18);border-radius:5px;padding:2px 6px;",
      "font-family:ui-monospace,monospace;}",
      ".armenu-cmdk-list{max-height:52vh;overflow-y:auto;padding:6px;}",
      ".armenu-cmdk-empty{padding:28px 16px;text-align:center;",
      "color:rgba(245,236,216,0.5);font-size:13px;}",
      ".armenu-cmdk-item{display:flex;align-items:center;justify-content:space-between;",
      "gap:12px;padding:10px 12px;border-radius:9px;cursor:pointer;",
      "font-size:13.5px;color:#f5ecd8;}",
      ".armenu-cmdk-item .lbl{font-weight:600;}",
      ".armenu-cmdk-item .hint{font-size:11.5px;color:rgba(245,236,216,0.45);}",
      ".armenu-cmdk-item.active{background:linear-gradient(135deg,rgba(255,87,34,0.18),rgba(232,197,138,0.1));",
      "box-shadow:0 0 0 1px rgba(232,197,138,0.25) inset;}",
      "@media(max-width:560px){",
      ".armenu-cmdk-overlay{padding:0;align-items:flex-end;}",
      ".armenu-cmdk-panel{max-width:100%;border-radius:16px 16px 0 0;",
      "max-height:80vh;display:flex;flex-direction:column;}",
      ".armenu-cmdk-list{max-height:none;flex:1;}",
      "}",
      "@media(prefers-reduced-motion:reduce){",
      ".armenu-cmdk-overlay,.armenu-cmdk-panel{transition:none!important;}",
      "}"
    ].join("");
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildDom() {
    if (root) return;
    root = document.createElement("div");
    root.className = "armenu-cmdk-overlay";
    root.setAttribute("role", "presentation");

    panel = document.createElement("div");
    panel.className = "armenu-cmdk-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Command palette");

    var inputWrap = document.createElement("div");
    inputWrap.className = "armenu-cmdk-input-wrap";
    inputWrap.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    input = document.createElement("input");
    input.className = "armenu-cmdk-input";
    input.type = "text";
    input.placeholder = "Type a command…";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "armenu-cmdk-list");
    inputWrap.appendChild(input);

    var kbd = document.createElement("span");
    kbd.className = "armenu-cmdk-kbd";
    kbd.textContent = "Esc";
    inputWrap.appendChild(kbd);

    list = document.createElement("div");
    list.className = "armenu-cmdk-list";
    list.id = "armenu-cmdk-list";
    list.setAttribute("role", "listbox");

    panel.appendChild(inputWrap);
    panel.appendChild(list);
    root.appendChild(panel);
    document.body.appendChild(root);

    root.addEventListener("mousedown", function (e) {
      if (e.target === root) close();
    });
    input.addEventListener("input", function () { render(); });
    input.addEventListener("keydown", onKeydown);
    document.addEventListener("keydown", trapFocus, true);
  }

  function fuzzyScore(text, query) {
    text = text.toLowerCase();
    query = query.toLowerCase();
    if (!query) return 0;
    if (text.indexOf(query) !== -1) return 100 - text.indexOf(query);
    var ti = 0, score = 0;
    for (var qi = 0; qi < query.length; qi++) {
      var found = text.indexOf(query[qi], ti);
      if (found === -1) return -1;
      score += 10 - Math.min(9, found - ti);
      ti = found + 1;
    }
    return score;
  }

  function matchCommand(cmd, query) {
    if (!query) return 0;
    var hay = [cmd.label, cmd.hint, (cmd.keywords || []).join(" ")].join(" ");
    return fuzzyScore(hay, query);
  }

  function render() {
    var q = input.value.trim();
    var scored = commands.map(function (c) {
      return { cmd: c, score: matchCommand(c, q) };
    }).filter(function (s) { return q === "" || s.score >= 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    filtered = scored.map(function (s) { return s.cmd; });
    activeIndex = 0;
    list.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "armenu-cmdk-empty";
      empty.textContent = "No matching commands";
      list.appendChild(empty);
      return;
    }
    filtered.forEach(function (cmd, i) {
      var item = document.createElement("div");
      item.className = "armenu-cmdk-item" + (i === 0 ? " active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", i === 0 ? "true" : "false");
      item.dataset.idx = String(i);
      var lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = cmd.label;
      item.appendChild(lbl);
      if (cmd.hint) {
        var hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = cmd.hint;
        item.appendChild(hint);
      }
      item.addEventListener("mouseenter", function () { setActive(i); });
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        runActive();
      });
      list.appendChild(item);
    });
  }

  function setActive(i) {
    activeIndex = i;
    var items = list.querySelectorAll(".armenu-cmdk-item");
    items.forEach(function (el, idx) {
      el.classList.toggle("active", idx === i);
      el.setAttribute("aria-selected", idx === i ? "true" : "false");
    });
    if (items[i]) items[i].scrollIntoView({ block: "nearest" });
  }

  function runActive() {
    var cmd = filtered[activeIndex];
    if (!cmd) return;
    close();
    try { cmd.run && cmd.run(); } catch (e) { /* never throw */ }
  }

  function onKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length) setActive((activeIndex + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length) setActive((activeIndex - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function trapFocus(e) {
    if (!root || !root.classList.contains("on")) return;
    if (e.key !== "Tab") return;
    var focusables = panel.querySelectorAll("input, [tabindex]:not([tabindex='-1'])");
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function open() {
    injectStyle();
    buildDom();
    lastFocused = document.activeElement;
    root.classList.add("on");
    input.value = "";
    render();
    setTimeout(function () { input.focus(); }, 0);
  }

  function close() {
    if (!root) return;
    root.classList.remove("on");
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) {}
    }
  }

  function isOpen() {
    return !!(root && root.classList.contains("on"));
  }

  function register(cmds) {
    if (!Array.isArray(cmds)) return;
    cmds.forEach(function (c) {
      if (c && c.id && c.run) commands.push(c);
    });
  }

  document.addEventListener("keydown", function (e) {
    var isK = (e.key === "k" || e.key === "K");
    if (isK && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });

  window.ArmenuCmdK = {
    register: register,
    open: open,
    close: close,
    isOpen: isOpen
  };
})();
