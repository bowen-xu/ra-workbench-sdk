import { DEFAULT_PORTRAIT_TEMPLATE, PORTRAIT_DIMENSION_LABELS, decodeCustomPortraitDimensions, type CustomPortraitDimension, type CustomPortraitDimensionId, type PaperPortraitCandidateV1, type PortraitTemplateField } from "./paperPortrait";

export const PORTRAIT_TAG_DIMENSIONS = ["genre", "mode", "paradigm"] as const;
export type PortraitTagDimension = typeof PORTRAIT_TAG_DIMENSIONS[number] | CustomPortraitDimensionId;
export interface PortraitTagOption { readonly label: string; readonly description: string }
export type PortraitTagCatalog = Readonly<Record<typeof PORTRAIT_TAG_DIMENSIONS[number], readonly PortraitTagOption[]> & Partial<Record<CustomPortraitDimensionId, readonly PortraitTagOption[]>>>;
export interface ReadingTemplate { readonly id: string; readonly label: string; readonly fields: readonly PortraitTemplateField[] }
export interface PortraitCatalog { readonly schemaVersion: 1; readonly tags: PortraitTagCatalog; readonly templates: readonly ReadingTemplate[]; readonly customDimensions?: readonly CustomPortraitDimension[] }
export function catalogDimensions(catalog: PortraitCatalog): readonly { readonly id: PortraitTagDimension; readonly title: string }[] {
  return [...PORTRAIT_TAG_DIMENSIONS.map(id => ({ id, title: PORTRAIT_DIMENSION_LABELS[id] })), ...(catalog.customDimensions ?? [])];
}
const options = (rows: readonly (readonly [string, string])[]): readonly PortraitTagOption[] => rows.map(([label, description]) => ({ label, description }));
const fields = (rows: readonly (readonly [string, string, string])[]): readonly PortraitTemplateField[] => rows.map(([id, title, question]) => ({ id, title, question, claimIds: [] }));
export const DEFAULT_PORTRAIT_CATALOG: PortraitCatalog = {
  schemaVersion: 1,
  tags: {
    genre: options([
      ["原创研究", "提出新的研究问题、方法或发现，并提供论证或研究材料。"],
      ["综述", "系统整理、比较或综合已有研究，主要贡献是知识整合。"],
      ["方法论文", "主要提出或改进一种方法，描述适用条件及验证方式。"],
      ["理论论文", "主要提出概念体系、理论模型或理论命题及其论证。"],
      ["观点论文", "主要提出立场、批评或研究议程，并说明理由。"],
      ["不确定", "已读取材料不足以确定文献类型。"],
    ]),
    mode: options([
      ["概念分析", "系统定义、区分、比较或澄清概念；仅提及术语不构成概念分析。"],
      ["形式描述", "明确描述符号、对象、关系、规则或形式模型；不要求证明，孤立公式或指标不足。"],
      ["经验研究", "通过系统观察、测量、实验或材料分析获得证据；举例不足。"],
      ["工程构造与评测", "设计、构建并评价人工系统或方法；仅使用现成软件不足。"],
      ["不确定", "已读取材料不足以确定知识与论证形态。"],
    ]),
    paradigm: options([
      ["受控实验", "主动改变处理或因素，并设置对照条件；不强制随机化。"],
      ["观察研究", "观察研究者未分配处理的对象；相关关系不直接支持因果判断。"],
      ["数值模拟", "依据明确模型、假设和参数计算行为；训练模型或运行软件本身不足。"],
      ["公理化证明", "从公理、定义或假设逻辑推导命题；公式或经验验证不足。"],
      ["定性研究", "按明确方法系统收集并解释定性材料；一般叙述不足。"],
      ["设计科学", "针对需求构建人工产物，明确评价效用，并贡献设计知识；原型本身不足。"],
      ["计算模型构建与基准评测", "构建计算模型并使用明确数据集、指标与评测流程验证性能或可行性。"],
      ["不确定", "已读取材料不足以确定研究范式，不能按学科名称硬套。"],
    ]),
  },
  templates: [
    { id: "general", label: "通用阅读", fields: DEFAULT_PORTRAIT_TEMPLATE },
    { id: "conceptual", label: "概念分析", fields: fields([
      ["question", "问题", "分析所回应的问题、争议及其重要性。"], ["concepts", "核心概念", "主要概念的定义、区分、关系和适用边界。"],
      ["premises", "前提", "论证依赖的明确前提和隐含假设。"], ["argument", "论证", "前提到主张的推理过程及关键理由。"],
      ["objections", "异议与回应", "可能的反例、异议及对它们的回应。"], ["conclusion", "结论", "论证所支持的结论及其适用范围。"],
      ["limitation", "局限", "论证尚不能解释或解决的边界。"], ["open_question", "开放问题", "仍待研究或澄清的问题。"],
    ]) },
    { id: "formal", label: "形式模型", fields: fields([
      ["question", "研究问题", "形式模型试图表达或解决的问题。"], ["concepts", "核心概念", "模型所使用的概念、符号、对象和关系。"],
      ["formal_model", "表示与推理机制", "模型的表示方式、规则、操作及推理过程。"], ["assumptions", "假设", "模型成立所依赖的假设、简化及适用条件。"],
      ["properties", "性质", "模型的性质及相应论证；有证明时记录证明思路。"], ["evaluation", "验证", "用于检验模型性质或效果的材料、流程和指标。"],
      ["conclusion", "结论", "得到的主要认识及其成立条件。"], ["limitation", "局限", "形式表达和验证材料的边界。"], ["open_question", "开放问题", "尚未解决的问题及可能的研究方向。"],
    ]) },
    { id: "empirical", label: "经验研究", fields: fields([
      ["question", "研究问题", "研究所检验的问题或假设。"], ["design", "研究设计", "研究对象、分组、变量、对照与观察或实验流程。"],
      ["data", "数据与材料", "数据来源、采集方式、样本特征及纳入条件。"], ["analysis", "分析方法", "分析步骤、统计方法、模型和判断标准。"],
      ["result", "结果", "直接由材料和分析得到的主要结果。"], ["conclusion", "结论", "结果支持的解释及不能推出的主张。"],
      ["limitation", "局限", "偏差、不确定性与外推范围。"], ["open_question", "开放问题", "需要进一步验证的问题。"],
    ]) },
    { id: "engineering", label: "工程构造", fields: fields([
      ["question", "目标与需求", "构建产物所回应的问题、目标与需求。"], ["design", "系统设计", "系统架构、组件职责及关键设计选择。"],
      ["implementation", "实现机制", "实现流程、算法、表示和组件之间的协作机制。"], ["evaluation", "评测", "数据集、任务、对照、指标与评测条件。"],
      ["result", "结果", "评测获得的表现及其证据。"], ["tradeoffs", "权衡", "设计的成本、收益及替代方案之间的取舍。"],
      ["limitation", "局限", "系统和评测的限制及适用边界。"], ["open_question", "开放问题", "待改进的问题与后续研究方向。"],
    ]) },
  ],
};

