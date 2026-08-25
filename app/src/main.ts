import QRCode from "qrcode";
import type { Address } from "viem";
import { isAddress, getAddress } from "viem";
import "./styles.css";
import { Weir, hasWallet, NotInNimiqPayError, UnsupportedChainError } from "./chain";
import type { RouteView, VaultView, Share, ActivityItem } from "./chain";
import { BPS_TOTAL } from "./config";
import { t, initLanguage } from "./i18n";
import {
  connectNimiq,
  sendNimSplit,
  formatNim,
  parseNim,
  isNimiqAddress,
  normaliseNimiqAddress,
  planNimSplit,
  type NimiqSession,
  type NimSplitRow,
} from "./nimiq";

/** Where this mini app is hosted. Used to build the Nimiq Pay deeplink. */
const APP_HOST = window.location.host;
const DEEPLINK = `https://nimpay.app/miniapps/open/${APP_HOST}`;

type Tab = "link" | "activity" | "splits" | "savings";

interface State {
  phase: "boot" | "welcome" | "setup" | "ready" | "error";
  tab: Tab;
  error: string | null;
  busy: string | null;
  weir: Weir | null;
  route: RouteView | null;
  vault: VaultView | null;
  payingMe: RouteView[];
  pendingMine: bigint;
  activity: ActivityItem[];
  activityLoaded: boolean;
  qr: string | null;
  /** Draft state for the setup screen. */
  draft: { preset: "self" | "team"; savePct: number; months: number; goal: string; team: Share[] };
  /** Whether the savings tab is showing the extend-the-lock panel. */
  extending: boolean;
  /** The Nimiq side. Null until connected, and null forever outside Nimiq Pay. */
  nimiq: NimiqSession | null;
  /** Nimiq address for each EVM recipient, entered by the route owner. */
  nimAddresses: Record<string, string>;
  nimAmount: string;
  nimEditing: boolean;
  nimProgress: { index: number; total: number } | null;
  nimResult: { sent: NimSplitRow[]; failed: { row: NimSplitRow; reason: string }[] } | null;
}

const state: State = {
  phase: "boot",
  tab: "link",
  error: null,
  busy: null,
  weir: null,
  route: null,
  vault: null,
  payingMe: [],
  pendingMine: 0n,
  activity: [],
  activityLoaded: false,
  qr: null,
  draft: { preset: "self", savePct: 20, months: 3, goal: "", team: [] },
  extending: false,
  nimiq: null,
  nimAddresses: {},
  nimAmount: "",
  nimEditing: false,
  nimProgress: null,
  nimResult: null,
};

const root = document.getElementById("app")!;

// --- helpers ---

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const PALETTE = ["#e9b213", "#21bca5", "#0582ca", "#fc8702", "#d94432", "#a866d6"];

function toast(message: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 1900);
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    // Clipboard is often blocked in a WebView without a user gesture chain.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(`${what} copied`);
    } catch {
      toast("Could not copy, long press to select");
    }
    ta.remove();
  }
}

async function share(text: string, url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch {
      /* user dismissed, fall through to copy */
    }
  }
  await copy(url, "Link");
}

function humanDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Nimiq addresses for teammates live on this device only.
 *
 * They are not on chain: putting them there would mean a contract change and a
 * separate registration step for every teammate, to serve the narrower case of
 * a team that is paid in NIM. The owner types them once instead, and re-types
 * them on a new device.
 */
