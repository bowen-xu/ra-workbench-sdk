import type {LiteratureDraft, LiteratureType} from "./literature";

const PRIMARY_CREATOR_ROLE_BY_TYPE: Readonly<Record<LiteratureType, string>> = {
  journalArticle: "author",
  magazineArticle: "author",
  newspaperArticle: "author",
  conferencePaper: "author",
  book: "author",
  bookSection: "author",
  preprint: "author",
  manuscript: "author",
  thesis: "author",
  report: "author",
  dataset: "author",
  computerProgram: "programmer",
  webpage: "author",
  standard: "author",
  patent: "inventor",
  document: "author",
};

const LITERATURE_TYPE_LABELS: Readonly<Record<LiteratureType, string>> = {
  journalArticle: "期刊论文",
  magazineArticle: "杂志文章",
  newspaperArticle: "报纸文章",
  conferencePaper: "会议论文",
  book: "书籍 / 会议录",
  bookSection: "书籍章节",
  preprint: "预印本",
  manuscript: "手稿",
  thesis: "学位论文",
  report: "报告",
  dataset: "数据集",
  computerProgram: "软件",
  webpage: "网页",
  standard: "标准",
  patent: "专利",
  document: "通用文献",
};

export const LITERATURE_TYPE_OPTIONS = (Object.keys(LITERATURE_TYPE_LABELS) as LiteratureType[]).map((value) => ({
  value,
  label: LITERATURE_TYPE_LABELS[value],
}));


export function primaryCreatorRoleForLiteratureType(itemType: LiteratureType): string { return PRIMARY_CREATOR_ROLE_BY_TYPE[itemType]; }

export interface LiteratureCreatorInput {
  readonly value: string;
  readonly edited: boolean;
}

export function formatLiteratureCreators(
  creators: LiteratureDraft["creators"],
  primaryRole = "author",
): string {
  return creators
    .filter((creator) => creator.role === primaryRole)
    .map((creator) => creator.literalName || [creator.familyName, creator.givenName].filter(Boolean).join(", "))
    .join("; ");
}

export function createLiteratureCreatorInput(
  creators: LiteratureDraft["creators"],
  primaryRole = "author",
): LiteratureCreatorInput {
  return {
    value: formatLiteratureCreators(creators, primaryRole),
    edited: false,
  };
}

export function updateLiteratureCreatorInput(
  input: LiteratureCreatorInput,
  value: string,
): LiteratureCreatorInput {
  return {
    ...input,
    value,
    edited: true,
  };
}

export function applyLiteratureCreatorInput(
  draft: LiteratureDraft,
  input: LiteratureCreatorInput,
): LiteratureDraft {
  if (!input.edited) return draft;

  const primaryRole = primaryCreatorRoleForLiteratureType(draft.itemType);
  const primaryCreators = input.value
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const [familyName = "", givenName = ""] = name.split(",").map((part) => part.trim());
      return { familyName, givenName, literalName: "", role: primaryRole };
    });

  return {
    ...draft,
    creators: [
      ...primaryCreators,
      ...draft.creators.filter((creator) => creator.role !== primaryRole),
    ],
    sourceKind: "user",
  };
}
