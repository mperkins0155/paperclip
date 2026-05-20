import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_TIMEOUT_MS = 2_500;
const execFileAsync = promisify(execFile);

interface CodexOpsServiceStatus {
  id: string;
  name: string;
  url: string | null;
  status: "ok" | "warn" | "error" | "unknown";
  detail: string;
  responseTimeMs: number | null;
  checkedAt: string;
}

interface CodexOpsFileStatus {
  id: string;
  name: string;
  path: string | null;
  status: "ok" | "warn" | "error" | "unknown";
  detail: string;
  checkedAt: string;
  preview: string | null;
}

interface CodexOpsRuntimeAgent {
  id: string;
  name: string;
  source: "hermes" | "openclaw" | "process" | "cron";
  status: "active" | "running" | "scheduled" | "idle" | "warn" | "error" | "unknown";
  detail: string;
  updatedAt: string | null;
  pid?: number | null;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseServiceConfig(): Array<{ id: string; name: string; url: string | null }> {
  return [
    { id: "paperclip", name: "Paperclip", url: env("CODEX_OPS_PAPERCLIP_HEALTH_URL") ?? env("PAPERCLIP_HEALTH_URL") },
    { id: "openclaw", name: "OpenClaw gateway", url: env("CODEX_OPS_OPENCLAW_HEALTH_URL") },
    { id: "hermes", name: "Hermes gateway", url: env("CODEX_OPS_HERMES_HEALTH_URL") },
    { id: "openviking", name: "OpenViking", url: env("CODEX_OPS_OPENVIKING_HEALTH_URL") },
    { id: "nginx", name: "Private HTTPS edge", url: env("CODEX_OPS_EDGE_HEALTH_URL") },
  ];
}

async function checkUrl(id: string, name: string, url: string | null): Promise<CodexOpsServiceStatus> {
  const checkedAt = new Date().toISOString();
  if (!url) {
    return {
      id,
      name,
      url: null,
      status: "unknown",
      detail: "No health URL configured",
      responseTimeMs: null,
      checkedAt,
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json,text/plain,*/*" },
    });
    const responseTimeMs = Date.now() - startedAt;
    return {
      id,
      name,
      url,
      status: response.ok ? "ok" : "warn",
      detail: `HTTP ${response.status}`,
      responseTimeMs,
      checkedAt,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const detail = error instanceof Error ? error.message : "Request failed";
    return {
      id,
      name,
      url,
      status: "error",
      detail,
      responseTimeMs,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkFile(id: string, name: string, path: string | null): Promise<CodexOpsFileStatus> {
  const checkedAt = new Date().toISOString();
  if (!path) {
    return { id, name, path: null, status: "unknown", detail: "No path configured", checkedAt, preview: null };
  }

  try {
    await access(path, fsConstants.R_OK);
    const content = await readFile(path, "utf8");
    return {
      id,
      name,
      path,
      status: "ok",
      detail: "Readable",
      checkedAt,
      preview: content.slice(0, 2_000),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "File is not readable";
    return { id, name, path, status: "error", detail, checkedAt, preview: null };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readJson(path: string | null): Promise<unknown | null> {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function collectHermesRuntimeAgents(): Promise<CodexOpsRuntimeAgent[]> {
  const agents: CodexOpsRuntimeAgent[] = [];
  const checkedAt = new Date().toISOString();

  const addRuntimeProcess = (line: string, updatedAt = checkedAt) => {
    const match = line.trim().match(/^(\S+)\s+(\d+)\s+(.+)$/);
    if (!match) return;
    const [, user, pidText, cmd] = match;
    if (cmd.includes("hermes_cli.main gateway")) return;
    const pid = Number(pidText);
    if (!Number.isFinite(pid) || agents.some((agent) => agent.pid === pid)) return;
    const isHermes = cmd.includes("/.hermes/") || /claude/.test(cmd);
    agents.push({
      id: `process-${pid}`,
      name: cmd.includes("openclaw-gateway") ? "OpenClaw gateway process" : cmd.includes("claude") ? "Hermes Claude runtime" : "Hermes runtime process",
      source: isHermes ? "hermes" : "process",
      status: "running",
      detail: `${user} · ${cmd.slice(0, 160)}`,
      updatedAt,
      pid,
    });
  };

  const gatewayStatePath = env("CODEX_OPS_HERMES_STATE_FILE") ?? "/home/madis/.hermes/gateway_state.json";
  const gatewayState = asRecord(await readJson(gatewayStatePath));
  if (gatewayState) {
    const state = asString(gatewayState.gateway_state) ?? "unknown";
    const activeAgents = asNumber(gatewayState.active_agents);
    agents.push({
      id: "hermes-gateway",
      name: "Hermes gateway",
      source: "hermes",
      status: state === "running" ? "running" : state === "error" ? "error" : "warn",
      detail: `Gateway ${state}${activeAgents === null ? "" : ` · ${activeAgents} active delegated agents`}`,
      updatedAt: asString(gatewayState.updated_at),
      pid: asNumber(gatewayState.pid),
    });

    const exportedProcesses = Array.isArray(gatewayState.runtime_processes) ? gatewayState.runtime_processes : [];
    for (const processLine of exportedProcesses) {
      if (typeof processLine === "string") addRuntimeProcess(processLine, asString(gatewayState.exported_at) ?? checkedAt);
    }
  }

  const cronJobsPath = env("CODEX_OPS_HERMES_CRON_FILE") ?? "/home/madis/.hermes/cron/jobs.json";
  const cronState = asRecord(await readJson(cronJobsPath));
  const jobs = Array.isArray(cronState?.jobs) ? cronState.jobs : [];
  for (const rawJob of jobs) {
    const job = asRecord(rawJob);
    if (!job) continue;
    const id = asString(job.id) ?? `hermes-cron-${agents.length}`;
    const enabled = job.enabled !== false;
    const lastStatus = asString(job.last_status);
    const state = asString(job.state) ?? (enabled ? "scheduled" : "idle");
    agents.push({
      id: `hermes-cron-${id}`,
      name: asString(job.name) ?? "Hermes scheduled agent",
      source: "cron",
      status: enabled ? (lastStatus === "error" ? "error" : "scheduled") : "idle",
      detail: `${state}${lastStatus ? ` · last ${lastStatus}` : ""}${asString(job.next_run_at) ? ` · next ${asString(job.next_run_at)}` : ""}`,
      updatedAt: asString(job.last_run_at) ?? asString(cronState?.updated_at),
    });
  }

  if (process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("ps", ["-eo", "user=,pid=,cmd=", "--cols", "220"], { timeout: 1_500, maxBuffer: 256_000 });
      const interesting = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /hermes|claude|openclaw-gateway/i.test(line))
        .filter((line) => !/grep|ps -eo/i.test(line))
        .slice(0, 12);

      for (const line of interesting) addRuntimeProcess(line);
    } catch {
      // Process discovery is best-effort; the dashboard should still render static status.
    }
  }

  return agents;
}

export function codexOpsRoutes() {
  const router = Router();

  router.get("/companies/:companyId/codex-ops/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const [services, backup, deployment, openVikingLog, runtimeAgents] = await Promise.all([
      Promise.all(parseServiceConfig().map((service) => checkUrl(service.id, service.name, service.url))),
      checkFile("backup", "Backup status", env("CODEX_OPS_BACKUP_STATUS_FILE")),
      checkFile("deployment", "Deployment status", env("CODEX_OPS_DEPLOYMENT_STATUS_FILE")),
      checkFile("openviking", "OpenViking log/status", env("CODEX_OPS_OPENVIKING_STATUS_FILE")),
      collectHermesRuntimeAgents(),
    ]);

    const configuredServices = services.filter((service) => service.url).length;
    const okServices = services.filter((service) => service.status === "ok").length;
    const errorServices = services.filter((service) => service.status === "error").length;

    res.json({
      companyId,
      checkedAt: new Date().toISOString(),
      mode: "read_only",
      services,
      runtimeAgents,
      files: [backup, deployment, openVikingLog],
      openViking: {
        namespace: env("CODEX_OPS_OPENVIKING_NAMESPACE"),
        statusFileConfigured: Boolean(env("CODEX_OPS_OPENVIKING_STATUS_FILE")),
      },
      summary: {
        configuredServices,
        okServices,
        errorServices,
        runtimeAgents: runtimeAgents.length,
        runningRuntimeAgents: runtimeAgents.filter((agent) => ["active", "running", "scheduled"].includes(agent.status)).length,
        configuredFiles: [backup, deployment, openVikingLog].filter((file) => file.path).length,
      },
      env: {
        hasBackupStatusFile: Boolean(env("CODEX_OPS_BACKUP_STATUS_FILE")),
        hasDeploymentStatusFile: Boolean(env("CODEX_OPS_DEPLOYMENT_STATUS_FILE")),
        hasOpenVikingStatusFile: Boolean(env("CODEX_OPS_OPENVIKING_STATUS_FILE")),
      },
    });
  });

  return router;
}
