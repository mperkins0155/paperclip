import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock3,
  HardDrive,
  Network,
  Rocket,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { codexOpsApi, type CodexOpsRuntimeAgent, type CodexOpsServiceStatus } from "../api/codexOps";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { MetricCard } from "../components/MetricCard";
import { StatusIcon } from "../components/StatusIcon";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import type { Agent, Issue } from "@paperclipai/shared";

function statusTone(status: string) {
  if (["active", "running", "busy", "online"].includes(status)) return "text-emerald-500";
  if (["paused", "idle"].includes(status)) return "text-amber-500";
  if (["error", "failed", "offline"].includes(status)) return "text-red-500";
  return "text-muted-foreground";
}

function isDeploymentIssue(issue: Issue) {
  const text = `${issue.title} ${issue.description ?? ""} ${(issue.labels ?? []).map((label) => label.name).join(" ")}`.toLowerCase();
  return ["deploy", "deployment", "vps", "codex", "paperclip", "openviking", "backup", "security", "runtime"].some((term) => text.includes(term));
}

function agentSubtitle(agent: Agent) {
  return agent.title ?? agent.capabilities ?? agent.adapterType;
}

function runtimeAgentSubtitle(agent: CodexOpsRuntimeAgent) {
  return `${agent.source}${agent.pid ? ` · pid ${agent.pid}` : ""} · ${agent.detail}`;
}

function opsStatusTone(status: CodexOpsServiceStatus["status"]) {
  if (status === "ok") return "text-emerald-500";
  if (status === "warn" || status === "unknown") return "text-amber-500";
  return "text-red-500";
}

