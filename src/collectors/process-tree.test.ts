import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePsTree, buildTree } from "./process-tree";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parsePsTree: parses all data rows skipping header", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  expect(nodes.length).toBe(7);
});

test("parsePsTree: extracts pid, ppid, cpu, mem, name", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const postgres = nodes.find(n => n.pid === 1002)!;
  expect(postgres.ppid).toBe(1);
  expect(postgres.cpu_percent).toBeCloseTo(2.3);
  expect(postgres.mem_mb).toBeCloseTo(100, 0);
  expect(postgres.name).toBe("postgres");
});

test("buildTree: init (pid=1) is a root", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes);
  expect(tree.roots.some(r => r.pid === 1)).toBe(true);
});

test("buildTree: children are attached to their parents", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes);
  const init = tree.roots.find(r => r.pid === 1)!;
  const childPids = init.children.map(c => c.pid);
  expect(childPids).toContain(1001);
  expect(childPids).toContain(1002);
});

test("buildTree with rootPid: returns only subtree", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes, 1002);
  expect(tree.roots.length).toBe(1);
  expect(tree.roots[0]!.pid).toBe(1002);
  expect(tree.roots[0]!.children.length).toBe(2);
});

test("buildTree with unknown rootPid: returns empty roots", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  expect(buildTree(nodes, 99999).roots).toHaveLength(0);
});

test("buildTree: default limit=50 caps root count", () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    pid: i + 1, ppid: 0, name: `proc${i}`, cpu_percent: i * 0.1, mem_mb: 10, children: [],
  }));
  const tree = buildTree(nodes, undefined, 3, 50);
  expect(tree.roots.length).toBeLessThanOrEqual(50);
});

test("buildTree: limit caps total nodes even when a single root has many descendants", () => {
  // 1 root (pid=1, ppid=0) with 100 direct children
  const nodes = [
    { pid: 1, ppid: 0, name: "root", cpu_percent: 1, mem_mb: 10, children: [] },
    ...Array.from({ length: 100 }, (_, i) => ({
      pid: i + 2, ppid: 1, name: `child${i}`, cpu_percent: 0, mem_mb: 5, children: [],
    })),
  ];
  const tree = buildTree(nodes, undefined, 3, 20);
  // Count all emitted nodes (root + its children)
  const countNodes = (n: ProcessNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
  const total = tree.roots.reduce((s, r) => s + countNodes(r), 0);
  expect(total).toBeLessThanOrEqual(20);
});

test("buildTree: maxDepth is respected", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes, 1, 1);
  const init = tree.roots.find(r => r.pid === 1)!;
  const sshd = init.children.find(c => c.pid === 1001)!;
  expect(sshd.children).toHaveLength(0); // bash should be cut off at depth 1
});
