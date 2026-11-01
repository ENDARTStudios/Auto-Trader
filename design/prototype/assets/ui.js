/* ui.js — shared view helpers */
import { icon } from "./icons.js";

export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function badge(text, tone = "") {
  return `<span class="badge ${tone}">${text}</span>`;
}

export function delta(value, { dp = 2, suffix = "%", arrow = true, abs = false } = {}) {
  const n = Number(value);
  const tone = n > 0 ? "pos" : n < 0 ? "neg" : "muted";
  const ic = arrow
    ? icon(n >= 0 ? "arrowUpRight" : "arrowDownRight", { size: 12 })
    : "";
  const v = abs ? Math.abs(n) : n;
  return `<span class="delta ${tone}">${ic}${v > 0 && abs ? "+" : ""}${v.toFixed(dp)}${suffix}</span>`;
}

export function dot(tone = "", live = false) {
  return `<span class="dot ${tone} ${live ? "live" : ""}"></span>`;
}

export function assetIco(sym, color, cls = "") {
  return `<span class="asset-ico ${cls}" style="background:linear-gradient(145deg,${color},${color}99)">${sym.slice(0, 3)}</span>`;
}

export function assetCell(sym, name, color, sub = null) {
  return `<div class="asset">${assetIco(sym, color)}
    <div class="cell-stack"><span class="t-main">${sym}</span><span class="t-sub">${sub || name}</span></div>
  </div>`;
}

export function pageHead({ status = "", title, sub = "", actions = "" }) {
  return `<header class="page-head">
    <div>
      <div class="page-title-row">
        <h1 class="page-title">${title}</h1>
        ${status ? `<span class="page-status">${status}</span>` : ""}
      </div>
      ${sub ? `<p class="page-sub">${sub}</p>` : ""}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ""}
  </header>`;
}

export function card({ title = "", sub = "", actions = "", body = "", cls = "", headCls = "", padded = true }) {
  return `<section class="card ${cls}">
    ${title || actions ? `<div class="card-hd ${headCls}">
      <div><div class="card-title">${title}</div>${sub ? `<div class="card-sub">${sub}</div>` : ""}</div>
      ${actions}</div>` : ""}
    ${body ? `<div class="${padded ? "card-body" : ""}">${body}</div>` : ""}
  </section>`;
}

export function kpi({ label, value, foot = "", tone = "", cls = "", tip = "" }) {
  return `<div class="kpi ${cls}" ${tip ? `data-tip="${tip}"` : ""}>
    <div class="kpi-label">${label}</div>
    <div class="kpi-value ${tone}">${value}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

export function empty({ iconName = "compass", title, desc = "", actions = "", cls = "" }) {
  return `<div class="empty ${cls}">
    <svg class="empty-art" viewBox="0 0 120 88" fill="none" aria-hidden="true">
      <rect x="12" y="16" width="96" height="56" rx="8" stroke="currentColor" stroke-opacity=".28" stroke-dasharray="4 5"/>
      <path d="M30 54l14-14 10 10 16-20 12 14" stroke="currentColor" stroke-opacity=".5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="60" cy="44" r="20" stroke="currentColor" stroke-opacity=".16"/>
    </svg>
    <h3>${title}</h3>
    ${desc ? `<p>${desc}</p>` : ""}
    ${actions ? `<div class="empty-actions">${actions}</div>` : ""}
  </div>`;
}

export function meter(pct, tone = "", label = "Progress") {
  const p = Math.min(100, Math.max(0, pct));
  return `<div class="meter ${tone}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"><span style="--p:${(p / 100).toFixed(3)}"></span></div>`;
}

export function tabs(items, active) {
  return `<div class="tabs" role="tablist">${items
    .map(
      (t) =>
        `<button class="tab" role="tab" aria-selected="${t === active}">${t}${
          t === active ? "" : ""
        }</button>`
    )
    .join("")}</div>`;
}

export function segmented(items, active) {
  return `<div class="segmented">${items
    .map((t) => `<button aria-pressed="${t === active}">${t}</button>`)
    .join("")}</div>`;
}

export function gate(name, value, state = "ok") {
  const ic = state === "ok" ? "checkCircle" : state === "block" ? "xCircle" : "clock";
  return `<div class="gate ${state === "ok" ? "" : state}">${icon(ic, { size: 14 })}<span>${name}</span><span class="g-val">${value}</span></div>`;
}

export function avatar(initials, size = 30) {
  return `<span class="asset-ico" style="width:${size}px;height:${size}px;border-radius:50%;background:var(--surface-3);color:var(--text-2);font-size:${size / 3}px">${initials}</span>`;
}

export const icons = icon;
