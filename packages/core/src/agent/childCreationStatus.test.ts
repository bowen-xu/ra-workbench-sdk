import { expect, it } from "vitest";
import { decodeAgentChildCreationStatusResponse } from "./childCreationStatus";

const id = (n: number) => `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const response = () => ({schemaVersion: 1, conversationId: id(1), turnId: id(2), callId: id(3), watermark: 4,
  creation: {schemaVersion: 1, conversationId: id(4), operationId: id(5),
    status: {type: "noSqlReceipt", epoch: id(6), sqlFence: "0", closed: false}}});

it("decodes optional cleanup receipt and rejects a different child", () => {
  expect(decodeAgentChildCreationStatusResponse(response()).cleanup).toBeUndefined();
  const cleanup = {schemaVersion: 1, conversationId: id(4), operationId: id(7),
    status: {type: "noSqlReceipt", epoch: id(6), sqlFence: "0", closed: false}};
  expect(decodeAgentChildCreationStatusResponse({...response(), cleanup}).cleanup).toEqual(cleanup);
  expect(() => decodeAgentChildCreationStatusResponse({...response(), cleanup: {...cleanup, conversationId: id(8)}})).toThrow();
  expect(() => decodeAgentChildCreationStatusResponse({...response(), cleanup: null})).toThrow();
});
