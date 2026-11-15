import {expect,it,vi} from "vitest";
import {createAgentNoteSteeringGateway} from "./noteSteering";
const conversationId="a1111111-1111-4111-8111-111111111111",resourceId="b1111111-1111-4111-8111-111111111111";
const turnId="c1111111-1111-4111-8111-111111111111",inputId="d1111111-1111-4111-8111-111111111111";
for(const kind of ["note","readingNote"] as const){
  const scope={conversationId,scope:{kind,resourceId},turnId};
  const request={...scope,inputId,text:"Use the retained source first"};
  const response={schemaVersion:1,conversationId,turnId,inputId};
  it(`admits ${kind} text without model or source refresh and only accepts its original receipt`,async()=>{
    const invoke=vi.fn().mockResolvedValue(response),gateway=createAgentNoteSteeringGateway(invoke);
    expect(await gateway.steer(request)).toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_steer_note_turn",{request});
    for(const patch of [{conversationId:inputId},{turnId:inputId},{inputId:turnId}]){
      invoke.mockResolvedValue({...response,...patch});await expect(gateway.steer(request)).rejects.toThrow();
    }
  });
  it(`isolates ${kind} caller and transport mutations and preserves unknown failures`,async()=>{
    let finish!:(value:unknown)=>void;
    const invoke=vi.fn((_command,args)=>{args.request.turnId=inputId;return new Promise(done=>{finish=done;});});
    const mutable=structuredClone(request),pending=createAgentNoteSteeringGateway(invoke).steer(mutable);
    mutable.turnId=inputId;mutable.scope.resourceId=turnId;finish(response);expect(await pending).toEqual(response);
    invoke.mockReset().mockRejectedValue({code:"unavailable"});
    await expect(createAgentNoteSteeringGateway(invoke).steer(request)).rejects.toEqual({code:"unavailable"});expect(invoke).toHaveBeenCalledOnce();
  });
  it(`recovers ${kind} terminal text without resubmission and rejects another same-ID host`,async()=>{
    const result={schemaVersion:1,...scope,inputs:[{inputId,text:request.text}]};
    const invoke=vi.fn().mockResolvedValue(result),gateway=createAgentNoteSteeringGateway(invoke);
    expect(await gateway.recover(scope)).toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_note_steering_recovery",{request:scope});
    invoke.mockResolvedValue({...result,scope:{...scope.scope,kind:kind==="note"?"readingNote":"note"}});
    await expect(gateway.recover(scope)).rejects.toThrow();
    for(const patch of [{turnId:inputId},{inputs:[result.inputs[0],result.inputs[0]]},{inputs:[{inputId,text:"\ud800"}]},{schemaVersion:2}]){
      invoke.mockResolvedValue({...result,...patch});await expect(gateway.recover(scope)).rejects.toThrow();
    }
  });
}
it("rejects malformed text, nil identities and authority before native invocation",async()=>{
  const scope={conversationId,scope:{kind:"note" as const,resourceId},turnId};
  const request={...scope,inputId,text:"Question"},invoke=vi.fn(),gateway=createAgentNoteSteeringGateway(invoke);
  for(const patch of [{text:" "},{text:"\ud800"},{text:"界".repeat(21846)},{inputId:"00000000-0000-0000-0000-000000000000"},{turnId:"bad"},{model:"override"},{context:[]},{allowDisclosure:true}]){
    await expect(gateway.steer({...request,...patch})).rejects.toThrow();
  }
  await expect(gateway.recover({...scope,text:"resubmit"} as never)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});
