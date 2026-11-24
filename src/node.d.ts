// The little of Node that the worker and its tests use, so `tsc` passes without installing
// @types/node in the plugin.
declare module 'node:fs/promises' {
  export function readdir(path: string): Promise<string[]>
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function writeFile(path: string, data: string): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
}

declare module 'node:path' {
  export const sep: string
  export function join(...paths: string[]): string
  export function basename(path: string): string
}

declare const process: {
  pid: number
  ppid: number
  env: Record<string, string | undefined>
  kill(pid: number, signal?: string | number): true
}