export function CodexHQ() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Codex HQ" }]);
  }, [setBreadcrumbs]);

  const enabled = !!selectedCompanyId;

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: selectedCompanyId ? ["codex-hq", "dashboard", selectedCompanyId] : ["codex-hq", "dashboard"],
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled,
  });

  const { data: agents } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "codex-hq"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled,
    refetchInterval: 15_000,
  });

  const { data: issues } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.issues.list(selectedCompanyId) : ["issues", "codex-hq"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 100 }),
    enabled,
    refetchInterval: 20_000,
  });

  const { data: activity } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.activity(selectedCompanyId) : ["activity", "codex-hq"],
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled,
    refetchInterval: 10_000,
  });

  const { data: projects } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "codex-hq"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled,
  });

  const { data: liveRuns } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.liveRuns(selectedCompanyId) : ["live-runs", "codex-hq"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled,
    refetchInterval: 10_000,
  });

  const { data: opsStatus } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.codexOps(selectedCompanyId) : ["codex-ops", "codex-hq"],
    queryFn: () => codexOpsApi.status(selectedCompanyId!),
    enabled,
    refetchInterval: 15_000,
  });

  const deploymentIssues = useMemo(() => (issues ?? []).filter(isDeploymentIssue), [issues]);
  const openDeploymentIssues = deploymentIssues.filter((issue) => !["done", "cancelled"].includes(issue.status));
  const blockedIssues = (issues ?? []).filter((issue) => issue.status === "blocked");
  const recentActivity = (activity ?? []).slice(0, 8);
  const runtimeAgents = opsStatus?.runtimeAgents ?? [];
  const visibleAgents = (agents ?? []).slice(0, 12);
  const visibleRuntimeAgents = runtimeAgents.slice(0, 12);
  const activeAgents = (agents ?? []).filter((agent) => ["active", "running"].includes(agent.status)).length + (opsStatus?.summary.runningRuntimeAgents ?? 0);
  const totalAgents = (agents?.length ?? 0) + runtimeAgents.length;
  const offlineAgents = (agents ?? []).filter((agent) => ["error", "terminated"].includes(agent.status)).length + runtimeAgents.filter((agent) => ["error", "warn"].includes(agent.status)).length;

  if (!selectedCompanyId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Codex HQ needs a selected company</h1>
          <p className="mt-2 text-sm text-muted-foreground">Select or create the Cobalt Intelligence Codex company first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-500">
            <TerminalSquare className="h-4 w-4" /> Cobalt Intelligence Codex
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Codex HQ</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            First live command-center pass: Paperclip company state, agent fleet, deployment work, activity, and the remaining VPS integrations in one view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-3 py-1">Paperclip-backed</span>
          <span className="rounded-full border border-border px-3 py-1">Tailscale-only target</span>
          <span className="rounded-full border border-border px-3 py-1">OpenViking pending</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card">
          <MetricCard icon={Bot} value={activeAgents} label="Active agents" description={`${totalAgents} registered/runtime agents`} to="/agents" />
        </div>
        <div className="rounded-lg border border-border bg-card">
          <MetricCard icon={Activity} value={liveRuns?.length ?? 0} label="Live runs" description="Current Paperclip heartbeat/task runs" to="/activity" />
        </div>
        <div className="rounded-lg border border-border bg-card">
          <MetricCard icon={Rocket} value={openDeploymentIssues.length} label="Deployment items" description="Codex/VPS/Paperclip/OpenViking work still open" to="/issues" />
        </div>
        <div className="rounded-lg border border-border bg-card">
          <MetricCard icon={AlertTriangle} value={blockedIssues.length} label="Blocked" description="Anything blocking go-live" to="/issues" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Network className="h-4 w-4" /> Agent fleet</h2>
            <p className="mt-1 text-xs text-muted-foreground">Paperclip company agents plus live Hermes runtime/process/cron discovery from the VPS.</p>
          </div>
          <div className="divide-y divide-border">
            {visibleAgents.length + visibleRuntimeAgents.length > 0 ? (<>
            {visibleAgents.map((agent) => (
              <Link key={agent.id} to={`/agents/${agent.urlKey || agent.id}`} className="flex items-center justify-between gap-3 p-4 no-underline hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={agent.status} />
                    <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{agentSubtitle(agent)}</p>
                </div>
                <span className={cn("shrink-0 text-xs font-medium capitalize", statusTone(agent.status))}>{agent.status}</span>
              </Link>
            ))}
            {visibleRuntimeAgents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={agent.status} />
                    <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hermes</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{runtimeAgentSubtitle(agent)}</p>
                </div>
                <span className={cn("shrink-0 text-xs font-medium capitalize", statusTone(agent.status))}>{agent.status}</span>
              </div>
            ))}
            </>) : (
              <div className="p-6 text-sm text-muted-foreground">No agents registered yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="h-4 w-4" /> Go-live state</h2>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Paperclip company</span><span className="font-medium text-emerald-500">selected</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Paperclip agents</span><span className="font-medium">{agents?.length ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Hermes runtime agents</span><span className="font-medium">{runtimeAgents.length}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Projects</span><span className="font-medium">{projects?.length ?? 0}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Open tasks</span><span className="font-medium">{dashboard?.tasks.open ?? (dashboardLoading ? "…" : 0)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">In progress</span><span className="font-medium">{dashboard?.tasks.inProgress ?? (dashboardLoading ? "…" : 0)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Offline/error agents</span><span className={cn("font-medium", offlineAgents > 0 ? "text-red-500" : "text-emerald-500")}>{offlineAgents}</span></div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ops checks</h3>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><HardDrive className="h-3.5 w-3.5" /> service health URLs</span><span className="font-medium text-foreground">{opsStatus?.summary.okServices ?? 0}/{opsStatus?.summary.configuredServices ?? 0}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> status files</span><span className="font-medium text-foreground">{opsStatus?.summary.configuredFiles ?? 0}/3</span></div>
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><CircleDot className="h-3.5 w-3.5" /> OpenViking namespace</span><span className="font-medium text-foreground">{opsStatus?.openViking.namespace ?? "not set"}</span></div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Rocket className="h-4 w-4" /> Deployment work</h2>
            <p className="mt-1 text-xs text-muted-foreground">Filtered from current issues using Codex/VPS/deploy/Paperclip/OpenViking/backup/security keywords.</p>
          </div>
          <div className="divide-y divide-border">
            {openDeploymentIssues.slice(0, 8).map((issue) => (
              <Link key={issue.id} to={`/issues/${issue.id}`} className="block p-4 no-underline hover:bg-accent/40">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-foreground">{issue.identifier ? `${issue.identifier} · ` : ""}{issue.title}</span>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">{issue.status}</span>
                </div>
                <p className="mt-1 text-xs capitalize text-muted-foreground">priority: {issue.priority}</p>
              </Link>
            ))}
            {openDeploymentIssues.length === 0 && <div className="p-6 text-sm text-muted-foreground">No deployment issues found yet. Seed the Codex go-live tasks into Paperclip next.</div>}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-4 w-4" /> Recent activity</h2>
          </div>
          <div className="divide-y divide-border">
            {recentActivity.map((event) => (
              <div key={event.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{event.action}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(event.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{event.actorType} → {event.entityType}</p>
              </div>
            ))}
            {recentActivity.length === 0 && <div className="p-6 text-sm text-muted-foreground">No activity yet.</div>}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-4 w-4" /> Codex ops API</h2>
          <p className="mt-1 text-xs text-muted-foreground">Read-only backend checks. Configure URLs/files with CODEX_OPS_* env vars on the Paperclip host.</p>
        </div>
        <div className="grid gap-0 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="divide-y divide-border">
            {(opsStatus?.services ?? []).map((service) => (
              <div key={service.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{service.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{service.url ?? service.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn("text-xs font-semibold uppercase", opsStatusTone(service.status))}>{service.status}</p>
                  <p className="text-xs text-muted-foreground">{service.responseTimeMs === null ? "—" : `${service.responseTimeMs}ms`}</p>
                </div>
              </div>
            ))}
            {!opsStatus && <div className="p-4 text-sm text-muted-foreground">Loading ops checks…</div>}
          </div>
          <div className="divide-y divide-border">
            {(opsStatus?.files ?? []).map((file) => (
              <div key={file.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className={cn("text-xs font-semibold uppercase", opsStatusTone(file.status))}>{file.status}</p>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{file.path ?? file.detail}</p>
              </div>
            ))}
            {!opsStatus && <div className="p-4 text-sm text-muted-foreground">Loading file checks…</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
