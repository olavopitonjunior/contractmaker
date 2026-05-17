/**
 * Adapter SSE — exporta o entrypoint do graph como AsyncGenerator no
 * formato AgentEvent que o front-end já consome.
 *
 * Em F1 isto é só um re-export de `runOrchestrator` (o próprio entrypoint
 * já produz AgentEvent). O nome `stream-adapter` é mantido pra F2 quando
 * pode evoluir pra adapter sobre `graph.streamEvents()` com mapping mais
 * fino de eventos (text_delta token-by-token, etc).
 */

export { runOrchestrator, type RunOrchestratorParams } from "./graph";
