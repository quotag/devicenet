/* @ds-bundle: {"format":4,"namespace":"DeviceNet","components":[{"name":"Button"},{"name":"Chip"},{"name":"Switch"},{"name":"Slider"},{"name":"SegmentedTabs"},{"name":"Card"},{"name":"Sheet"},{"name":"Banner"},{"name":"Badge"},{"name":"Input"},{"name":"Stepper"},{"name":"DeviceTile"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() { return Array.prototype.slice.call(arguments).filter(Boolean).join(" "); }

  function Spinner(props) {
    return h("span", { className: cx("dn-spin", props && props.className), "aria-hidden": "true" });
  }

  /* Button — variant: primary | secondary | ghost | danger; block; loading; disabled */
  function Button(p) {
    var variant = p.variant || "primary";
    var rest = Object.assign({}, p);
    delete rest.variant; delete rest.block; delete rest.loading; delete rest.className; delete rest.children;
    return h("button", Object.assign({
      type: p.type || "button",
      className: cx("dn-btn", "dn-btn-" + variant, p.block && "dn-btn-block", p.loading && "dn-btn-loading", p.className),
      "aria-busy": p.loading ? "true" : undefined,
      disabled: p.disabled
    }, rest), p.loading ? h(Spinner) : null, p.children);
  }

  /* Chip — selected; add (dashed, để thêm room) */
  function Chip(p) {
    var rest = Object.assign({}, p);
    delete rest.selected; delete rest.add; delete rest.className; delete rest.children;
    return h("button", Object.assign({
      type: "button",
      className: cx("dn-chip", p.selected && "dn-chip-selected", p.add && "dn-chip-add", p.className),
      "aria-pressed": p.add ? undefined : (p.selected ? "true" : "false")
    }, rest), p.add ? "+ " : null, p.children);
  }

  /* Switch — checked; pending (spinner 16 trong núm); disabled; onChange(next) */
  function Switch(p) {
    return h("button", {
      type: "button",
      role: "switch",
      "aria-checked": p.checked ? "true" : "false",
      "aria-busy": p.pending ? "true" : undefined,
      "aria-label": p.label,
      className: cx("dn-switch", p.pending && "dn-switch-pending", p.className),
      disabled: p.disabled || p.pending,
      onClick: function () { if (p.onChange) p.onChange(!p.checked); }
    }, h("span", { className: "dn-switch-knob" }, p.pending ? h(Spinner) : null));
  }

  /* Slider — value, min, max, step, unit; pending; disabled; readOnly; onChange(n) */
  function Slider(p) {
    var min = p.min == null ? 0 : p.min, max = p.max == null ? 100 : p.max;
    var value = p.value == null ? min : p.value;
    return h("div", {
      className: cx("dn-slider", p.disabled && "dn-slider-disabled", p.pending && "dn-slider-pending", p.readOnly && "dn-slider-readonly", p.className)
    },
      h("input", {
        type: "range", min: min, max: max, step: p.step || 1, value: value,
        disabled: p.disabled, "aria-label": p.label, "aria-busy": p.pending ? "true" : undefined,
        readOnly: p.readOnly,
        onChange: function (e) { if (!p.readOnly && p.onChange) p.onChange(Number(e.target.value)); }
      }),
      h("span", { className: "dn-slider-box dn-num" }, p.pending ? h(Spinner, { className: "dn-spin" }) : String(value), p.unit ? h("small", null, p.unit) : null)
    );
  }

  /* SegmentedTabs — items: string[]; value: index; onChange(index) */
  function SegmentedTabs(p) {
    var items = p.items || [];
    var value = p.value || 0;
    return h("div", { role: "tablist", className: cx("dn-seg", p.className) },
      items.map(function (label, i) {
        return h("button", {
          key: i, type: "button", role: "tab", "aria-selected": i === value ? "true" : "false",
          className: "dn-seg-item",
          onClick: function () { if (p.onChange) p.onChange(i); }
        }, label);
      }));
  }

  /* Card — title; action (node góc phải); state: default | empty | invalid; error (dòng lỗi); on (nền on-tint); highlight */
  function Card(p) {
    var state = p.state || "default";
    return h("section", {
      className: cx("dn-card", state === "empty" && "dn-card-empty", state === "invalid" && "dn-card-invalid", p.on && "dn-card-on", p.highlight && "dn-card-highlight", p.className)
    },
      (p.title || p.action) ? h("header", { className: "dn-card-head" },
        h("span", { className: "dn-card-title" }, p.title),
        p.action || null) : null,
      h("div", { className: "dn-card-body" }, p.children),
      p.error ? h("div", { className: "dn-card-error", role: "alert" }, p.error) : null
    );
  }

  /* IconButton — nút tròn 32 (vùng chạm 44) cho + ở góc card/header */
  function IconButton(p) {
    return h("button", { type: "button", className: cx("dn-iconbtn", p.className), "aria-label": p.label, onClick: p.onClick }, p.children || "+");
  }

  /* Sheet — bottom sheet tĩnh: handle, title, children. items: [{label, onClick}] vẽ danh sách hàng 44 */
  function Sheet(p) {
    return h("div", { role: "dialog", "aria-modal": "true", "aria-label": p.title, className: cx("dn-sheet", p.className) },
      h("div", { className: "dn-sheet-handle", "aria-hidden": "true" }),
      p.title ? h("h2", { className: "dn-sheet-title" }, p.title) : null,
      p.items ? p.items.map(function (it, i) {
        return h("button", { key: i, type: "button", className: "dn-sheet-item dn-btn-reset", onClick: it.onClick, style: { width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "var(--border-w) solid var(--border)", color: "var(--text)", padding: 0, cursor: "pointer" } }, it.label);
      }) : null,
      p.children ? h("div", { className: "dn-sheet-body" }, p.children) : null
    );
  }

  /* Banner — kind: offline | lan | reconnecting | error | neutral; action, onAction */
  function Banner(p) {
    var kind = p.kind || "neutral";
    return h("div", { role: "status", className: cx("dn-banner", "dn-banner-" + kind, p.className) },
      kind === "reconnecting" ? h(Spinner) : h("span", { className: "dn-banner-dot", "aria-hidden": "true" }),
      h("span", { className: "dn-banner-text" }, p.children),
      p.action ? h("button", { type: "button", className: "dn-banner-action", onClick: p.onAction }, p.action) : null
    );
  }

  /* Badge — tone: neutral | new | ok | error | syncing; plain (không chấm) */
  function Badge(p) {
    var tone = p.tone || "neutral";
    return h("span", { className: cx("dn-badge", "dn-badge-" + tone, p.plain && "dn-badge-plain", p.className) }, p.children);
  }

  /* Input — label, value, placeholder, unit, hint, invalid, disabled, shake, inputMode, onChange(string) */
  function Input(p) {
    var id = p.id || ("dn-in-" + Math.random().toString(36).slice(2, 8));
    return h("label", { className: cx("dn-field", p.invalid && "dn-field-invalid", p.disabled && "dn-field-disabled", p.className), htmlFor: id },
      p.label ? h("span", { className: "dn-field-label" }, p.label) : null,
      h("span", { className: cx("dn-input", p.invalid && "dn-input-invalid", p.shake && "dn-shake") },
        h("input", {
          id: id, value: p.value, defaultValue: p.defaultValue, placeholder: p.placeholder, disabled: p.disabled,
          inputMode: p.inputMode, type: p.type || "text", "aria-invalid": p.invalid ? "true" : undefined,
          onChange: function (e) { if (p.onChange) p.onChange(e.target.value); }
        }),
        p.unit ? h("span", { className: "dn-input-unit" }, p.unit) : null),
      p.hint ? h("span", { className: "dn-field-hint" }, p.hint) : null
    );
  }

  /* Stepper — steps: string[]; current: index (0-based) */
  function Stepper(p) {
    var steps = p.steps || [];
    var current = p.current || 0;
    return h("ol", { className: cx("dn-stepper", p.className), "aria-label": p.label || "Các bước" },
      steps.map(function (label, i) {
        var state = i < current ? "done" : (i === current ? "current" : "upcoming");
        return h("li", { key: i, className: "dn-step dn-step-" + state, "aria-current": state === "current" ? "step" : undefined },
          h("span", { className: "dn-step-dot" }, state === "done" ? "✓" : String(i + 1)),
          h("span", { className: "dn-step-label" }, label),
          h("span", { className: "dn-step-line", "aria-hidden": "true" }));
      }));
  }


  /* DeviceTile — size: "1x1" | "2x1"; kind: switch | sensor | mixed; on, pending, offline, arranging, highlight;
     name, room (chỉ khi filter = Tất cả), value, unit, lastSeen, extras: [{value, unit}], icon (node), onToggle(next) */
  function DeviceTile(p) {
    var kind = p.kind || "switch";
    var size = p.size || "1x1";
    var hasToggle = kind !== "sensor";
    var mainValue, mainUnit = p.unit;
    if (p.offline) { mainValue = "Offline"; mainUnit = null; }
    else if (kind === "switch") { mainValue = p.on ? "Bật" : "Tắt"; mainUnit = null; }
    else { mainValue = p.value == null ? "–" : String(p.value); }
    var tileOn = !p.offline && (kind === "sensor" ? false : !!p.on);
    var sub = p.offline ? ("lần cuối " + (p.lastSeen || "–")) : (p.room || null);
    return h("div", {
      className: cx("dn-tile", "dn-tile-" + size, tileOn && "dn-tile-on", p.offline && "dn-tile-offline", p.arranging && "dn-tile-arranging", p.highlight && "dn-tile-highlight", p.className),
      role: "group", "aria-label": p.name
    },
      h("div", { className: "dn-tile-main" },
        h("div", { className: "dn-tile-row1" },
          h("span", { className: "dn-tile-icon", "aria-hidden": "true" }, p.icon || null),
          h("span", { className: cx("dn-tile-dot", p.offline ? "dn-tile-dot-off" : "dn-tile-dot-on"), title: p.offline ? "Offline" : "Online" })),
        h("div", { className: "dn-tile-value dn-num" }, mainValue, mainUnit ? h("span", { className: "dn-tile-unit" }, " ", mainUnit) : null),
        h("div", { className: "dn-tile-name" }, p.name),
        sub ? h("div", { className: "dn-tile-room" }, sub) : null),
      size === "2x1" ? h("div", { className: "dn-tile-side" },
        (p.extras || []).slice(0, 2).map(function (x, i) {
          return h("div", { key: i, className: "dn-tile-extra dn-num" }, String(x.value), x.unit ? h("span", { className: "dn-tile-unit" }, " ", x.unit) : null);
        })) : null,
      hasToggle && !p.offline && !p.arranging ? h("div", { className: "dn-tile-toggle" },
        h(Switch, { checked: !!p.on, pending: p.pending, label: (p.on ? "Tắt " : "Bật ") + p.name, onChange: p.onToggle })) : null,
      p.arranging ? h("span", { className: "dn-tile-handle", "aria-hidden": "true" }) : null
    );
  }

  var ns = window.DeviceNet || (window.DeviceNet = {});
  Object.assign(ns, {
    Button: Button, Chip: Chip, Switch: Switch, Slider: Slider, SegmentedTabs: SegmentedTabs,
    Card: Card, IconButton: IconButton, Sheet: Sheet, Banner: Banner, Badge: Badge, Input: Input, Stepper: Stepper, DeviceTile: DeviceTile, Spinner: Spinner
  });
})();
