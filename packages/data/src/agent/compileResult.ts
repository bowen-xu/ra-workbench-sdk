import { AgentSubmissionDecodeError, decodeAgentCompileResult, type AgentCompileResult } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export interface AgentSynctexPdfLocation { readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface AgentSynctexSourceLocation { readonly relativePath: string; readonly line: number; readonly column: number | null }

export interface AgentCompileResultGateway {
  readPdf(result: AgentCompileResult): Promise<Uint8Array>;
  readSynctex(result: AgentCompileResult): Promise<Uint8Array>;
  forwardSynctex(result: AgentCompileResult, relativePath: string, line: number, column: number): Promise<readonly AgentSynctexPdfLocation[]>;
  inverseSynctex(result: AgentCompileResult, page: number, x: number, y: number): Promise<readonly AgentSynctexSourceLocation[]>;
}

function args(result: AgentCompileResult): Record<string, string> {
  return { resultId: result.resultId, ...result.identity };
}

function bytes(value: unknown): Uint8Array {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) throw new AgentSubmissionDecodeError();
  return new Uint8Array(value);
}

/** Reads only identity-bound, short-lived results produced by the approved workspace compiler. */
export function createAgentCompileResultGateway(invoke: AgentMetadataInvoke): AgentCompileResultGateway {
  return {
    async readPdf(result) {
      const decoded = decodeAgentCompileResult(result);
      if (!decoded.retained || decoded.status !== "succeeded" || !decoded.artifacts.pdf) throw new AgentSubmissionDecodeError();
      return bytes(await invoke("read_agent_compile_pdf", args(decoded)));
    },
    async readSynctex(result) {
      const decoded = decodeAgentCompileResult(result);
      if (!decoded.retained || decoded.status !== "succeeded" || !decoded.artifacts.synctex) throw new AgentSubmissionDecodeError();
      return bytes(await invoke("read_agent_compile_synctex", args(decoded)));
    },
    async forwardSynctex(result, relativePath, line, column) {
      const decoded = decodeAgentCompileResult(result);
      if (!decoded.retained || decoded.status !== "succeeded" || !decoded.artifacts.synctex || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0 || relativePath.trim() === "") throw new AgentSubmissionDecodeError();
      const value = await invoke("forward_agent_compile_synctex", { ...args(decoded), relativePath, line, column });
      if (!Array.isArray(value)) throw new AgentSubmissionDecodeError();
      return value.map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) throw new AgentSubmissionDecodeError();
        const row = item as Record<string, unknown>;
        if (!Number.isInteger(row.page) || (row.page as number) < 1 || typeof row.x !== "number" || !Number.isFinite(row.x) || typeof row.y !== "number" || !Number.isFinite(row.y) || typeof row.width !== "number" || !Number.isFinite(row.width) || typeof row.height !== "number" || !Number.isFinite(row.height)) throw new AgentSubmissionDecodeError();
        return { page: row.page as number, x: row.x as number, y: row.y as number, width: row.width as number, height: row.height as number };
      });
    },
    async inverseSynctex(result, page, x, y) {
      const decoded = decodeAgentCompileResult(result);
      if (!decoded.retained || decoded.status !== "succeeded" || !decoded.artifacts.synctex || !Number.isInteger(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new AgentSubmissionDecodeError();
      const value = await invoke("inverse_agent_compile_synctex", { ...args(decoded), page, x, y });
      if (!Array.isArray(value)) throw new AgentSubmissionDecodeError();
      return value.map((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) throw new AgentSubmissionDecodeError();
        const row = item as Record<string, unknown>;
        if (typeof row.relativePath !== "string" || row.relativePath.trim() === "" || !Number.isInteger(row.line) || (row.line as number) < 1 || (row.column !== null && (!Number.isInteger(row.column) || (row.column as number) < 1))) throw new AgentSubmissionDecodeError();
        return { relativePath: row.relativePath, line: row.line as number, column: row.column as number | null };
      });
    },
  };
}
