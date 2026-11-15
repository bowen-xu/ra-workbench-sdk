/** The complete, case-sensitive name is unique; contexts are separated by a backtick. */
export function validateConceptName(value: string): string {
  const name = value.trim();
  if (!name || [...name].length > 500) throw new Error("概念名称须为 1–500 个字符");
  if (name.split("`").some(part => !part.trim())) throw new Error("分隔符前的名称和分隔符后的语境均不能为空");
  return name;
}

export function splitConceptName(value: string): { readonly name: string; readonly context: string } {
  const separator = value.indexOf("`");
  return separator < 0 ? {name: value, context: ""} : {name: value.slice(0, separator), context: value.slice(separator)};
}

export function assertAvailableConceptName(
  label: string,
  concepts: readonly { readonly id: string; readonly label: string }[],
  current?: { readonly id: string; readonly label: string },
): string {
  const name = validateConceptName(label);
  // Existing duplicate records remain editable; only new collisions are forbidden.
  if (current?.label.trim() !== name && concepts.some(c => c.id !== current?.id && c.label.trim() === name)) {
    throw new Error("概念名称已存在，请使用不同名称，或用 ` 添加语境");
  }
  return name;
}

/** Only for importing old collections: keep separate identities without creating new homonyms. */
export function importedConceptName(label: string, concepts: readonly {readonly label:string}[]): string {
  const occupied=new Set(concepts.map(concept=>concept.label.trim()));
  const base=label.trim() || "旧概念";
  if(!occupied.has(base))return base;
  for(let index=2;;index++) {
    const suffix=`\`旧归类-${index}`;
    const candidate=[...base].slice(0,500-[...suffix].length).join("").replace(/`+$/u,"")+suffix;
    if(!occupied.has(candidate))return candidate;
  }
}
