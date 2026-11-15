import {expect,it} from "vitest";
import {decodeAgentContextPreview} from "./contextSession";

it("keeps the optional durable queue confirmation and rejects malformed identities",()=>{
  const preview={schemaVersion:1,conversationId:"11111111-1111-4111-8111-111111111111",requestId:"22222222-2222-4222-8222-222222222222",turnId:"33333333-3333-4333-8333-333333333333",contextSnapshotId:"44444444-4444-4444-8444-444444444444",input:{text:"Follow up",model:{providerId:"mock",modelId:"mock",revision:null},reasoningEffort:null,context:[]}};
  expect(decodeAgentContextPreview(preview).queue).toBeUndefined();
  const queue={inputId:"55555555-5555-4555-8555-555555555555",expectedRevision:3};
  expect(decodeAgentContextPreview({...preview,queue}).queue).toEqual(queue);
  for (const invalid of [{...queue,inputId:"other"},{...queue,expectedRevision:-1},{...queue,expectedRevision:1.5},{...queue,text:"injected"}])
    expect(()=>decodeAgentContextPreview({...preview,queue:invalid})).toThrow();
});
