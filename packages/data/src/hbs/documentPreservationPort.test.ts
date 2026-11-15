import { expect, it } from "vitest";
import { HbsSession, createTextDocumentAdapter, type DocumentCheckpoint } from "@research-assistant/core/hbs";
import { createDocumentPreservationPort } from "./documentPreservationPort";
const adapter=createTextDocumentAdapter((a,b)=>a===b?[]:[{fromA:0,toA:a.length,fromB:0,toB:b.length}]);
it("waits for durable preservation before S and reports failure without submitting S",async()=>{
  let record:DocumentCheckpoint<string>|undefined,fail=false,commits=0;
  const preservation=createDocumentPreservationPort(adapter,async(operation,value)=>{
    if(operation==="readPreservation")return record??null;
    if(fail)throw new Error("disk unavailable");
    record=structuredClone(value as DocumentCheckpoint<string>);return {revision:1};
  });
  const port={read:async()=>({version:0,saved:"old",baseline:"old"}),commit:async(request:{saved:string;baseline:string})=>{commits++;expect(record?.content).toBe(request.saved);return {version:1,saved:request.saved,baseline:request.baseline};}};
  const session=await HbsSession.open({adapter,preservation,port,requestId:n=>`save-${n}`});
  session.edit("candidate");fail=true;await session.save();
  expect(commits).toBe(0);expect(record?.content).toBe("old");expect(session.getSnapshot().preservationError).toContain("disk unavailable");
  fail=false;await session.save();expect(commits).toBe(1);expect(record?.content).toBe("candidate");
  session.dispose();
});
it("restores only validated server checkpoints and refuses malformed acknowledgements",async()=>{
  const checkpoint={format:1,kind:"text",observed:{version:0,saved:"old",baseline:"old"},content:"mine",ancestor:"old",baselineAncestor:"old",ordinary:[]} as const;
  const port=createDocumentPreservationPort(adapter,async operation=>operation==="readPreservation"?checkpoint:{revision:0});
  expect((await port.load())?.content).toBe("mine");
  await expect(port.save(checkpoint)).rejects.toThrow("保全回执无效");
  const malformed=createDocumentPreservationPort(adapter,async()=>({...checkpoint,kind:"note"}));
  await expect(malformed.load()).rejects.toThrow("恢复类型不匹配");
});

it("preserves a saved candidate's review origin and rejects its wrong document type",async()=>{
  const checkpoint={format:1,kind:"text",observed:{version:3,saved:"91%",baseline:"80%"},content:"91%",ancestor:"91%",reviewAncestor:"85%",baselineAncestor:"80%",ordinary:[]} as const;
  const port=createDocumentPreservationPort(adapter,async()=>checkpoint);
  expect((await port.load())?.reviewAncestor).toBe("85%");
  const malformed=createDocumentPreservationPort(adapter,async()=>({...checkpoint,reviewAncestor:{text:"85%"}}));
  await expect(malformed.load()).rejects.toThrow("正文必须是文本");
});
