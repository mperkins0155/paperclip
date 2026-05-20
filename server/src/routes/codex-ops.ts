import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { Router } from "express";
import { assertCompanyAccess } from "./authz.js";

const DEFAULT_TIMEOUT_MS = 2_500;

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

export function codexOpsRoutes() {
  const router = Router();

  router.get("/companies/:companyId/codex-ops/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const [services, backup, deployment, openVikingLog] = await Promise.all([
      Promise.all(parseServiceConfig().map((service) => checkUrl(service.id, service.name, service.url))),
      checkFile("backup", "Backup status", env("CODEX_OPS_BACKUP_STATUS_FILE")),
      checkFile("deployment", "Deployment status", env("CODEX_OPS_DEPLOYMENT_STATUS_FILE")),
      checkFile("openviking", "OpenViking log/status", env("CODEX_OPS_OPENVIKING_STATUS_FILE")),
    ]);

    const configuredServices = services.filter((service) => service.url).length;
    const okServices = services.filter((service) => service.status === "ok").length;
    const errorServices = services.filter((service) => service.status === "error").length;

    res.json({
      companyId,
      checkedAt: new Date().toISOString(),
      mode: "read_only",
      services,
      files: [backup, deployment, openVikingLog],
      openViking: {
        namespace: env("CODEX_OPS_OPENVIKING_NAMESPACE"),
        statusFileConfigured: Boolean(env("CODEX_OPS_OPENVIKING_STATUS_FILE")),
      },
      summary: {
        configuredServices,
        okServices,
        errorServices,
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
