import { expect, it } from "vitest";
import { mapTextPosition, mergeTextValue, selectedText, textChangesAt } from "./text";
import type { TextDiff } from "../textDiff";

it("maps replacement starts, interiors, ends and adjacent insertions with endpoint association",()=>{
  const replacement:TextDiff=()=>[{fromA:2,toA:5,fromB:2,toB:4}];
  for(const side of [-1,1] as const){
    expect(mapTextPosition("abcdefg","abXYfg",2,side,replacement)).toBe(2);
    expect(mapTextPosition("abcdefg","abXYfg",5,side,replacement)).toBe(4);
    expect(mapTextPosition("abcdefg","abXYfg",7,side,replacement)).toBe(6);
  }
  expect(mapTextPosition("abcdefg","abXYfg",3,-1,replacement)).toBe(2);
  expect(mapTextPosition("abcdefg","abXYfg",3,1,replacement)).toBe(4);
  const insertion:TextDiff=()=>[{fromA:2,toA:2,fromB:2,toB:5}];
  expect(mapTextPosition("ab🧪","ab新🧪🧪",2,-1,insertion)).toBe(2);
  expect(mapTextPosition("ab🧪","ab新🧪🧪",2,1,insertion)).toBe(5);
});

it("replaces only a selected range when the leaf has several independent changes",()=>{
  const calculate:TextDiff=()=>[{fromA:0,toA:1,fromB:0,toB:1},{fromA:4,toA:5,fromB:4,toB:5}];
  const changes=textChangesAt("a---b","x---y",[],calculate);
  expect(selectedText(changes[0]!,"after")).toEqual({base:"a---b",value:"x---b"});
  expect(selectedText(changes[1]!,"before")).toEqual({base:"x---y",value:"x---b"});
});

it("retains separate conflict ranges with full lossless leaf context",()=>{
  const calculate:TextDiff=(before,after)=>before===after?[]:[{fromA:0,toA:before.length,fromB:0,toB:after.length}];
  const result=mergeTextValue("80%","91%","90%",calculate);
  expect(result.value).toBe("91%");
  expect(result.conflicts[0]).toMatchObject({before:"80%",after:"91%",incoming:"90%",text:{fromA:0,toA:3,fromB:0,toB:3}});
});
