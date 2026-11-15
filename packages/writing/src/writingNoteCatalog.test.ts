import {expect,it} from "vitest";
import {noteDocumentPlainText,notePageId} from "@research-assistant/core/notes";
import {decodeWritingNote} from "./writingNote";
import fixtures from "../../../tests/contracts/writing-note-catalog-text.json";

it.each(fixtures)("shares the native writing-note projection contract: $name",fixture=>{
  if (!fixture.valid) {expect(()=>decodeWritingNote(JSON.stringify(fixture.content))).toThrow(); return;}
  const note = decodeWritingNote(JSON.stringify(fixture.content));
  expect(noteDocumentPlainText({schemaVersion:1,pageId:notePageId("projection"),blocks:note.blocks})).toBe(fixture.expectedText);
});
