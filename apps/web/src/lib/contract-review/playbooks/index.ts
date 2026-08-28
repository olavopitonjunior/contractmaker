import type { ReviewFamily, ReviewPlaybook } from "./types";
import { LOCACAO_REVIEW_PLAYBOOK } from "./locacao";
import { VENDA_REVIEW_PLAYBOOK } from "./venda";

export * from "./types";

export const REVIEW_PLAYBOOKS: Readonly<Record<ReviewFamily, ReviewPlaybook>> = {
  locacao: LOCACAO_REVIEW_PLAYBOOK,
  venda: VENDA_REVIEW_PLAYBOOK,
};

export function reviewPlaybookFor(family: ReviewFamily): ReviewPlaybook {
  return REVIEW_PLAYBOOKS[family];
}