function loadNimAddresses(routeAddress: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`weir.nim.${routeAddress.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveNimAddresses(routeAddress: string, map: Record<string, string>) {
  try {
    localStorage.setItem(`weir.nim.${routeAddress.toLowerCase()}`, JSON.stringify(map));
  } catch {
    /* private mode, or storage disabled. The session still works. */
  }
}

function daysUntil(ts: number) {
  return Math.max(0, Math.ceil((ts * 1000 - Date.now()) / 86_400_000));
}

/** yyyy-mm-dd in local time, which is what <input type="date"> expects. */
function dateInputValue(ts: number) {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- data loading ---

async function refresh() {
  const w = state.weir;
  if (!w) return;

  const [mine, paying, vaults] = await Promise.all([w.myRoutes(), w.routesPayingMe(), w.myVaults()]);

  state.route = mine.length ? await w.readRoute(mine[mine.length - 1]) : null;
  state.vault = vaults.length ? await w.readVault(vaults[vaults.length - 1]) : null;

  // Routes that pay me but that I do not own: the teammate view.
  const others = paying.filter((r) => !mine.some((m) => m.toLowerCase() === r.toLowerCase()));
  state.payingMe = await Promise.all(others.map((r) => w.readRoute(r)));

  // Anything a failed transfer left owed to me across those routes.
  const pendings = await Promise.all(
    [...(state.route ? [state.route.address] : []), ...others].map((r) => w.pendingFor(r, w.account)),
  );
  state.pendingMine = pendings.reduce((a, b) => a + b, 0n);

  state.qr = state.route
    ? await QRCode.toDataURL(state.route.address, { margin: 0, width: 360, color: { dark: "#1f2348", light: "#ffffff" } })
    : null;

  // Scanning logs is the slowest thing here, so never let it hold up the
  // balances. It fills in and re-renders on its own.
  const routeAddresses = [
    ...(state.route ? [state.route.address] : []),
    ...state.payingMe.map((r) => r.address),
  ];
  const vaultAddresses = state.vault ? [state.vault.address] : [];
  void w
    .readActivity({ routes: routeAddresses, vaults: vaultAddresses })
    .then((items) => {
      state.activity = items;
      state.activityLoaded = true;
      if (state.phase === "ready") render();
    })
    .catch(() => {
      state.activityLoaded = true;
    });

  // Being paid by someone else's route is reason enough to have a home screen.
  // Sending a teammate into a setup wizard when money is already waiting for
  // them is the fastest way to lose them.
  if (!state.route && state.payingMe.length > 0) {
    state.phase = "ready";
    state.tab = "splits";
    return;
  }
  state.phase = state.route ? "ready" : "setup";
}

// --- screens ---

function chrome(body: string, opts: { tabs?: boolean } = {}) {
  const w = state.weir;
  const chainPill = w ? `<div class="chain">${esc(w.chain.name)} · ${esc(w.token.symbol)}</div>` : "";
  return `
    <header class="topbar">
      <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#262a52"/>
        <path d="M6 11h20M6 16h20M6 21h20" stroke="#e9b213" stroke-width="2.6" stroke-linecap="round"/>
      </svg>
      <div class="wordmark">Weir</div>
      ${chainPill}
    </header>
    <main>${body}</main>
    ${opts.tabs ? tabbar() : ""}
  `;
}

function tabbar() {
  const item = (id: Tab, label: string, path: string) => `
    <button data-tab="${id}" aria-selected="${state.tab === id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">${path}</svg>
      ${label}
    </button>`;

  return `<nav class="tabbar">
    ${item("link", t("Get paid"), '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>')}
    ${item("activity", t("Activity"), '<path d="M3 12h4l3 8 4-16 3 8h4"/>')}
    ${item("splits", t("Splits"), '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}
    ${item("savings", t("Savings"), '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')}
  </nav>`;
}

function welcomeScreen() {
  const noWallet = !hasWallet();
  return chrome(`
    <h1>${t("Rules for the money you get paid.")}</h1>
    <p class="lede">
      ${t("Give a client one address. The moment they pay, it splits between your team and puts a slice into savings you cannot raid on a bad day.")}
    </p>

    ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}

    ${
      noWallet
        ? `<div class="notice info">
             ${t("Weir runs inside Nimiq Pay. Open this page there to connect your wallet.")}
           </div>
           <button class="btn" data-act="open-deeplink">${t("Open in Nimiq Pay")}</button>`
        : `<button class="btn" data-act="connect">${
            state.busy === "connect" ? `<span class="spinner"></span> ${t("Connecting")}` : t("Connect wallet")
          }</button>`
    }

    <h2>${t("How it works")}</h2>
    <div class="card flat">
      <div class="recipient"><span class="dot" style="background:#e9b213"></span>
        <div class="who"><div class="name">${t("You get an address")}</div>
        <div class="label">${t("Share it like any wallet address")}</div></div></div>
      <div class="recipient"><span class="dot" style="background:#21bca5"></span>
        <div class="who"><div class="name">${t("A client pays it")}</div>
        <div class="label">${t("From any wallet or exchange, no app needed")}</div></div></div>
      <div class="recipient"><span class="dot" style="background:#0582ca"></span>
        <div class="who"><div class="name">${t("It splits on arrival")}</div>
        <div class="label">${t("Everyone paid, your slice already saved")}</div></div></div>
    </div>
  `);
}

function setupScreen() {
  const d = state.draft;
  const teamTotal = d.team.reduce((a, s) => a + s.bps, 0);

  const selfPane = `
    <div class="card">
      <label class="field">
        <span class="label">${t("Save this much of every payment")}</span>
        <input type="number" id="savePct" min="1" max="99" value="${d.savePct}" inputmode="numeric" />
      </label>
      <label class="field">
        <span class="label">${t("Lock it for")}</span>
        <input type="number" id="months" min="1" max="60" value="${d.months}" inputmode="numeric" />
        <span class="label" style="margin-top:6px;display:block">${t("months. You can extend later, never shorten.")}</span>
      </label>
      <label class="field">
        <span class="label">${t("What is it for (optional)")}</span>
        <input type="text" id="goal" maxlength="60" placeholder="${t("Rainy day")}" value="${esc(d.goal)}" />
      </label>
      <div class="splitbar">
        <span style="width:${100 - d.savePct}%;background:#e9b213"></span>
        <span style="width:${d.savePct}%;background:#21bca5"></span>
      </div>
      <div class="row spread">
        <span class="label">${100 - d.savePct}% to spend</span>
        <span class="label">${d.savePct}% saved</span>
      </div>
    </div>
    <button class="btn" data-act="create-self" ${state.busy ? "disabled" : ""}>
      ${state.busy === "create" ? `<span class="spinner"></span> ${t("Creating")}` : t("Create my pay address")}
    </button>`;

  const teamRows = d.team
    .map(
      (s, i) => `
    <div class="row" style="margin-bottom:10px">
      <input class="mono grow" type="text" data-team-addr="${i}" placeholder="0x…"
             value="${esc(s.account)}" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <input type="number" data-team-bps="${i}" style="width:78px" min="1" max="100"
             inputmode="numeric" value="${Math.round(s.bps / 100)}" />
      <button class="btn ghost" style="width:auto;min-height:44px;padding:0 10px" data-act="rm-team" data-i="${i}">✕</button>
    </div>`,
    )
    .join("");

  const teamPane = `
    <div class="card">
      ${teamRows || '<p class="label">${t("Add everyone who should get a cut, including yourself.")}</p>'}
      <button class="btn secondary" data-act="add-team">${t("Add someone")}</button>
      <div class="row spread" style="margin-top:14px">
        <span class="label">${t("Total")}</span>
        <span class="pill ${teamTotal === BPS_TOTAL ? "good" : "warn"}">${teamTotal / 100}%</span>
      </div>
    </div>
    <button class="btn" data-act="create-team" ${teamTotal !== BPS_TOTAL || state.busy ? "disabled" : ""}>
      ${state.busy === "create" ? `<span class="spinner"></span> ${t("Creating")}` : t("Create our pay address")}
    </button>`;

  return chrome(`
    <h1>${t("How should money arrive?")}</h1>
    <p class="lede">${t("You can change this any time.")}</p>

    ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}

    <button class="preset" data-preset="self" aria-pressed="${d.preset === "self"}">
      <div class="title">${t("Pay myself first")}</div>
      <div class="sub">${t("Every payment lands with a slice already put away")}</div>
    </button>
    <button class="preset" data-preset="team" aria-pressed="${d.preset === "team"}">
      <div class="title">${t("Split with my team")}</div>
      <div class="sub">${t("One client payment, everyone paid at once")}</div>
    </button>

    ${d.preset === "self" ? selfPane : teamPane}
  `);
}

function linkTab() {
  const w = state.weir!;
  const r = state.route;

  if (!r) {
    return `
      <h1>${t("Get paid your way")}</h1>
      <p class="lede">
        ${t("You are being paid through someone else's split. Set up your own address and you can be paid directly too, with a slice saved automatically.")}
      </p>
      <button class="btn" data-act="new-route">${t("Create my pay address")}</button>`;
  }

  const waiting = r.waiting > 0n;

  return `
    <h1>${t("Your pay address")}</h1>
    <p class="lede">${t("Give this to a client like any other wallet address.")}</p>

    ${state.qr ? `<div class="qr"><img src="${state.qr}" alt="QR code for your pay address" /></div>` : ""}

    <div class="card">
      <div class="label">${esc(t("On {chain}, for {token}", { chain: w.chain.name, token: w.token.symbol }))}</div>
      <div class="addr" style="margin:8px 0 14px">${esc(r.address)}</div>
      <button class="btn" data-act="copy-addr">${t("Copy address")}</button>
      <button class="btn secondary" data-act="share-addr">${t("Share")}</button>
    </div>

    ${
      state.nimiq
        ? `<h2>${t("Or pay me in NIM")}</h2>
           <div class="card">
             <div class="label">${t("On Nimiq, paid straight to your wallet")}</div>
             <div class="addr" style="margin:8px 0 14px">${esc(state.nimiq.address)}</div>
             <button class="btn secondary" data-act="copy-nim">${t("Copy Nimiq address")}</button>
           </div>`
        : ""
    }

    ${
      waiting
        ? `<div class="card">
             <div class="label">${t("Waiting to be split")}</div>
             <div class="amount">${w.format(r.waiting)}<span class="unit">${esc(w.token.symbol)}</span></div>
             <button class="btn" style="margin-top:14px" data-act="distribute" ${state.busy ? "disabled" : ""}>
               ${state.busy === "distribute" ? `<span class="spinner"></span> ${t("Releasing")}` : t("Release now")}
             </button>
             <p class="label" style="margin:12px 0 0">
               ${t("This normally happens by itself within a minute. The button is here so you never have to wait on us.")}
             </p>
           </div>`
        : `<div class="card flat">
             <div class="row spread">
               <span class="label">${t("Nothing waiting")}</span>
               <span class="pill good">${t("Ready")}</span>
             </div>
           </div>`
    }

    ${
      state.pendingMine > 0n
        ? `<div class="card">
             <div class="label">${t("Set aside for you after a failed transfer")}</div>
             <div class="amount">${w.format(state.pendingMine)}<span class="unit">${esc(w.token.symbol)}</span></div>
             <button class="btn" style="margin-top:14px" data-act="claim" ${state.busy ? "disabled" : ""}>
               ${state.busy === "claim" ? `<span class="spinner"></span> ${t("Claiming")}` : t("Claim it")}
             </button>
           </div>`
        : ""
    }

    <h2>${t("Bring your team in")}</h2>
    <div class="card">
      <p style="margin-bottom:14px">
        ${t("Anyone you split with can open Weir and watch their share land.")}
      </p>
      <button class="btn secondary" data-act="invite">${t("Invite teammates")}</button>
    </div>
  `;
}

function relativeTime(ts?: number) {
  if (!ts) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (secs < 60) return t("just now");
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function activityTab() {
  const w = state.weir!;

  if (!state.activityLoaded) {
    return `
      <h1>${t("Activity")}</h1>
      <div class="centered"><div class="spinner"></div><div>${t("Reading the chain")}</div></div>`;
  }

  if (!state.activity.length) {
    return `
      <h1>${t("Activity")}</h1>
      <div class="empty">
        <div class="big">〰</div>
        <p>${t("Nothing yet. As soon as someone pays your address, every split shows up here.")}</p>
      </div>`;
  }

  const meLower = w.account.toLowerCase();
  const vaultLower = state.vault?.address.toLowerCase();

  const rows = state.activity
    .map((a) => {
      const to = a.counterparty?.toLowerCase();
      const isMe = to === meLower;
      const isVault = to === vaultLower;

      let title: string;
      let colour: string;

      switch (a.kind) {
        case "split":
          title = t("Payment arrived and was split");
          colour = "var(--nq-gold)";
          break;
        case "received":
          title = isMe ? t("Paid to you") : isVault ? t("Into your savings") : `${t("Paid to you")}: ${short(a.counterparty ?? "")}`;
          colour = isVault ? "var(--nq-green)" : isMe ? "var(--nq-green)" : "var(--nq-blue-raised)";
          break;
        case "deferred":
          title = `Set aside for ${isMe ? "you" : short(a.counterparty ?? "")}, transfer failed`;
          colour = "var(--nq-red)";
          break;
        case "claimed":
          title = isMe ? "You claimed a set-aside share" : `${short(a.counterparty ?? "")} claimed theirs`;
          colour = "var(--nq-green)";
          break;
        case "withdrawn":
          title = t("Withdrawn from savings");
          colour = "var(--nq-orange)";
          break;
        case "relocked":
          title = a.detail ? `${t("Lock it for longer")}: ${humanDate(a.detail)}` : t("Savings locked for longer");
          colour = "var(--nq-blue)";
          break;
      }

      return `
        <div class="recipient">
          <span class="dot" style="background:${colour}"></span>
          <div class="who">
            <div class="name">${esc(title)}</div>
            <div class="label">${esc(relativeTime(a.timestamp))}</div>
          </div>
          <div class="pct">${a.hasAmount ? w.format(a.amount) : ""}</div>
        </div>`;
    })
    .join("");

  // A split emits one Distributed plus one Paid per recipient, so the same
  // money legitimately appears more than once. Say so rather than let it look
  // like double counting.
  return `
    <h1>${t("Activity")}</h1>
    <p class="lede">${t("Everything that has moved through your addresses.")}</p>
    <div class="card">${rows}</div>
    <div class="card flat">
      <p style="margin:0" class="label">
        ${t("A single payment shows as one arrival plus one line per person paid, so the same money appears more than once on purpose.")}
      </p>
    </div>`;
}

function nimSection() {
  const r = state.route;
  const n = state.nimiq;

  if (!n) {
    return `
      <h2>NIM</h2>
      <div class="card flat">
        <p style="margin:0" class="label">
          ${esc(t("Open Weir inside Nimiq Pay to split NIM as well as {token}.", { token: state.weir!.token.symbol }))}
        </p>
      </div>`;
  }

  if (!r) return "";

  const shares = r.shares;
  const mapped = shares.map((s) => ({
    evm: s.account,
    bps: s.bps,
    nim: state.nimAddresses[s.account.toLowerCase()] ?? "",
  }));
  const missing = mapped.filter((m) => !isNimiqAddress(m.nim));

  const balanceLine =
    n.balanceLunas !== null
      ? `<div class="row spread"><span class="label">${t("Your NIM")}</span><span class="pct">${formatNim(n.balanceLunas)} NIM</span></div>`
      : `<div class="label">${t("Nimiq Pay does not expose a balance to mini apps, so enter the amount yourself.")}</div>`;

  // The honest caveat. USDT is enforced by a contract; this is not, and saying
  // otherwise would be a lie the user only discovers when it matters.
  const caveat = `
    <div class="card flat">
      <p style="margin:0" class="label">
        ${esc(t("A Mini App cannot create a splitting contract on Nimiq, so this split is not enforced the way your {token} split is. Weir does the arithmetic and you approve one transfer per person. Nothing is held on your behalf.", { token: state.weir!.token.symbol }))}
      </p>
    </div>`;

  if (state.nimEditing || missing.length) {
    const vaultLower = state.vault?.address.toLowerCase();
    const meLower = state.weir!.account.toLowerCase();

    const rows = mapped
      .map((m) => {
        const isVault = m.evm.toLowerCase() === vaultLower;
        const isMe = m.evm.toLowerCase() === meLower;
        const who = isVault ? t("Savings share") : isMe ? t("You") : short(m.evm);
        // The savings vault is an EVM contract and cannot receive NIM, and NIM
        // cannot be time locked at all. Rather than quietly drop its share and
        // change everyone else's percentages, say what it is and let the owner
        // choose where it goes.
        const hint = isVault
          ? `<span class="label" style="display:block;margin-top:4px">
               ${t("Send this share to any Nimiq address you like. It will not be locked: Nimiq has vesting contracts, but a Mini App has no way to create one.")}
             </span>`
          : "";
        return `
        <label class="field">
          <span class="label">${esc(who)} &middot; ${m.bps / 100}%</span>
          <input class="mono" type="text" data-nim-for="${esc(m.evm)}"
                 placeholder="NQ.." value="${esc(m.nim)}"
                 autocapitalize="characters" autocorrect="off" spellcheck="false" />
          ${hint}
        </label>`;
      })
      .join("");

    return `
      <h2>NIM</h2>
      ${caveat}
      <div class="card">
        <p class="label" style="margin-bottom:14px">
          ${esc(t("A Nimiq address is not the same as an {token} address, so each person needs theirs entered once. Stored on this device only.", { token: state.weir!.token.symbol }))}
        </p>
        ${rows}
        <button class="btn" data-act="nim-save">${t("Save addresses")}</button>
        ${state.nimEditing ? '<button class="btn ghost" data-act="nim-cancel">${t("Cancel")}</button>' : ""}
      </div>`;
  }

  let preview = "";
  try {
    const lunas = state.nimAmount ? parseNim(state.nimAmount) : 0n;
    if (lunas > 0n) {
      const plan = planNimSplit(lunas, mapped.map((m) => ({ address: m.nim, bps: m.bps })));
      preview = `<div class="card">${plan
        .map(
          (row, i) => `
          <div class="recipient">
            <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
            <div class="who">
              <div class="name">${esc(short(row.address))}</div>
              <div class="label">${row.bps / 100}%</div>
            </div>
            <div class="pct">${formatNim(row.lunas)}</div>
          </div>`,
        )
        .join("")}</div>`;
    }
  } catch {
    preview = `<div class="notice error">That is not a number Weir can split.</div>`;
  }

  const result = state.nimResult
    ? `<div class="notice ${state.nimResult.failed.length ? "error" : "info"}">
         Sent ${state.nimResult.sent.length} of
         ${state.nimResult.sent.length + state.nimResult.failed.length}.
         ${
           state.nimResult.failed.length
             ? "These did not go through: " +
               state.nimResult.failed.map((f) => esc(short(f.row.address))).join(", ") +
               ". Nothing was taken for them, you can send again."
             : ""
         }
       </div>`
    : "";

  return `
    <h2>NIM</h2>
    ${caveat}
    <div class="card">
      ${balanceLine}
      <label class="field" style="margin-top:14px">
        <span class="label">${t("Split this much NIM")}</span>
        <input type="text" id="nimAmount" inputmode="decimal" placeholder="0"
               value="${esc(state.nimAmount)}" />
      </label>
    </div>
    ${preview}
    ${result}
    <button class="btn" data-act="nim-send" ${state.nimProgress || !state.nimAmount ? "disabled" : ""}>
      ${
        state.nimProgress
          ? `<span class="spinner"></span> ${state.nimProgress.index} / ${state.nimProgress.total}`
          : t("Send the NIM split")
      }
    </button>
    <button class="btn ghost" data-act="nim-edit">${t("Change Nimiq addresses")}</button>`;
}

function splitsTab() {
  const w = state.weir!;
  const r = state.route;

  const rows = (shares: Share[]) =>
    shares
      .map((s, i) => {
        const isVault = state.vault && s.account.toLowerCase() === state.vault.address.toLowerCase();
        const isMe = s.account.toLowerCase() === w.account.toLowerCase();
        const named = isVault ? t("Savings vault") : isMe ? t("You") : null;
        return `
        <div class="recipient">
          <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
          <div class="who">
            <div class="name">${esc(named ?? short(s.account))}</div>
            ${named ? `<div class="label addr">${esc(short(s.account))}</div>` : ""}
          </div>
          <div class="pct">${s.bps / 100}%</div>
        </div>`;
      })
      .join("");

  const bar = (shares: Share[]) =>
    `<div class="splitbar">${shares
      .map((s, i) => `<span style="width:${s.bps / 100}%;background:${PALETTE[i % PALETTE.length]}"></span>`)
      .join("")}</div>`;

  const theirs = state.payingMe
    .map(
      (o) => `
    <div class="card">
      <div class="row spread" style="margin-bottom:10px">
        <span class="label">Paid by ${esc(short(o.owner))}</span>
        ${o.waiting > 0n ? `<span class="pill warn">${w.format(o.waiting)} waiting</span>` : ""}
      </div>
      ${bar(o.shares)}
      ${rows(o.shares)}
      ${
        o.waiting > 0n
          ? `<button class="btn secondary" style="margin-top:14px" data-act="distribute-other" data-addr="${o.address}">
               ${t("Release it")}
             </button>`
          : ""
      }
    </div>`,
    )
    .join("");

  return `
    <h1>${t("Splits")}</h1>
    <p class="lede">${t("Where money goes the moment it arrives.")}</p>

    ${
      r
        ? `<h2>${t("Your split")}</h2>
           <div class="card">
             ${bar(r.shares)}
             ${rows(r.shares)}
           </div>
           <button class="btn secondary" data-act="edit-rules">${t("Change the split")}</button>`
        : ""
    }

    ${theirs ? `<h2>${t("Splits that pay you")}</h2>${theirs}` : ""}

    ${nimSection()}
  `;
}

function savingsTab() {
  const w = state.weir!;
  const v = state.vault;

  if (!v) {
    return `
      <h1>${t("Savings")}</h1>
      <div class="empty">
        <div class="big">🔒</div>
        <p>${t("You have not set a slice aside yet.")}</p>
      </div>
      <button class="btn" data-act="new-vault">${t("Start saving a slice")}</button>`;
  }

  const days = daysUntil(v.unlockAt);

  return `
    <h1>${t("Savings")}</h1>
    ${v.goal ? `<p class="lede">${esc(v.goal)}</p>` : ""}

    <div class="card">
      <div class="label">${t("Put away so far")}</div>
      <div class="amount">${w.format(v.balance)}<span class="unit">${esc(w.token.symbol)}</span></div>
      <div class="row spread" style="margin-top:16px">
        <span class="pill ${v.locked ? "warn" : "good"}">
          ${v.locked ? `${t("Lock it for")} ${days}d` : t("Unlocked")}
        </span>
        <span class="label">${humanDate(v.unlockAt)}</span>
      </div>
    </div>

    ${
      v.locked
        ? `<div class="card flat">
             <p style="margin:0">
               ${t("The lock is the point. You can push the date further out, but there is deliberately no way to bring it closer.")}
             </p>
           </div>
           ${
             state.extending
               ? `<div class="card">
                    <label class="field">
                      <span class="label">${t("Keep it locked until")}</span>
                      <input type="date" id="newUnlock"
                             min="${dateInputValue(v.unlockAt + 86_400)}"
                             value="${dateInputValue(v.unlockAt + 90 * 86_400)}" />
                    </label>
                    <button class="btn" data-act="extend-confirm" ${state.busy ? "disabled" : ""}>
                      ${state.busy === "extend" ? `<span class="spinner"></span> ${t("Extending")}` : t("Confirm")}
                    </button>
                    <button class="btn ghost" data-act="extend-cancel">${t("Cancel")}</button>
                  </div>`
               : `<button class="btn secondary" data-act="extend">${t("Lock it for longer")}</button>`
           }`
        : `<button class="btn" data-act="withdraw" ${state.busy ? "disabled" : ""}>
             ${state.busy === "withdraw" ? `<span class="spinner"></span> ${t("Withdrawing")}` : t("Withdraw everything")}
           </button>`
    }

    <div class="card flat" style="margin-top:16px">
      <div class="label">${t("Vault address")}</div>
      <div class="addr" style="margin-top:6px">${esc(v.address)}</div>
    </div>
  `;
}

function readyScreen() {
  const body =
    state.tab === "link" ? linkTab()
    : state.tab === "activity" ? activityTab()
    : state.tab === "splits" ? splitsTab()
    : savingsTab();
  const err = state.error ? `<div class="notice error">${esc(state.error)}</div>` : "";
  return chrome(err + body, { tabs: true });
}

function errorScreen() {
  return chrome(`
    <h1>${t("Something went wrong")}</h1>
    <div class="notice error">${esc(state.error ?? "Unknown error")}</div>
    <button class="btn" data-act="retry">${t("Try again")}</button>
  `);
}

function render() {
  switch (state.phase) {
    case "boot":
      root.innerHTML = `<div class="centered"><div class="spinner"></div><div>${t("Starting Weir")}</div></div>`;
      break;
    case "welcome":
      root.innerHTML = welcomeScreen();
      break;
    case "setup":
      root.innerHTML = setupScreen();
      break;
    case "ready":
      root.innerHTML = readyScreen();
      break;
    case "error":
      root.innerHTML = errorScreen();
      break;
  }
}

// --- actions ---

function describeError(e: unknown): string {
  if (e instanceof NotInNimiqPayError) return e.message;
  if (e instanceof UnsupportedChainError) return e.message;
  const msg = (e as any)?.shortMessage || (e as any)?.message || String(e);
  if (/user rejected|denied|cancell?ed/i.test(msg)) return "You cancelled that in your wallet.";
  if (/insufficient funds/i.test(msg)) return "Not enough gas in this wallet to send that.";
  return msg.split("\n")[0].slice(0, 220);
}

async function withBusy(key: string, fn: () => Promise<void>) {
  state.busy = key;
  state.error = null;
  render();
  try {
    await fn();
  } catch (e) {
    state.error = describeError(e);
  } finally {
    state.busy = null;
    render();
  }
}

async function connect() {
  await withBusy("connect", async () => {
    const w = new Weir();
    await w.connect();
    state.weir = w;
    await refresh();
  });

  // The Nimiq half is optional and must never hold up the USDT half, so it
  // connects on its own and re-renders when it arrives.
  void connectNimiq()
    .then((session) => {
      if (!session) return;
      state.nimiq = session;
      if (state.route) state.nimAddresses = loadNimAddresses(state.route.address);
      render();
    })
    .catch(() => {
      /* not inside Nimiq Pay, which is a normal way to run */
    });
}

function readDraftInputs() {
  const d = state.draft;
  const pct = document.getElementById("savePct") as HTMLInputElement | null;
  const months = document.getElementById("months") as HTMLInputElement | null;
  const goal = document.getElementById("goal") as HTMLInputElement | null;
  if (pct) d.savePct = Math.min(99, Math.max(1, Number(pct.value) || 20));
  if (months) d.months = Math.min(60, Math.max(1, Number(months.value) || 3));
  if (goal) d.goal = goal.value.trim();
}

function readTeamInputs() {
  document.querySelectorAll<HTMLInputElement>("[data-team-addr]").forEach((el) => {
    const i = Number(el.dataset.teamAddr);
    if (state.draft.team[i]) state.draft.team[i].account = el.value.trim() as Address;
  });
  document.querySelectorAll<HTMLInputElement>("[data-team-bps]").forEach((el) => {
    const i = Number(el.dataset.teamBps);
    if (state.draft.team[i]) state.draft.team[i].bps = Math.round((Number(el.value) || 0) * 100);
  });
}

async function createSelfRoute() {
  readDraftInputs();
  const d = state.draft;
  const w = state.weir!;
  const unlockAt = Math.floor(Date.now() / 1000) + d.months * 30 * 24 * 3600;

  await withBusy("create", async () => {
    await w.createSavingsRoute(w.account, d.savePct * 100, unlockAt, d.goal);
    await refresh();
    state.tab = "link";
    toast("Your pay address is ready");
  });
}

async function createTeamRoute() {
  readTeamInputs();
  const w = state.weir!;
  const team = state.draft.team;

  for (const s of team) {
    if (!isAddress(s.account)) {
      state.error = `${s.account || "An empty row"} is not a valid address.`;
      render();
      return;
    }
  }

  await withBusy("create", async () => {
    await w.createRoute(team.map((s) => ({ account: getAddress(s.account), bps: s.bps })));
    await refresh();
    state.tab = "link";
    toast("Your pay address is ready");
  });
}

async function reload() {
  await withBusy("reload", async () => {
    await refresh();
  });
}

// --- event wiring ---

root.addEventListener("click", async (ev) => {
  const target = (ev.target as HTMLElement).closest("[data-act],[data-tab],[data-preset]") as HTMLElement | null;
  if (!target) return;

  const tab = target.dataset.tab as Tab | undefined;
  if (tab) {
    state.tab = tab;
    render();
    // Money can land between renders, so a tab switch is a refetch, not just
    // a repaint of whatever was cached.
    if (state.phase === "ready" && !state.busy) void reload();
    return;
  }

  const preset = target.dataset.preset as "self" | "team" | undefined;
  if (preset) {
    readDraftInputs();
    readTeamInputs();
    state.draft.preset = preset;
    if (preset === "team" && state.draft.team.length === 0 && state.weir) {
      state.draft.team = [{ account: state.weir.account, bps: 10000 }];
    }
    render();
    return;
  }

  const act = target.dataset.act;
  const w = state.weir;

  switch (act) {
    case "connect":
      await connect();
      break;

    case "open-deeplink":
      window.location.href = DEEPLINK;
      break;

    case "retry":
      state.error = null;
      state.phase = hasWallet() ? "boot" : "welcome";
      render();
      await boot();
      break;

    case "copy-addr":
      if (state.route) await copy(state.route.address, "Address");
      break;

    case "copy-nim":
      if (state.nimiq) await copy(state.nimiq.address, "Address");
      break;

    case "share-addr":
      if (state.route) {
        await share(`Pay me in ${w!.token.symbol} on ${w!.chain.name}`, state.route.address);
      }
      break;

    case "invite":
      await share("Open Weir to see your share of what we get paid.", DEEPLINK);
      break;

    case "distribute":
      if (state.route) {
        await withBusy("distribute", async () => {
          await w!.distribute(state.route!.address);
          await refresh();
          toast("Split and paid out");
        });
      }
      break;

    case "distribute-other": {
      const addr = target.dataset.addr as Address;
      await withBusy("distribute", async () => {
        await w!.distribute(addr);
        await refresh();
        toast("Split and paid out");
      });
      break;
    }

    case "claim":
      if (state.route) {
        await withBusy("claim", async () => {
          await w!.claim(state.route!.address);
          await refresh();
          toast("Claimed");
        });
      }
      break;

    case "withdraw":
      if (state.vault) {
        await withBusy("withdraw", async () => {
          await w!.withdrawVault(state.vault!.address);
          await refresh();
          toast("Withdrawn");
        });
      }
      break;

    case "add-team":
      readTeamInputs();
      state.draft.team.push({ account: "" as Address, bps: 0 });
      render();
      break;

    case "rm-team": {
      readTeamInputs();
      const i = Number(target.dataset.i);
      state.draft.team.splice(i, 1);
      render();
      break;
    }

    case "create-self":
      await createSelfRoute();
      break;

    case "create-team":
      await createTeamRoute();
      break;

    case "edit-rules":
      state.draft.preset = "team";
      state.draft.team = state.route!.shares.map((s) => ({ ...s }));
      state.phase = "setup";
      render();
      break;

    case "new-route":
      state.draft.preset = "self";
      state.phase = "setup";
      render();
      break;

    case "new-vault":
      state.draft.preset = "self";
      state.phase = "setup";
      render();
      break;

    case "nim-edit":
      state.nimEditing = true;
      render();
      break;

    case "nim-cancel":
      state.nimEditing = false;
      render();
      break;

    case "nim-save": {
      const map: Record<string, string> = { ...state.nimAddresses };
      let bad: string | null = null;

      document.querySelectorAll<HTMLInputElement>("[data-nim-for]").forEach((input) => {
        const evm = input.dataset.nimFor!.toLowerCase();
        const value = input.value.trim();
        if (!value) {
          delete map[evm];
          return;
        }
        if (!isNimiqAddress(value)) {
          bad = value;
          return;
        }
        map[evm] = normaliseNimiqAddress(value);
      });

      if (bad) {
        state.error = `${bad} is not a Nimiq address. They start with NQ.`;
        render();
        break;
      }

      state.nimAddresses = map;
      if (state.route) saveNimAddresses(state.route.address, map);
      state.nimEditing = false;
      state.error = null;
      render();
      toast("Nimiq addresses saved");
      break;
    }

    case "nim-send": {
      const session = state.nimiq;
      const route = state.route;
      if (!session || !route) break;

      let plan: NimSplitRow[];
      try {
        const lunas = parseNim(state.nimAmount);
        if (lunas <= 0n) throw new Error("Enter an amount above zero.");
        plan = planNimSplit(
          lunas,
          route.shares.map((sh) => ({
            address: state.nimAddresses[sh.account.toLowerCase()] ?? "",
            bps: sh.bps,
          })),
        );
      } catch (e) {
        state.error = describeError(e);
        render();
        break;
      }

      state.nimResult = null;
      state.error = null;
      try {
        const outcome = await sendNimSplit(session, plan, (p) => {
          state.nimProgress = { index: p.index, total: p.total };
          render();
        });
        state.nimResult = outcome;
        if (outcome.sent.length) toast(`Sent ${outcome.sent.length} NIM transfer${outcome.sent.length === 1 ? "" : "s"}`);
      } catch (e) {
        state.error = describeError(e);
      } finally {
        state.nimProgress = null;
        state.nimAmount = "";
        render();
      }
      break;
    }

    case "extend":
      state.extending = true;
      render();
      break;

    case "extend-cancel":
      state.extending = false;
      render();
      break;

    case "extend-confirm": {
      const input = document.getElementById("newUnlock") as HTMLInputElement | null;
      const v = state.vault!;
      const chosen = input?.value ? Math.floor(new Date(input.value).getTime() / 1000) : 0;

      if (!chosen) {
        state.error = t("Pick a date first.");
        render();
        break;
      }
      // The contract rejects this too, but failing here costs nothing and
      // explains itself better than a reverted transaction would.
      if (chosen <= v.unlockAt) {
        state.error = `That is not later than ${humanDate(v.unlockAt)}. The lock can only move further out.`;
        render();
        break;
      }

      await withBusy("extend", async () => {
        await w!.extendLock(v.address, chosen);
        state.extending = false;
        await refresh();
        toast("Locked for longer");
      });
      break;
    }
  }
});

// Keep the draft in sync as the user types, so a re-render never loses input.
root.addEventListener("input", (ev) => {
  const el = ev.target as HTMLElement;
  if (el.id === "savePct" || el.id === "months" || el.id === "goal") {
    readDraftInputs();
    if (el.id === "savePct") render();
  }
  if (el.id === "nimAmount") {
    state.nimAmount = (el as HTMLInputElement).value;
    render();
  }
});

// --- boot ---

async function boot() {
  if (!hasWallet()) {
    state.phase = "welcome";
    render();
    return;
  }
  try {
    // Nimiq Pay shows a native prompt here, which is the one unavoidable tap
    // between opening the app and using it.
    await connect();
    if (state.error) {
      state.phase = "welcome";
      render();
    }
  } catch (e) {
    state.error = describeError(e);
    state.phase = "error";
    render();
  }
}

// Money can land while the app is open, so pick it up without a manual refresh.
setInterval(() => {
  if (state.phase === "ready" && !state.busy) void reload();
}, 20_000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.phase === "ready" && !state.busy) void reload();
});

if (import.meta.env.DEV) {
  const { installDevWallet } = await import("./devwallet");
  installDevWallet();
}

initLanguage();
render();
void boot();
