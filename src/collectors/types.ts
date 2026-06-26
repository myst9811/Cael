export interface SystemMetrics {
  cpu_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
  disk_inode_percent?: number;
  load_avg: [number, number, number];
}

export interface DockerContainer {
  name: string;
  status: "running" | "exited" | "paused" | "restarting";
  health?: "healthy" | "unhealthy" | "starting" | "none";
  image: string;
  uptime?: string;
  exit_code?: number;
  ports: string[];
}

export interface DockerStatus {
  available: boolean;
  error?: string;
  containers: DockerContainer[];
}

export interface DockerLogsResult {
  logs: string;
  truncated: boolean;
}

export interface ContainerInspect {
  name: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  exitCode: number;
  image: string;
  ports: string[];
}

export interface GitStatus {
  is_git_repo: boolean;
  branch?: string;
  dirty_files?: number;
  unpushed_commits?: number | null;
  untracked_files?: number;
  stash_count?: number;
  last_commit_message?: string;
  last_commit_hash?: string;
}

export interface ProcessEntry {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
  user: string;
  command: string;
}

export interface ProcessList {
  processes: ProcessEntry[];
}

export interface PortEntry {
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  pid?: number;
  process_name?: string;
}

export interface NetworkPorts {
  ports: PortEntry[];
}

export interface ProcessNode {
  pid: number;
  ppid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
  children: ProcessNode[];
}

export interface ProcessTree {
  roots: ProcessNode[];
}

export interface ServiceEntry {
  name: string;
  source: "systemd" | "launchctl" | "docker-compose";
  status: "running" | "stopped" | "unknown";
  description?: string;
}

export interface RuntimeServices {
  services: ServiceEntry[];
  unavailable_sources: string[];
}

export interface LogPattern {
  pattern: string;
  count: number;
  first_seen?: string;
  last_seen?: string;
  level?: "error" | "warn" | "info" | "unknown";
}

export interface DockerLogPatterns {
  container: string;
  total_lines: number;
  lines_analyzed: number;
  truncated: boolean;
  error_count: number;
  warn_count: number;
  patterns: LogPattern[];
}

export type CollectorError = { error: string };

export interface CollectedContext {
  timestamp: string;
  system: SystemMetrics | CollectorError;
  docker: DockerStatus | CollectorError;
  git: GitStatus | CollectorError;
  processes: ProcessList | CollectorError;
}
