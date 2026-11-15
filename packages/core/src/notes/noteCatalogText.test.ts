import fixtures from "../../../../tests/contracts/note-catalog-text.json";
import {expect,it} from "vitest";
import {decodeNoteDocument,noteDocumentPlainText} from "./document";
import {readingNoteDisplayTitle,type ReadingNoteSource} from "./readingNote";

it.each(fixtures)("freezes catalog text semantics: $name", fixture=>{
  const body=noteDocumentPlainText(decodeNoteDocument(fixture.document));
  expect(body).toBe(fixture.expectedText);
  expect(readingNoteDisplayTitle({body,source:{quoteExact:fixture.quote} as ReadingNoteSource},fixture.fallback)).toBe(fixture.expectedTitle);
});
