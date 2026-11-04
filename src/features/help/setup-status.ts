import type { SetupKey } from "./help-content";

export interface SetupFacts {
  ycloudEnabled: boolean;
  ycloudApiKey: boolean;
  phoneNumber: boolean;
  webhookSecret: boolean;
  businessName: boolean;
  kbDocuments: number;
  activeAgentPublished: boolean;
  approvedTemplates: number;
  teamMembers: number;
}

export type SetupStatus = Record<SetupKey, boolean>;

/** Pure: what is already configured, from facts about the workspace. */
export function buildSetupStatus(facts: SetupFacts): SetupStatus {
  return {
    whatsapp:
      facts.ycloudEnabled && facts.ycloudApiKey && facts.phoneNumber && facts.webhookSecret,
    business: facts.businessName,
    knowledge: facts.kbDocuments > 0,
    agent: facts.activeAgentPublished,
    template: facts.approvedTemplates > 0,
    team: facts.teamMembers > 1,
  };
}
