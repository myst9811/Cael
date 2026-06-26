import { join } from "node:path";

export interface DeployPolicy {
  cpu_warn: number;
  cpu_crit: number;
  mem_warn: number;
  mem_crit: number;
  disk_warn: number;
  disk_crit: number;
  go_threshold: number;       // raw score ≥ this → GO (out of 140, 7 checks × 20pts)
  caution_threshold: number;  // raw score ≥ this → CAUTION
}

// 7 checks × 20pts = 140 max. go=80% (112), caution=60% (84).
export const DEFAULT_POLICY: DeployPolicy = {
  cpu_warn: 70, cpu_crit: 85,
  mem_warn: 80, mem_crit: 90,
  disk_warn: 85, disk_crit: 95,
  go_threshold: 112, caution_threshold: 84,
};

async function readDeploy(path: string): Promise<Partial<DeployPolicy>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const raw = await file.json() as { deploy?: Partial<DeployPolicy> };
    return raw.deploy ?? {};
  } catch {
    return {};
  }
}

export async function loadDeployPolicy(
  projectPolicyPath = join(process.cwd(), ".cael", "policy.json"),
  userConfigPath = join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".cael", "config.json"),
): Promise<DeployPolicy> {
  const [project, user] = await Promise.all([
    readDeploy(projectPolicyPath),
    readDeploy(userConfigPath),
  ]);
  return { ...DEFAULT_POLICY, ...user, ...project };
}
