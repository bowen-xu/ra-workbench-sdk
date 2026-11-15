import { expect, it } from "vitest";
import { decodeAgentSqlImmediateFailure, isAgentSqlImmediateUnknown } from "./sqlImmediateDiagnostic";
import golden from "../../../../tests/fixtures/agent-sql-immediate-unknown-v1.json";

it("consumes the unchanged deployed Unknown golden and direct failure without rounding", () => {
  const expected = {code: golden.reason.code, diagnostic: golden.reason.reason};
  expect(decodeAgentSqlImmediateFailure(golden)).toEqual(expected);
  expect(decodeAgentSqlImmediateFailure(golden.reason)).toEqual(expected);
  expect(isAgentSqlImmediateUnknown(golden)).toBe(true);
});
it("retains only safe diagnostic fields rather than SQL messages or arbitrary provider JSON", () => {
  const failure = {code: "DATA_SQL_RECOVERY_REQUIRED", reason: {...golden.reason.reason,
    sqlFence: "18446744073709551616", safeCause: "secret SQL\nvalue", phase: "commit\nbody",
    sqliteExtendedCode: -1, requestBody: "private", message: "raw SQL"}};
  expect(decodeAgentSqlImmediateFailure(failure)).toEqual({code: failure.code, diagnostic: {
    operationId: golden.reason.reason.operationId, epoch: golden.reason.reason.epoch, sqliteCode: "SystemIoFailure",
  }});
  expect(isAgentSqlImmediateUnknown(failure)).toBe(true);
});
it("does not turn foreign errors or other classifications into commit-unknown proof", () => {
  for (const error of ["unavailable", {code: "authentication", reason: golden.reason.reason}, {code: "storage", reason: "raw"}]) {
    expect(decodeAgentSqlImmediateFailure(error)).toBeUndefined();
    expect(isAgentSqlImmediateUnknown(error)).toBe(false);
  }
  expect(isAgentSqlImmediateUnknown({code: "DATA_SQL_UNAVAILABLE", reason: null})).toBe(false);
  expect(decodeAgentSqlImmediateFailure({code: "DATA_SQL_UNAVAILABLE", reason: {epoch: null, sqlFence: null,
    sqliteCode: null, sqliteExtendedCode: null}})).toEqual({code: "DATA_SQL_UNAVAILABLE", diagnostic: {
      epoch: null, sqlFence: null, sqliteCode: null, sqliteExtendedCode: null}});
});
it("keeps confirmed partial external effects distinct from an unknown SQL commit", () => {
  const error={code:"DATA_OPERATION_PARTIAL",reason:{operationId:golden.reason.reason.operationId,phase:"delete-publication",safeCause:"delete_not_archived_after_workspace_cleanup"}};
  expect(decodeAgentSqlImmediateFailure(error)).toEqual({code:error.code,diagnostic:error.reason});
  expect(isAgentSqlImmediateUnknown(error)).toBe(false);
});
it("recognizes external outcome uncertainty without relabeling it as a SQL commit", () => {
 const error={code:"DATA_OPERATION_OUTCOME_UNKNOWN",reason:{operationId:golden.reason.reason.operationId,phase:"delete-workspace-discard",safeCause:"workspace_discard_unconfirmed"}};
 expect(decodeAgentSqlImmediateFailure(error)).toEqual({code:error.code,diagnostic:error.reason});expect(isAgentSqlImmediateUnknown(error)).toBe(true);
});
