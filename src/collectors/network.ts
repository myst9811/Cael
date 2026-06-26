import { $ } from "bun";
import type { NetworkPorts, PortEntry } from "./types";

export function parseLsofOutput(output: string, protocol: "tcp" | "udp"): PortEntry[] {
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("COMMAND"));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9) return [];
    const pid = parseInt(fields[1] ?? "");
    const process_name = fields[0];
    // NAME is at index 8; may be followed by "(LISTEN)" as a separate token
    const nameRaw = fields[8] ?? "";
    const lastColon = nameRaw.lastIndexOf(":");
    if (lastColon === -1) return [];
    const rawAddr = nameRaw.slice(0, lastColon);
    const port = parseInt(nameRaw.slice(lastColon + 1));
    if (isNaN(port)) return [];
    const address = rawAddr === "*" ? "0.0.0.0" : rawAddr.replace(/^\[/, "").replace(/\]$/, "");
    return [{
      port,
      protocol,
      address,
      pid: !isNaN(pid) ? pid : undefined,
      process_name: process_name || undefined,
    }];
  });
}

export function parseSsOutput(output: string): PortEntry[] {
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.startsWith("Netid"));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const netid = fields[0]?.toLowerCase();
    if (netid !== "tcp" && netid !== "udp") return [];
    const protocol = netid as "tcp" | "udp";

    const localAddr = fields[4] ?? "";
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) return [];
    const rawAddr = localAddr.slice(0, lastColon);
    const port = parseInt(localAddr.slice(lastColon + 1));
    if (isNaN(port)) return [];
    const address = rawAddr === "*" ? "0.0.0.0" : rawAddr.replace(/^\[/, "").replace(/\]$/, "");

    const processField = fields.slice(6).join(" ");
    const pidMatch = processField.match(/pid=(\d+)/);
    const nameMatch = processField.match(/"([^"]+)"/);
    const pid = pidMatch ? parseInt(pidMatch[1] ?? "") : undefined;
    const process_name = nameMatch ? nameMatch[1] : undefined;

    return [{ port, protocol, address, pid: pid && !isNaN(pid) ? pid : undefined, process_name }];
  });
}

export async function getListeningPorts(): Promise<NetworkPorts> {
  if (process.platform === "darwin") {
    const [tcpRes, udpRes] = await Promise.allSettled([
      $`lsof -i TCP -P -n -sTCP:LISTEN`.quiet().text(),
      $`lsof -i UDP -P -n`.quiet().text(),
    ]);
    const tcp = tcpRes.status === "fulfilled" ? parseLsofOutput(tcpRes.value, "tcp") : [];
    const udp = udpRes.status === "fulfilled" ? parseLsofOutput(udpRes.value, "udp") : [];
    return { ports: [...tcp, ...udp] };
  } else {
    const out = await $`ss -tulnp`.quiet().text();
    return { ports: parseSsOutput(out) };
  }
}