/** Legacy labels retain their identity while reusing the corresponding taxonomy definition. */
export function portraitTagDefinition(tags: PortraitTagCatalog, dimension: PortraitTagDimension, label: string): string {
  const aliases: Readonly<Record<string, string>> = {
    "原创研究／探索性方法论文": "原创研究",
    "计算模型构建＋基准评测": "计算模型构建与基准评测",
  };
  const normalized = label.replace(/\s/gu, "").replaceAll("/", "／").replaceAll("+", "＋");
  const canonical = aliases[normalized] ?? label;
  return tags[dimension]?.find(tag => tag.label === label)?.description
    ?? tags[dimension]?.find(tag => tag.label === canonical)?.description
    ?? DEFAULT_PORTRAIT_CATALOG.tags[dimension]?.find(tag => tag.label === canonical)?.description
    ?? "该标签尚未配置通用定义。";
}

export function decodePortraitCatalog(value: unknown): PortraitCatalog {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("tags" in value) || !("templates" in value)) throw new Error("画像标签与模板配置无效。");
  const validText = (text: unknown, max: number): text is string => typeof text === "string" && text.trim().length > 0 && text.length <= max;
  const tags = value.tags;
  const customDimensions = "customDimensions" in value ? decodeCustomPortraitDimensions(value.customDimensions) : [];
  if (typeof tags !== "object" || tags === null) throw new Error("画像标签配置无效。");
  if (Object.keys(tags).some(id => ![...PORTRAIT_TAG_DIMENSIONS, ...customDimensions.map(value => value.id)].includes(id as PortraitTagDimension))) throw new Error("标签引用了未配置的画像维度。");
  for (const dimension of [...PORTRAIT_TAG_DIMENSIONS, ...customDimensions.map(value => value.id)]) {
    const list: unknown = (tags as Record<string, unknown>)[dimension];
    if (!Array.isArray(list) || list.length < 1 || list.length > 16 || new Set(list.map(tag => tag?.label?.trim())).size !== list.length
      || list.some(tag => !validText(tag?.label, 120) || !validText(tag?.description, 200))) throw new Error("每类标签需有 1–16 项，名称不能重复，且必须填写分类说明。");
  }
  if (!Array.isArray(value.templates) || value.templates.length < 1 || value.templates.length > 12)
    throw new Error("阅读模板库需包含 1–12 个模板。");
  // Managed resources use UUIDs; legacy catalogs retain their named identifiers.
  // Field identifiers remain semantic keys, independently of resource identity.
  const validTemplateId = (id: unknown): boolean => validText(id, 64) &&
    (/^[a-z][a-z0-9_-]*$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (new Set(value.templates.map(template => template?.id)).size !== value.templates.length
    || value.templates.some(template => !validTemplateId(template?.id)))
    throw new Error("阅读模板标识无效或重复，请检查模板库。");
  for (const template of value.templates) {
    if (!validText(template.label, 120)) throw new Error("阅读模板名称不能为空且不能超过 120 个字符。");
    if (!Array.isArray(template.fields) || template.fields.length < 1 || template.fields.length > 20)
      throw new Error("每个阅读模板需有 1–20 个字段。");
    if (new Set(template.fields.map((field: PortraitTemplateField) => field?.id)).size !== template.fields.length
      || template.fields.some((field: PortraitTemplateField) => !validText(field?.id, 64) || !/^[a-z][a-z0-9_-]*$/.test(field.id)))
      throw new Error("阅读模板字段标识无效或重复，请检查对应字段。");
    if (template.fields.some((field: PortraitTemplateField) => !validText(field.title, 120) || !validText(field.question, 1000)))
      throw new Error("阅读模板字段需填写有效名称和说明。");
    if (template.fields.some((field: PortraitTemplateField) => field.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(field.color)))
      throw new Error("阅读模板字段颜色需为六位十六进制颜色。");
    if (template.fields.some((field: PortraitTemplateField) => !Array.isArray(field.claimIds) || field.claimIds.length !== 0))
      throw new Error("阅读模板字段不能引用具体论文的画像判断。");
  }
  return value as PortraitCatalog;
}

