export interface ResearchProject {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly literatureCount: number;
  readonly evidenceCount: number;
}

export interface ProjectDraft {
  readonly title: string;
  readonly summary: string;
}

const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 600;

export function normalizeProjectDraft(draft: ProjectDraft): ProjectDraft {
  const title = draft.title.trim();
  const summary = draft.summary.trim();

  if (title.length === 0) {
    throw new Error("项目名称不能为空");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`项目名称不能超过 ${MAX_TITLE_LENGTH} 个字符`);
  }

  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw new Error(`项目说明不能超过 ${MAX_SUMMARY_LENGTH} 个字符`);
  }

  return { title, summary };
}
