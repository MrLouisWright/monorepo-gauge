export * from './core.js';
import type { Report, Config, Rule, Finding } from './core.js';
export const RULES: Record<string, Rule>;
export const DEFAULT_REQUIRED: { public: string[]; private: string[] };
export interface GaugeOptions { versioning?: 'fixed' | 'independent'; requiredFields?: string[]; requiredFieldsPrivate?: string[]; ignorePackages?: string[]; ignoreDeps?: string[]; includePeers?: boolean; consistentFields?: string[]; workspaceProtocol?: boolean; now?: Date }
export interface WorkspaceInfo { manager: string; sources: string[]; patterns: string[]; packages: { name: string; version?: string; dir: string; private: boolean; internalDeps: string[] }[] }
export function check(root: string, opts?: GaugeOptions, config?: Config & GaugeOptions, configFile?: string): Report & { info: WorkspaceInfo };
export function analyze(root: string, opts?: GaugeOptions): { info: WorkspaceInfo; findings: Finding[] };
export function findCycles(edges: Map<string, Set<string>>, limit?: number): string[][];
export function pnpmPatterns(yaml: string): string[];
export function expandWorkspaces(root: string, patterns: string[]): { packages: string[]; empty: string[] };
export function satisfies(version: string, range: string): boolean;
export function minVersion(range: string): { major: number; minor: number; patch: number; pre: string[] } | null;
