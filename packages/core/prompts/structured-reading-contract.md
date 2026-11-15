文件必须是一个 JSON 对象，采用以下结构；替换示例中的占位文字，不增加包装层：

```json
{{ schema }}
```

fields 必须与指定模板的字段 ID 及顺序一致，paperTemplate 完整保留本轮版本的定义（含 claimIds），不可改成最新模板。status 仅为 filled、partial、not_found；not_found 的 statements 为空。

每条陈述使用稳定 id，text 为中文原子陈述，epistemicRole 仅为 source_paraphrase、inference、synthesis、uncertain。evidenceItemIds 必须来自实际读取的来源；evidenceQuotes 为每个引用提供非空、连续、逐字原文，选择最短充分支持片段，不编造或改写引文。证据不足或字段不适用时保留 not_found，不强行填写。
