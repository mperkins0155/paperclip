import { api } from "./client";

export interface CodexOpsServiceStatus {
  id: string;
  name: string;
  url: string | null;
  status: "ok" | "warn" | "error" | "unknown";
  detail: string;
  responseTimeMs: number | null;
  checkedAt: string;
}

export interface CodexOpsFileStatus {
  id: string;
  name: string;
  path: string | null;
  status: "ok" | "warn" | "error" | "unknown";
  detail: string;
  checkedAt: string;
  preview: string | null;
}

export interface CodexOpsStatus {
  companyId: string;
  checkedAt: string;
  mode: "read_only";
  services: CodexOpsServiceStatus[];
  files: CodexOpsFileStatus[];
  openViking: {
    namespace: string | null;
    statusFileConfigured: boolean;
  };
  summary: {
    configuredServices: number;
    okServices: number;
    errorServices: number;
    configuredFiles: number;
  };
  env: {
    hasBackupStatusFile: boolean;
    hasDeploymentStatusFile: boolean;
    hasOpenVikingStatusFile: boolean;
  };
}

export const codexOpsApi = {
  status: (companyId: string) => api.get<CodexOpsStatus>(`/companies/${companyId}/codex-ops/status`),
};
