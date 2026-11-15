import {expect,it} from "vitest";
import native from "../../../../tests/fixtures/agent-writing-start-status-native-v1.json";
import {decodeAgentWritingStartStatusResponse,decodeAgentWritingCompactionStartStatusResponse} from "./writingStartStatus";

// Extracted from the actual production HTTP/Rust serde path's
// WRITING_START_STATUS_FIXTURE output, not a hand-authored Native stand-in.
it.each(native.cases)("decodes all four actual Rust status variants for $kind",sample=>{
  const decode=sample.kind==="ordinary"?decodeAgentWritingStartStatusResponse:decodeAgentWritingCompactionStartStatusResponse;
  for(const kind of ["prepared","started","notFound","unconfirmed"] as const){
    const wire=sample[kind],decoded=decode(wire);
    expect(decoded.intent).toEqual(wire.intent);expect(decoded.status.type).toBe(kind);
    if(decoded.status.type==="prepared"){
      expect(decoded.status.preview).toEqual(sample.prepared.status.preview);
      expect(decoded.status.preview.input.context[0]?.text).toBe(sample.prepared.status.preview.input.context[0]?.text);
    }
    if(decoded.status.type==="started")expect(decoded.status.result).toEqual(sample.started.status.result);
    if(decoded.status.type==="unconfirmed")expect(decoded.status.detail).toEqual(sample.unconfirmed.status.detail);
  }
});
