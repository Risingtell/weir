import QRCode from "qrcode";
import type { Address } from "viem";
import { isAddress, getAddress } from "viem";
import "./styles.css";
import { Weir, hasWallet, NotInNimiqPayError, UnsupportedChainError } from "./chain";
import type { RouteView, VaultView, Share } from "./chain";
import { BPS_TOTAL } from "./config";

/** Where this mini app is hosted. Used to build the Nimiq Pay deeplink. */
const APP_HOST = window.location.host;
const DEEPLINK = `https://nimpay.app/miniapps/open/${APP_HOST}`;

type Tab = "link" | "splits" | "savings";

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
  qr: string | null;
  /** Draft state for the setup screen. */
  draft: { preset: "self" | "team"; savePct: number; months: number; goal: string; team: Share[] };
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
  qr: null,
  draft: { preset: "self", savePct: 20, months: 3, goal: "", team: [] },
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

function daysUntil(ts: number) {
  return Math.max(0, Math.ceil((ts * 1000 - Date.now()) / 86_400_000));
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
    ${item("link", "Get paid", '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>')}
    ${item("splits", "Splits", '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}
    ${item("savings", "Savings", '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')}
  </nav>`;
}

function welcomeScreen() {
  const noWallet = !hasWallet();
  return chrome(`
    <h1>Rules for the money you get paid.</h1>
    <p class="lede">
      Give a client one address. The moment they pay, it splits between your team
      and puts a slice into savings you cannot raid on a bad day.
    </p>

    ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}

    ${
      noWallet
        ? `<div class="notice info">
             Weir runs inside Nimiq Pay. Open this page there to connect your wallet.
           </div>
           <button class="btn" data-act="open-deeplink">Open in Nimiq Pay</button>`
        : `<button class="btn" data-act="connect">${
            state.busy === "connect" ? '<span class="spinner"></span> Connecting' : "Connect wallet"
          }</button>`
    }

    <h2>How it works</h2>
    <div class="card flat">
      <div class="recipient"><span class="dot" style="background:#e9b213"></span>
        <div class="who"><div class="name">You get an address</div>
        <div class="label">Share it like any wallet address</div></div></div>
      <div class="recipient"><span class="dot" style="background:#21bca5"></span>
        <div class="who"><div class="name">A client pays it</div>
        <div class="label">From any wallet or exchange, no app needed</div></div></div>
      <div class="recipient"><span class="dot" style="background:#0582ca"></span>
        <div class="who"><div class="name">It splits on arrival</div>
        <div class="label">Everyone paid, your slice already saved</div></div></div>
    </div>
  `);
}

function setupScreen() {
  const d = state.draft;
  const teamTotal = d.team.reduce((a, s) => a + s.bps, 0);

  const selfPane = `
    <div class="card">
      <label class="field">
        <span class="label">Save this much of every payment</span>
        <input type="number" id="savePct" min="1" max="99" value="${d.savePct}" inputmode="numeric" />
      </label>
      <label class="field">
        <span class="label">Lock it for</span>
        <input type="number" id="months" min="1" max="60" value="${d.months}" inputmode="numeric" />
        <span class="label" style="margin-top:6px;display:block">months. You can extend later, never shorten.</span>
      </label>
      <label class="field">
        <span class="label">What is it for (optional)</span>
        <input type="text" id="goal" maxlength="60" placeholder="Rainy day" value="${esc(d.goal)}" />
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
      ${state.busy === "create" ? '<span class="spinner"></span> Creating' : "Create my pay address"}
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
      ${teamRows || '<p class="label">Add everyone who should get a cut, including yourself.</p>'}
      <button class="btn secondary" data-act="add-team">Add someone</button>
      <div class="row spread" style="margin-top:14px">
        <span class="label">Total</span>
        <span class="pill ${teamTotal === BPS_TOTAL ? "good" : "warn"}">${teamTotal / 100}%</span>
      </div>
    </div>
    <button class="btn" data-act="create-team" ${teamTotal !== BPS_TOTAL || state.busy ? "disabled" : ""}>
      ${state.busy === "create" ? '<span class="spinner"></span> Creating' : "Create our pay address"}
    </button>`;

  return chrome(`
    <h1>How should money arrive?</h1>
    <p class="lede">You can change this any time.</p>

    ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}

    <button class="preset" data-preset="self" aria-pressed="${d.preset === "self"}">
      <div class="title">Pay myself first</div>
      <div class="sub">Every payment lands with a slice already put away</div>
    </button>
    <button class="preset" data-preset="team" aria-pressed="${d.preset === "team"}">
      <div class="title">Split with my team</div>
      <div class="sub">One client payment, everyone paid at once</div>
    </button>

    ${d.preset === "self" ? selfPane : teamPane}
  `);
}

function linkTab() {
  const w = state.weir!;
  const r = state.route;

  if (!r) {
    return `
      <h1>Get paid your way</h1>
      <p class="lede">
        You are being paid through someone else's split. Set up your own address
        and you can be paid directly too, with a slice saved automatically.
      </p>
      <button class="btn" data-act="new-route">Create my pay address</button>`;
  }

  const waiting = r.waiting > 0n;

  return `
    <h1>Your pay address</h1>
    <p class="lede">Give this to a client like any other wallet address.</p>

    ${state.qr ? `<div class="qr"><img src="${state.qr}" alt="QR code for your pay address" /></div>` : ""}

    <div class="card">
      <div class="label">On ${esc(w.chain.name)}, for ${esc(w.token.symbol)}</div>
      <div class="addr" style="margin:8px 0 14px">${esc(r.address)}</div>
      <button class="btn" data-act="copy-addr">Copy address</button>
      <button class="btn secondary" data-act="share-addr">Share</button>
    </div>

    ${
      waiting
        ? `<div class="card">
             <div class="label">Waiting to be split</div>
             <div class="amount">${w.format(r.waiting)}<span class="unit">${esc(w.token.symbol)}</span></div>
             <button class="btn" style="margin-top:14px" data-act="distribute" ${state.busy ? "disabled" : ""}>
               ${state.busy === "distribute" ? '<span class="spinner"></span> Releasing' : "Release now"}
             </button>
             <p class="label" style="margin:12px 0 0">
               This normally happens by itself within a minute. The button is here so
               you never have to wait on us.
             </p>
           </div>`
        : `<div class="card flat">
             <div class="row spread">
               <span class="label">Nothing waiting</span>
               <span class="pill good">Ready</span>
             </div>
           </div>`
    }

    ${
      state.pendingMine > 0n
        ? `<div class="card">
             <div class="label">Set aside for you after a failed transfer</div>
             <div class="amount">${w.format(state.pendingMine)}<span class="unit">${esc(w.token.symbol)}</span></div>
             <button class="btn" style="margin-top:14px" data-act="claim" ${state.busy ? "disabled" : ""}>
               ${state.busy === "claim" ? '<span class="spinner"></span> Claiming' : "Claim it"}
             </button>
           </div>`
        : ""
    }

    <h2>Bring your team in</h2>
    <div class="card">
      <p style="margin-bottom:14px">
        Anyone you split with can open Weir and watch their share land.
      </p>
      <button class="btn secondary" data-act="invite">Invite teammates</button>
    </div>
  `;
}

function splitsTab() {
  const w = state.weir!;
  const r = state.route;

  const rows = (shares: Share[]) =>
    shares
      .map((s, i) => {
        const isVault = state.vault && s.account.toLowerCase() === state.vault.address.toLowerCase();
        const isMe = s.account.toLowerCase() === w.account.toLowerCase();
        const named = isVault ? "Savings vault" : isMe ? "You" : null;
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
               Release it
             </button>`
          : ""
      }
    </div>`,
    )
    .join("");

  return `
    <h1>Splits</h1>
    <p class="lede">Where money goes the moment it arrives.</p>

    ${
      r
        ? `<h2>Your split</h2>
           <div class="card">
             ${bar(r.shares)}
             ${rows(r.shares)}
           </div>
           <button class="btn secondary" data-act="edit-rules">Change the split</button>`
        : ""
    }

    ${theirs ? `<h2>Splits that pay you</h2>${theirs}` : ""}
  `;
}

function savingsTab() {
  const w = state.weir!;
  const v = state.vault;

  if (!v) {
    return `
      <h1>Savings</h1>
      <div class="empty">
        <div class="big">🔒</div>
        <p>You have not set a slice aside yet.</p>
      </div>
      <button class="btn" data-act="new-vault">Start saving a slice</button>`;
  }

  const days = daysUntil(v.unlockAt);

  return `
    <h1>Savings</h1>
    ${v.goal ? `<p class="lede">${esc(v.goal)}</p>` : ""}

    <div class="card">
      <div class="label">Put away so far</div>
      <div class="amount">${w.format(v.balance)}<span class="unit">${esc(w.token.symbol)}</span></div>
      <div class="row spread" style="margin-top:16px">
        <span class="pill ${v.locked ? "warn" : "good"}">
          ${v.locked ? `Locked for ${days} more day${days === 1 ? "" : "s"}` : "Unlocked"}
        </span>
        <span class="label">${humanDate(v.unlockAt)}</span>
      </div>
    </div>

    ${
      v.locked
        ? `<div class="card flat">
             <p style="margin:0">
               The lock is the point. You can push the date further out, but there is
               deliberately no way to bring it closer.
             </p>
           </div>
           <button class="btn secondary" data-act="extend">Lock it for longer</button>`
        : `<button class="btn" data-act="withdraw" ${state.busy ? "disabled" : ""}>
             ${state.busy === "withdraw" ? '<span class="spinner"></span> Withdrawing' : "Withdraw everything"}
           </button>`
    }

    <div class="card flat" style="margin-top:16px">
      <div class="label">Vault address</div>
      <div class="addr" style="margin-top:6px">${esc(v.address)}</div>
    </div>
  `;
}

function readyScreen() {
  const body =
    state.tab === "link" ? linkTab() : state.tab === "splits" ? splitsTab() : savingsTab();
  const err = state.error ? `<div class="notice error">${esc(state.error)}</div>` : "";
  return chrome(err + body, { tabs: true });
}

function errorScreen() {
  return chrome(`
    <h1>Something went wrong</h1>
    <div class="notice error">${esc(state.error ?? "Unknown error")}</div>
    <button class="btn" data-act="retry">Try again</button>
  `);
}

function render() {
  switch (state.phase) {
    case "boot":
      root.innerHTML = `<div class="centered"><div class="spinner"></div><div>Starting Weir</div></div>`;
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

    case "extend":
      toast("Coming in the next build");
      break;
  }
});

// Keep the draft in sync as the user types, so a re-render never loses input.
root.addEventListener("input", (ev) => {
  const el = ev.target as HTMLElement;
  if (el.id === "savePct" || el.id === "months" || el.id === "goal") {
    readDraftInputs();
    if (el.id === "savePct") render();
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

render();
void boot();
