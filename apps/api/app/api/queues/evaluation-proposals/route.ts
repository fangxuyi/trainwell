import { handleCallback } from "@vercel/queue";
import { evaluateAndDeliverEvaluationProposal } from "@/lib/evaluation";

export const maxDuration = 300;

interface EvaluationProposalMessage {
  proposalId: string;
}

export const POST = handleCallback<EvaluationProposalMessage>(
  async (message) => {
    if (!message || typeof message.proposalId !== "string" || !message.proposalId.trim()) {
      throw new Error("Evaluation proposal message is missing proposalId");
    }
    await evaluateAndDeliverEvaluationProposal(message.proposalId);
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= 10) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount, 5)) };
    },
  }
);
