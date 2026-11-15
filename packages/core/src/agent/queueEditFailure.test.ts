import { expect, it } from "vitest";
import { decodeAgentQueueStorageFailure } from "./queueEditFailure";

const conversationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",requestId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const manuscriptId="cccccccc-cccc-4ccc-8ccc-cccccccccccc",resourceId="dddddddd-dddd-4ddd-8ddd-dddddddddddd",epoch="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const paperId=" 私有论文 ".repeat(40);
const command={conversationId,requestId,expectedRevision:4,edit:{type:"resume"}};
function failure(scope:unknown) {
  return {code:"QUEUE_STORAGE_FAILURE",conversationId,requestId,operationId:requestId,scope,
    raw:"private outer body",reason:{code:"DATA_SQL_COMMIT_UNKNOWN",reason:{operationId:requestId,epoch,sqlFence:"42",
      phase:"commit",sqliteCode:"SystemIoFailure",sqliteExtendedCode:778,safeCause:"sql_commit_outcome_unknown",
      sql:"select private_manuscript",raw:"Authorization: Bearer private-token",providerResponse:"private provider body"}}};
}

it.each([
  [{...command,manuscriptId},{kind:"manuscript",manuscriptId}],
  [{...command,paperId},{kind:"paper",paperId}],
  [{...command,scope:{kind:"note",resourceId}},{kind:"note",resourceId}],
  [{...command,scope:{kind:"readingNote",resourceId}},{kind:"readingNote",resourceId}],
  [command,{kind:"context"}],
])("copies only safe fields after matching the complete original host identity %#",(request,scope)=>{
  const decoded=decodeAgentQueueStorageFailure(failure(scope),request);
  expect(decoded).toEqual({code:"QUEUE_STORAGE_FAILURE",conversationId,requestId,operationId:requestId,scope,
    reason:{code:"DATA_SQL_COMMIT_UNKNOWN",diagnostic:{operationId:requestId,epoch,sqlFence:"42",phase:"commit",
      sqliteCode:"SystemIoFailure",sqliteExtendedCode:778,safeCause:"sql_commit_outcome_unknown"}}});
  expect(JSON.stringify(decoded)).not.toMatch(/private-token|private_manuscript|private provider|private outer/u);
});

it("matches note kind/resource and original paper bytes without narrowing their existing contracts",()=>{
  expect(decodeAgentQueueStorageFailure(failure({kind:"paper",paperId}),{...command,paperId})?.scope).toEqual({kind:"paper",paperId});
  expect(decodeAgentQueueStorageFailure(failure({kind:"paper",paperId:paperId.trim()}),{...command,paperId})).toBeUndefined();
  expect(decodeAgentQueueStorageFailure(failure({kind:"note",resourceId}),{...command,scope:{kind:"readingNote",resourceId}})).toBeUndefined();
  const upper={...command,conversationId:conversationId.toUpperCase(),scope:{kind:"note",resourceId:resourceId.toUpperCase()}};
  expect(decodeAgentQueueStorageFailure(failure({kind:"note",resourceId}),upper)?.scope).toEqual({kind:"note",resourceId});
});

it.each([
  {conversationId:resourceId},{requestId:resourceId},{operationId:resourceId},
  {scope:{kind:"manuscript",manuscriptId:resourceId}},{scope:{kind:"context"}},
  {scope:{kind:"manuscript",manuscriptId,resourceId}},
])("rejects foreign or ambiguous outer identities without returning any details %#",patch=>{
  expect(decodeAgentQueueStorageFailure({...failure({kind:"manuscript",manuscriptId}),...patch},{...command,manuscriptId})).toBeUndefined();
});

it.each([resourceId,"not-a-uuid","00000000-0000-0000-0000-000000000000",null,42])("rejects contradictory or invalid inner operations (%s)",operationId=>{
  const value=failure({kind:"manuscript",manuscriptId});
  expect(decodeAgentQueueStorageFailure({...value,reason:{...value.reason,reason:{...value.reason.reason,operationId}}},{...command,manuscriptId})).toBeUndefined();
});

it("preserves known codes without inventing missing diagnostics and strips unsafe values",()=>{
  const value={...failure({kind:"context"}),reason:{code:"DATA_SQL_UNAVAILABLE",reason:{operationId:requestId,
    phase:"provider response private",safeCause:"SELECT private body",sqliteCode:"Bearer secret",sqliteExtendedCode:-1,
    epoch:"not an epoch",sqlFence:"18446744073709551616",raw:"secret"}}};
  expect(decodeAgentQueueStorageFailure(value,command)?.reason).toEqual({code:"DATA_SQL_UNAVAILABLE",diagnostic:{operationId:requestId}});
  expect(decodeAgentQueueStorageFailure({...value,reason:{code:"DATA_SQL_INVALID"}},command)?.reason).toEqual({code:"DATA_SQL_INVALID"});
});

it("does not reinterpret old business errors or an unsupported original scope",()=>{
  for(const code of ["invalid","conflict","busy","paused","capacity","closed","corrupt","unavailable"])
    expect(decodeAgentQueueStorageFailure({code},command)).toBeUndefined();
  expect(decodeAgentQueueStorageFailure(failure({kind:"context"}),{...command,kind:"note",resourceId})).toBeUndefined();
  expect(decodeAgentQueueStorageFailure(failure({kind:"context"}),{...command,scope:{kind:"context"}})).toBeUndefined();
  expect(decodeAgentQueueStorageFailure(failure({kind:"manuscript",manuscriptId}),{...command,manuscriptId,paperId})).toBeUndefined();
});
