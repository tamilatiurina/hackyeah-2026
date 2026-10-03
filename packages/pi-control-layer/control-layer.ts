/**
 * AI Control Layer — pi enforcement extension.
 *
 * Reads policy.json (defaults + per-agent overrides, see policy.schema.json),
 * enforces it on every tool call, and reports audit events to the control
 * plane (websocket). Hot-reloads on policy file change; falls back to the
 * last-known-good policy if the file is ever invalid.
 *
 * Policy lookup order: POLICY_PATH env var -> <cwd>/.pi/policy.json ->
 * ~/.pi/policy.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { readFileSync, watchFile, statSync } from "node:fs";
import { hostname } from "node:os";

// ---------------------------------------------------------------- policy types

interface Rule { id: string; pattern: string; reason?: string; enabled?: boolean; timeoutSeconds?: number | null }
interface RegexRule { id: string; regex: string; replacement?: string }
interface AgentPolicy {
  identity?: { owner?: string };
  commands?: { banned?: Rule[]; approval?: Rule[]; outputRedact?: Rule[] };
  files?: { blocked?: Rule[]; redact?: Rule[]; approval?: Rule[] };
  budget?: { maxSessionCostUsd?: number; maxTurnCostUsd?: number; maxSessionTokens?: number; maxTurnTokens?: number; onExceed?: "block" | "warn" };
  time?: { maxTurnSeconds?: number; maxSessionSeconds?: number; alertAfterSeconds?: number; onExceed?: "block" | "warn" };
  systemPrompt?: { mode?: "append" | "replace" | "none"; text?: string };
  injection?: { enabled?: boolean; onDetect?: "block" | "warn"; scanToolResults?: boolean; scanUserInput?: boolean; patterns?: RegexRule[] };
  controlPlane?: { url?: string; localFallback?: "confirm" | "block" | "allow" };
}
interface Policy { version: number; _rev?: number; defaults?: AgentPolicy; agents?: Record<string, AgentPolicy> }

// ---------------------------------------------------------------- glob matching

function globToRegex(glob: string, pathMode: boolean): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" (path mode) should also match zero directories
        if (pathMode && glob[i + 2] === "/") { re += "(?:[\\s\\S]*/)?"; i += 2; }
        else { re += "[\\s\\S]*"; i++; }
      }
      else re += pathMode ? "[^/\\\\]*" : "[\\s\\S]*";
    } else if ("\\^$.|?+()[]{}".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`, "i");
}

function compileList(pattern: string, pathMode: boolean): RegExp[] {
  return pattern.split(",").map((s) => s.trim()).filter(Boolean)
    .map((g) => globToRegex(pathMode ? expandTilde(g) : g, pathMode));
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

function matchesAny(regexes: RegExp[], s: string): boolean {
  return regexes.some((re) => re.test(s));
}

function compileRegex(spec: string): RegExp {
  const caseInsensitive = spec.startsWith("(?i)");
  const src = caseInsensitive ? spec.slice(4) : spec;
  return new RegExp(src, caseInsensitive ? "i" : "");
}

// ---------------------------------------------------------------- state

interface CtlState {
  policyPath: string;
  policy: Policy | null;
  merged: AgentPolicy;
  mtimeMs: number;
  agentId: string;
  sessionId: string | null;
  sessionStart: number;
  turnStart: number;
  sessionCost: number;
  sessionTokens: number;
  turnCost: number;
  turnTokens: number;
  budgetAnnounced: boolean;
  toolTimers: Map<string, { label: string; start: number }>;
  lastAlertReported: number;
}

const state: CtlState = {
  policyPath: "", policy: null,
  merged: {},
  mtimeMs: 0,
  agentId: "unknown",
  sessionId: null,
  sessionStart: Date.now(), turnStart: Date.now(),
  sessionCost: 0, sessionTokens: 0, turnCost: 0, turnTokens: 0,
  budgetAnnounced: false,
  toolTimers: new Map(),
  lastAlertReported: 0,
};

// ---------------------------------------------------------------- control plane (websocket, best-effort)

type WsLike = { send: (s: string) => void; close: () => void; readyState: number; onopen: unknown; onmessage: unknown; onclose: unknown; onerror: unknown };
let ws: WsLike | null = null;
let wsReconnect: ReturnType<typeof setInterval> | null = null;
const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

function wsSend(obj: Record<string, unknown>) {
  try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* best effort */ }
}

function connectControlPlane(url: string | undefined, ctx: ExtensionContext) {
  if (!url || typeof WebSocket === "undefined") return;
  try {
    const sock = new WebSocket(url) as unknown as WsLike;
    sock.onopen = () => {
      ws = sock;
      wsSend({ type: "agent_hello", agent: state.agentId, cwd: ctx.cwd, sessionId: state.sessionId, policyRev: state.policy?._rev ?? null, ts: new Date().toISOString() });
      ctx.ui.setStatus("ctl-layer", `governed: ${state.agentId}`);
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data ?? ""));
        if (msg.type === "approval_response" && msg.requestId && pendingApprovals.has(msg.requestId)) {
          const p = pendingApprovals.get(msg.requestId)!;
          clearTimeout(p.timer);
          pendingApprovals.delete(msg.requestId);
          p.resolve(Boolean(msg.approved));
        }
      } catch { /* ignore malformed */ }
    };
    sock.onclose = sock.onerror = () => { if (ws === sock) ws = null; };
  } catch { /* unreachable control plane is fine */ }
}

function startReconnect(ctx: ExtensionContext) {
  if (wsReconnect) clearInterval(wsReconnect);
  const url = state.merged.controlPlane?.url;
  if (!url) return;
  wsReconnect = setInterval(() => { if (!ws) connectControlPlane(url, ctx); }, 5000);
}

/** Remote approval request; resolves false on timeout / no connection. */
function requestRemoteApproval(id: string, summary: string, timeoutSeconds: number | null): Promise<boolean> {
  return new Promise((res) => {
    if (!ws || ws.readyState !== 1) return res(false);
    const requestId = `${id}-${Date.now()}`;
    wsSend({ type: "approval_request", requestId, agent: state.agentId, summary, ts: new Date().toISOString() });
    const ms = timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
    const timer = ms
      ? setTimeout(() => { pendingApprovals.delete(requestId); res(false); }, ms)
      : setTimeout(() => { /* no-op keeps timer type happy */ }, 0);
    if (!ms) clearTimeout(timer); // wait forever: no timeout timer
    pendingApprovals.set(requestId, { resolve: res, timer });
  });
}

// ---------------------------------------------------------------- policy loading + merging

function loadPolicy(path: string, ctx: ExtensionContext): void {
  try {
    const st = statSync(path);
    if (st.mtimeMs === state.mtimeMs) return;
    const raw = JSON.parse(readFileSync(path, "utf8")) as Policy;
    state.policy = raw;
    state.mtimeMs = st.mtimeMs;
    recomputeMerged();
    ctx.ui.setStatus("ctl-layer", `governed: ${state.agentId} (rev ${raw._rev ?? "local"})`);
    wsSend({ type: "policy_applied", agent: state.agentId, rev: raw._rev ?? null, ts: new Date().toISOString() });
  } catch (e) {
    if (state.policy) {
      ctx.ui.notify(`Control layer: policy update failed, keeping last known good (${String(e)})`, "warning");
    }
    // No policy at all: run un-governed but visible.
    if (!state.policy) ctx.ui.setStatus("ctl-layer", "no policy loaded");
  }
}

function recomputeMerged() {
  const base = state.policy?.defaults ?? {};
  const override = (state.policy?.agents ?? {})[state.agentId] ?? {};
  // Section-level override: agent section replaces defaults section; lists replace, never merge.
  state.merged = {
    ...base,
    ...override,
    identity: { ...(base.identity ?? {}), ...(override.identity ?? {}) },
    controlPlane: { ...(base.controlPlane ?? {}), ...(override.controlPlane ?? {}) },
  };
}

function findPolicyPath(ctx: ExtensionContext): string {
  if (process.env.POLICY_PATH) return resolve(process.env.POLICY_PATH);
  const projectLocal = join(ctx.cwd, ".pi", "policy.json");
  try { statSync(projectLocal); return projectLocal; } catch { /* fall through */ }
  return join(homedir(), ".pi", "policy.json");
}

// Agent id is the hostname, period. Policy keys under "agents" match hostnames.
// PI_DEMO_HOST overrides the hostname for demo/testing runs (e.g. to simulate a
// policy agent or a host that is absent from the policy, which means global defaults).
function agentIdentity(ctx: ExtensionContext): string {
  if (process.env.PI_DEMO_HOST) return process.env.PI_DEMO_HOST;
  return hostnameShort();
}

function hostnameShort(): string {
  try { return hostname(); } catch { return "host"; }
}

// ---------------------------------------------------------------- audit events

function reportAudit(event: string, fields: Record<string, unknown>, ctx: ExtensionContext) {
  const rec = { type: "policy_event", event, agent: state.agentId, sessionId: state.sessionId, policyRev: state.policy?._rev ?? null, ts: new Date().toISOString(), ...fields };
  wsSend(rec);
  if (fields.ruleId) {
    try { pi.appendEntry({ customType: "ctl-layer-audit", content: JSON.stringify(rec), display: false }); } catch { /* optional */ }
  }
}

// ---------------------------------------------------------------- enforcement helpers

function decideApproval(ctx: ExtensionContext, kind: string, summary: string, rule: Rule | undefined, scope: string): Promise<boolean> {
  const timeout = rule?.timeoutSeconds ?? 300;
  if (ws && ws.readyState === 1) {
    return requestRemoteApproval(`${kind}:${rule?.id ?? "adhoc"}`, summary, timeout).then((ok) => {
      if (ok) return true;
      // Remote timed out or denied -> offer local confirm as last chance only if timeout caused it
      return localConfirm(ctx, kind, summary);
    });
  }
  return localConfirm(ctx, kind, summary);
}

function localConfirm(ctx: ExtensionContext, kind: string, summary: string): Promise<boolean> {
  const fb = state.merged.controlPlane?.localFallback ?? "confirm";
  if (fb === "block" || !ctx.hasUI) return Promise.resolve(false);
  if (fb === "allow") return Promise.resolve(true);
  return ctx.ui.confirm(`Approval required (${kind})`, summary);
}

interface Verdict { block: boolean; reason?: string }

async function checkCommand(command: string, ctx: ExtensionContext): Promise<Verdict> {

  const cmds = state.merged.commands;
  const now = Date.now();

  // Time limits gate every action
  const timeVerdict = checkTime(now, ctx);
  if (timeVerdict.block) return timeVerdict;
  const budgetVerdict = checkBudget(ctx);
  if (budgetVerdict.block) return budgetVerdict;

  const banned = (cmds?.banned ?? []).filter((r) => r.enabled !== false);
  for (const r of banned) {
    if (matchesAny(compileList(r.pattern, false), command)) {
      reportAudit("blocked", { ruleId: r.id, scope: ruleScope(r.id, "commands.banned"), tool: "command", detail: command }, ctx);
      return { block: true, reason: r.reason ? `Blocked by policy (${r.id}): ${r.reason}` : `Blocked by policy (${r.id})` };
    }
  }

  const approvals = (cmds?.approval ?? []).filter((r) => r.enabled !== false);
  for (const r of approvals) {
    if (matchesAny(compileList(r.pattern, false), command)) {
      reportAudit("approval_requested", { ruleId: r.id, scope: ruleScope(r.id, "commands.approval"), tool: "command", detail: command }, ctx);
      const ok = await decideApproval(ctx, "command", `Agent requests to run:\n\n  ${command}\n\nRule: ${r.id}${r.reason ? ` — ${r.reason}` : ""}`, r, ruleScope(r.id, "commands.approval"));
      reportAudit(ok ? "approved" : "denied", { ruleId: r.id, scope: ruleScope(r.id, "commands.approval"), tool: "command", detail: command }, ctx);
      if (!ok) return { block: true, reason: r.reason ? `Not approved (${r.id}): ${r.reason}` : `Not approved (${r.id})` };
      return {};
    }
  }
  return {};
}

function ruleScope(_id: string, section: string): string {
  const ov = state.policy?.agents?.[state.agentId];
  if (ov && JSON.stringify(ov).length > 0) {
    // cheap check: does the override contain this section?
    const sec = section.split(".")[0];
    if ((ov as Record<string, unknown>)[sec] !== undefined) return state.agentId;
  }
  return "defaults";
}

function pathRulesFor(toolPath: string): { blocked: Rule[]; redact: Rule[]; approval: Rule[] } {
  const f = state.merged.files ?? {};
  return {
    blocked: (f.blocked ?? []).filter((r) => r.enabled !== false),
    redact: (f.redact ?? []).filter((r) => r.enabled !== false),
    approval: (f.approval ?? []).filter((r) => r.enabled !== false),
  };
}

async function checkPath(toolName: string, rawPath: string, ctx: ExtensionContext): Promise<Verdict> {
  if (!rawPath) return {};
  const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(ctx.cwd, rawPath);
  const tildeAbs = expandTilde(rawPath);
  const candidates = [abs, tildeAbs];
  const rules = pathRulesFor(rawPath);

  for (const r of rules.blocked) {
    const res = compileList(r.pattern, true);
    if (candidates.some((c) => matchesAny(res, c))) {
      reportAudit("blocked", { ruleId: r.id, scope: ruleScope(r.id, "files.blocked"), tool: toolName, detail: rawPath }, ctx);
      return { block: true, reason: r.reason ? `Blocked by policy (${r.id}): ${r.reason}` : `Blocked by policy (${r.id})` };
    }
  }
  for (const r of rules.approval) {
    const res = compileList(r.pattern, true);
    if (candidates.some((c) => matchesAny(res, c))) {
      reportAudit("approval_requested", { ruleId: r.id, scope: ruleScope(r.id, "files.approval"), tool: toolName, detail: rawPath }, ctx);
      const ok = await decideApproval(ctx, "file", `Agent requests access to:\n\n  ${rawPath}\n\nRule: ${r.id}${r.reason ? ` — ${r.reason}` : ""}`, r, ruleScope(r.id, "files.approval"));
      reportAudit(ok ? "approved" : "denied", { ruleId: r.id, scope: ruleScope(r.id, "files.approval"), tool: toolName, detail: rawPath }, ctx);
      if (!ok) return { block: true, reason: r.reason ? `Not approved (${r.id}): ${r.reason}` : `Not approved (${r.id})` };
      break;
    }
  }
  return {};
}

function checkTime(now: number, ctx: ExtensionContext): Verdict {
  const t = state.merged.time;
  if (!t) return {};
  const mode = t.onExceed ?? "block";
  const turnSec = (now - state.turnStart) / 1000;
  const sessSec = (now - state.sessionStart) / 1000;
  const overTurn = t.maxTurnSeconds && turnSec > t.maxTurnSeconds;
  const overSession = t.maxSessionSeconds && sessSec > t.maxSessionSeconds;
  if (overTurn || overSession) {
    if (mode === "warn") {
      if (now - state.lastAlertReported > 30000) {
        state.lastAlertReported = now;
        ctx.ui.notify(`Control layer: time limit exceeded (turn ${Math.round(turnSec)}s, session ${Math.round(sessSec)}s) — warning only`, "warning");
        reportAudit("time_limit_warn", { detail: `turn=${Math.round(turnSec)}s session=${Math.round(sessSec)}s` }, ctx);
      }
      return {};
    }
    reportAudit("time_limit_block", { detail: `turn=${Math.round(turnSec)}s session=${Math.round(sessSec)}s` }, ctx);
    return { block: true, reason: `Time limit exceeded: turn ${Math.round(turnSec)}s / session ${Math.round(sessSec)}s` };
  }
  return {};
}

function checkBudget(ctx: ExtensionContext): Verdict {
  const b = state.merged.budget;
  if (!b) return {};
  const overSessionCost = b.maxSessionCostUsd != null && state.sessionCost > b.maxSessionCostUsd;
  const overTurnCost = b.maxTurnCostUsd != null && state.turnCost > b.maxTurnCostUsd;
  const overSessionTok = b.maxSessionTokens != null && state.sessionTokens > b.maxSessionTokens;
  const overTurnTok = b.maxTurnTokens != null && state.turnTokens > b.maxTurnTokens;
  const over = overSessionCost || overTurnCost || overSessionTok || overTurnTok;
  if (!over) return {};
  const mode = b.onExceed ?? "block";
  const detail = `session $${state.sessionCost.toFixed(4)}/${b.maxSessionCostUsd ?? "∞"}, turn $${state.turnCost.toFixed(4)}/${b.maxTurnCostUsd ?? "∞"}, tokens ${state.sessionTokens}/${b.maxSessionTokens ?? "∞"}`;
  if (mode === "warn") {
    if (!state.budgetAnnounced) {
      state.budgetAnnounced = true;
      ctx.ui.notify(`Control layer: budget exceeded (warning mode) — ${detail}`, "warning");
      reportAudit("budget_warn", { detail }, ctx);
    }
    return {};
  }
  reportAudit("budget_block", { detail }, ctx);
  return { block: true, reason: `Budget exceeded — ${detail}` };
}

// ---------------------------------------------------------------- redaction + injection scanning

function redactText(text: string, path: string | null): { text: string; applied: string[] } {
  const applied: string[] = [];
  let out = text;
  for (const rule of pathRulesFor(path ?? "").redact) {
    if (path) {
      const res = compileList(rule.pattern, true);
      if (!matchesAny(res, path) && !matchesAny(res, expandTilde(path))) continue;
    } else continue;
    for (const rp of rule.redactionPatterns ?? []) {
      try {
        const re = compileRegex(rp.regex);
        if (re.test(out)) { out = out.replace(re, rp.replacement ?? "[REDACTED]"); applied.push(rp.id); }
      } catch { /* bad regex in policy: skip */ }
    }
  }
  return { text: out, applied };
}

function scanInjection(text: string, ctx: ExtensionContext, source: string): string {
  const inj = state.merged.injection;
  if (!inj || inj.enabled === false) return text;
  const hits: string[] = [];
  for (const p of inj.patterns ?? []) {
    try { if (compileRegex(p.regex).test(text)) hits.push(p.id); } catch { /* skip */ }
  }
  if (hits.length === 0) return text;
  const mode = inj.onDetect ?? "warn";
  reportAudit("injection_detected", { ruleIds: hits, detail: source }, ctx);
  if (mode === "block") {
    return `[CONTROL LAYER: content from ${source} blocked — prompt-injection signature(s): ${hits.join(", ")}]`;
  }
  ctx.ui.notify(`Control layer: possible prompt injection in ${source} (${hits.join(", ")})`, "warning");
  return `[CONTROL LAYER WARNING: possible prompt injection (${hits.join(", ")}) in ${source}]\n${text}`;
}

// ---------------------------------------------------------------- extension wiring

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    state.policyPath = findPolicyPath(ctx);
    state.sessionStart = Date.now();
    state.sessionCost = 0; state.sessionTokens = 0;
    state.sessionId = ctx.sessionManager.getSessionFile() ?? null;
    state.agentId = agentIdentity(ctx);
    loadPolicy(state.policyPath, ctx);
    recomputeMerged();
    // In non-interactive runs (-p) the process must exit once the answer is printed.
    // The websocket, its reconnect timer and the policy file poller keep the event
    // loop alive, so only start them for interactive sessions.
    if (ctx.hasUI) {
      connectControlPlane(state.merged.controlPlane?.url, ctx);
      startReconnect(ctx);
      try { watchFile(state.policyPath, { interval: 1000 }, () => loadPolicy(state.policyPath, ctx)); } catch { /* polling not critical */ }
    }
    wsSend({ type: "session_meta", agent: state.agentId, cwd: ctx.cwd, sessionId: state.sessionId, ts: new Date().toISOString() });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    state.turnStart = Date.now();
    state.turnCost = 0; state.turnTokens = 0; state.budgetAnnounced = false;
    const sp = state.merged.systemPrompt;
    if (!sp || sp.mode === "none" || !sp.text) return undefined;
    if (sp.mode === "replace") return { systemPrompt: sp.text };
    return { systemPrompt: `${event.systemPrompt}\n\n${sp.text}` };
  });

  pi.on("tool_call", async (event, ctx) => {
    // long-running alert timers
    state.toolTimers.set(event.toolCallId, { label: event.toolName, start: Date.now() });

    if (event.toolName === "bash" || event.toolName === "powershell") {
      const command = String(event.input.command ?? "");
      const v = await checkCommand(command, ctx);
      if (v.block) return { block: true, reason: v.reason };
      return undefined;
    }

    if (["read", "write", "edit", "ls", "grep", "find"].includes(event.toolName)) {
      const rawPath = String(event.input.path ?? "");
      const v = await checkPath(event.toolName, rawPath, ctx);
      if (v.block) return { block: true, reason: v.reason };
      return undefined;
    }

    // Unknown/custom tools (e.g. MCP): budget + time only
    const tv = checkTime(Date.now(), ctx);
    if (tv.block) return { block: true, reason: tv.reason };
    const bv = checkBudget(ctx);
    if (bv.block) return { block: true, reason: bv.reason };
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    // command output redaction (secret leak prevention on egress)
    if (event.toolName === "bash" && !event.isError) {
      const command = String(event.input?.command ?? "");
      const outRules = (state.merged.commands?.outputRedact ?? []).filter((r) => r.enabled !== false);
      const hit = outRules.find((r) => matchesAny(compileList(r.pattern, false), command));
      if (hit) {
        const texts = event.content.filter((c) => c.type === "text");
        if (texts.length > 0) {
          const secretRules = pathRulesFor("").redact; // reuse the default redaction regex set
          const newContent = event.content.map((c) => {
            if (c.type !== "text") return c;
            let text = c.text;
            for (const sr of secretRules) {
              for (const rp of sr.redactionPatterns ?? []) {
                try { text = text.replace(compileRegex(rp.regex), rp.replacement ?? "[REDACTED]"); } catch { /* skip */ }
              }
            }
            return { ...c, text };
          });
          reportAudit("redacted", { tool: "bash", ruleIds: [hit.id], detail: command }, ctx);
          return { content: newContent };
        }
      }
    }
    // long-running alert
    const timer = state.toolTimers.get(event.toolCallId);
    state.toolTimers.delete(event.toolCallId);
    const alertAfter = state.merged.time?.alertAfterSeconds;
    if (timer && alertAfter) {
      const dur = (Date.now() - timer.start) / 1000;
      if (dur > alertAfter) {
        reportAudit("long_running_tool", { tool: event.toolName, detail: `${Math.round(dur)}s` }, ctx);
        ctx.ui.notify(`Control layer: ${event.toolName} ran ${Math.round(dur)}s (alert threshold ${alertAfter}s)`, "warning");
      }
    }

    if (event.isError) return undefined;
    const texts = event.content.filter((c) => c.type === "text");
    if (texts.length === 0) return undefined;

    let changed = false;
    const source = event.toolName === "bash" ? `command output` : String(event.input?.path ?? event.toolName);
    const newContent = event.content.map((c) => {
      if (c.type !== "text") return c;
      let text = c.text;
      if (event.toolName === "read") {
        const path = String(event.input?.path ?? "");
        const r = redactText(text, path);
        if (r.applied.length) { text = r.text; changed = true; reportAudit("redacted", { tool: "read", ruleIds: r.applied, detail: path }, ctx); }
      }
      if (state.merged.injection?.scanToolResults !== false) {
        const scanned = scanInjection(text, ctx, source);
        if (scanned !== text) { text = scanned; changed = true; }
      }
      return { ...c, text };
    });
    if (changed) return { content: newContent };
    return undefined;
  });

  pi.on("message_end", async (event, ctx) => {
    const m = event.message;
    if (m.role === "assistant" && m.usage) {
      const cost = m.usage.cost?.total ?? 0;
      const tokens = m.usage.totalTokens ?? 0;
      state.sessionCost += cost; state.turnCost += cost;
      state.sessionTokens += tokens; state.turnTokens += tokens;
      checkBudget(ctx); // warn-mode notifications fire here; block-mode gates the next tool call
    }
  });

  pi.on("session_shutdown", async () => {
    if (wsReconnect) { clearInterval(wsReconnect); wsReconnect = null; }
    for (const [, p] of pendingApprovals) { clearTimeout(p.timer); p.resolve(false); }
    pendingApprovals.clear();
    try { ws?.close(); } catch { /* noop */ }
    ws = null;
  });

  // Manual command for demos / judges: /ctl-reload
  pi.registerCommand("ctl-reload", {
    description: "Reload the AI Control Layer policy",
    handler: async (_args, ctx) => {
      state.mtimeMs = 0;
      loadPolicy(state.policyPath, ctx);
      ctx.ui.notify("Control layer policy reloaded", "info");
    },
  });
}
