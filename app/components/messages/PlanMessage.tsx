'use client';

import type { PlanMessageData } from '../../lib/types';
import { useChatContext } from '../../lib/context';
import { formatCost, formatTokensShort, getModelColor, getCategoryLabel, getDifficultyColor } from '../../lib/utils';

export default function PlanMessage({ message }: { message: PlanMessageData }) {
  const { approvePlan, cancelPlan, activeChatId, isExecuting } = useChatContext();
  const { plan } = message;

  const handleApprove = () => {
    if (activeChatId) {
      approvePlan(activeChatId, message.id, plan);
    }
  };

  return (
    <div className="msg-container">
      <div className="msg-plan">
        <div className="msg-plan-header">
          <span className="msg-plan-label">Execution Plan</span>
          <span
            className="badge"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}
          >
            {getCategoryLabel(plan.category)}
          </span>
          <span
            className="badge"
            style={{ color: getDifficultyColor(plan.difficulty), borderColor: getDifficultyColor(plan.difficulty) }}
          >
            {plan.difficulty}
          </span>
          {plan.needsDecomposition && (
            <span
              className="badge"
              style={{ color: 'var(--accent)', borderColor: 'var(--border)' }}
            >
              Decomposed
            </span>
          )}
        </div>

        <ul className="msg-plan-subtasks">
          {plan.subtasks.map((task) => (
            <li key={task.id} className="msg-plan-subtask">
              <span className="msg-plan-subtask-num">{task.id}</span>
              <span className="msg-plan-subtask-title">{task.title}</span>
              <span
                className="model-badge"
                style={{ color: getModelColor(task.assignedModel), borderColor: getModelColor(task.assignedModel) }}
              >
                {task.assignedModel}
              </span>
              {task.estimatedCost !== undefined && (
                <span className="msg-plan-subtask-cost">{formatCost(task.estimatedCost)}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="msg-plan-totals">
          <span>💰 {formatCost(plan.totalEstimate.cost)}</span>
          <span>🔤 ~{formatTokensShort(plan.totalEstimate.tokens)} tokens</span>
          <span>⏱ ~{plan.totalEstimate.timeSeconds}s</span>
        </div>

        <div className="msg-plan-actions">
          <button className="btn-ghost" disabled={isExecuting} onClick={() => {
            if (activeChatId) cancelPlan(activeChatId, message.id);
          }}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleApprove} disabled={isExecuting}>
            ✓ Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
}