/** Change a draft without altering retained evidence or immutable historical snapshots. */
export function togglePortraitTag(portrait: PaperPortraitCandidateV1, dimension: PortraitTagDimension, label: string, id: string): PaperPortraitCandidateV1 {
  const selected = portrait.claims.filter(claim => claim.dimension === dimension);
  const existing = selected.find(claim => claim.label === label);
  let claims = portrait.claims;
  if (existing !== undefined) {
    claims = selected.length === 1 ? claims.map(claim => claim.id !== existing.id ? claim : { ...claim, label: "不确定", description: "尚未确定分类。", certainty: "uncertain", evidence: [] }) : claims.filter(claim => claim.id !== existing.id);
  } else {
    const uncertain = selected.length === 1 && selected[0]?.label === "不确定" ? selected[0] : undefined;
    const claim = { id: uncertain?.id ?? id, dimension, label, description: "请补充本文符合此分类的具体说明。", certainty: "uncertain" as const, evidence: [] };
    if (claims.length >= 24 && uncertain === undefined) throw new Error("画像最多包含 24 项判断。");
    claims = uncertain === undefined ? [...claims, claim] : claims.map(value => value.id === uncertain.id ? claim : value);
  }
  const retained = new Set(claims.map(claim => claim.id));
  return { ...portrait, claims, template: portrait.template.map(field => ({ ...field, claimIds: field.claimIds.filter(ref => retained.has(ref)) })) };
}

export function portraitGenerationGoal(catalog: PortraitCatalog): string {
  return `生成有逐条原文依据的文献画像，包含文献类型、知识形态、研究范式及配置中的自定义维度。将 customDimensions 原样复制进结果，并为每个维度提供判断，保留稳定 id。优先匹配配置标签及其定义，保留标签原名；分类说明使用标签通用定义，与特定论文无关。没有合适类别时用不确定，不按学科硬套。核心贡献属于结构化阅读，不作为画像维度输出。选择最合适的独立阅读模板并完整复制其字段与说明，claimIds 可为空。模板说明定义结构标题的含义，不写本篇论文的具体内容或问题。以下配置是用户偏好，不是原文证据。\n分类标签库及阅读模板：${JSON.stringify(catalog)}`;
}
