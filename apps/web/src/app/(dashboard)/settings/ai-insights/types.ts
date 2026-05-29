export interface AiInsightsConfig {
  enabled: boolean;
  contexts: {
    dashboard: boolean;
    contract: boolean;
    property: boolean;
    cashflow: boolean;
  };
}

export const DEFAULT_CONFIG: AiInsightsConfig = {
  enabled: true,
  contexts: { dashboard: true, contract: true, property: true, cashflow: true },
};
