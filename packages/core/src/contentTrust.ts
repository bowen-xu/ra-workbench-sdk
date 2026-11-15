export const CONTENT_TRUST_STATUSES = [
  "untrusted",
  "reviewable",
  "trusted",
  "neutral",
] as const;

export type ContentTrustStatus = (typeof CONTENT_TRUST_STATUSES)[number];

export interface ContentTrustNode {
  readonly id: string;
  readonly label: string;
  readonly directStatus?: ContentTrustStatus;
  readonly confirmable?: boolean;
  readonly children?: readonly ContentTrustNode[];
}

export interface ContentTrustSummary {
  readonly status: ContentTrustStatus;
  readonly untrustedCount: number;
  readonly reviewableCount: number;
  readonly trustedCount: number;
  readonly neutralCount: number;
  readonly pendingCount: number;
  readonly confirmablePendingCount: number;
}

const TRUST_RANK: Readonly<Record<Exclude<ContentTrustStatus, "neutral">, number>> = {
  untrusted: 0,
  reviewable: 1,
  trusted: 2,
};

function minimumStatus(statuses: readonly ContentTrustStatus[]): ContentTrustStatus {
  const comparable = statuses.filter(
    (status): status is Exclude<ContentTrustStatus, "neutral"> => status !== "neutral",
  );
  if (comparable.length === 0) return "neutral";
  return comparable.reduce((minimum, status) => (
    TRUST_RANK[status] < TRUST_RANK[minimum] ? status : minimum
  ));
}

export function aggregateContentTrust(node: ContentTrustNode): ContentTrustStatus {
  return minimumStatus([
    node.directStatus ?? "neutral",
    ...(node.children ?? []).map(aggregateContentTrust),
  ]);
}

export function summarizeContentTrust(node: ContentTrustNode): ContentTrustSummary {
  const descendants = flattenContentTrust(node);
  const directStatuses = descendants.map((candidate) => candidate.directStatus ?? "neutral");
  const untrustedCount = directStatuses.filter((status) => status === "untrusted").length;
  const reviewableCount = directStatuses.filter((status) => status === "reviewable").length;
  const trustedCount = directStatuses.filter((status) => status === "trusted").length;
  const neutralCount = directStatuses.filter((status) => status === "neutral").length;
  const confirmablePendingCount = descendants.filter((candidate) => (
    candidate.confirmable === true
    && (candidate.directStatus === "untrusted" || candidate.directStatus === "reviewable")
  )).length;
  return {
    status: aggregateContentTrust(node),
    untrustedCount,
    reviewableCount,
    trustedCount,
    neutralCount,
    pendingCount: untrustedCount + reviewableCount,
    confirmablePendingCount,
  };
}

export function flattenContentTrust(node: ContentTrustNode): readonly ContentTrustNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenContentTrust)];
}

export function confirmableContentTrustIds(node: ContentTrustNode): readonly string[] {
  return flattenContentTrust(node)
    .filter((candidate) => (
      candidate.confirmable === true
      && (candidate.directStatus === "untrusted" || candidate.directStatus === "reviewable")
    ))
    .map((candidate) => candidate.id);
}

export function nextPendingContentTrustNode(
  node: ContentTrustNode,
  currentId?: string,
): ContentTrustNode | undefined {
  const pending = flattenContentTrust(node).filter((candidate) => (
    candidate.confirmable === true
    && (candidate.directStatus === "untrusted" || candidate.directStatus === "reviewable")
  ));
  if (pending.length === 0) return undefined;
  if (currentId === undefined) return pending[0];
  const index = pending.findIndex((candidate) => candidate.id === currentId);
  return pending[(index + 1 + pending.length) % pending.length];
}
