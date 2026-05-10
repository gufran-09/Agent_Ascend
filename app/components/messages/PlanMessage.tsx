'use client';

import { useState } from 'react';
import type { PlanMessageData } from '../../lib/types';
import { useChatContext } from '../../lib/context';
import { formatCost, formatTokensShort, getModelColor, getCategoryLabel, getDifficultyColor } from '../../lib/utils';
import { ChevronDown, ChevronRight, Info, GitBranch } from 'lucide-react';

export default function PlanMessage({ message }: { message: PlanMessageData }) {
  const { approvePlan, cancelPlan, activeChatId, isExecuting } = useChatContext();
  const { plan } = message;
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [showReasoning, setShowReasoning] = useState(false);

  const toggleTask = (id: number) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

        {/* Decomposition Reasoning */}
        {plan.decompositionReasoning && (
          <div className="msg-plan-reasoning-toggle" onClick={() => setShowReasoning(!showReasoning)}>
            <Info size={14} />
            <span>Why this decomposition?</span>
            {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        )}
        {showReasoning && plan.decompositionReasoning && (
          <div className="msg-plan-reasoning-box">
            {plan.decompositionReasoning}
          </div>
        )}

        <ul className="msg-plan-subtasks">
          {plan.subtasks.map((task) => {
            const isExpanded = expandedTasks.has(task.id);
            const hasDeps = task.dependsOn && task.dependsOn.length > 0;
            return (
              <li key={task.id} className="msg-plan-subtask-wrapper">
                <div className="msg-plan-subtask" onClick={() => toggleTask(task.id)} style={{ cursor: 'pointer' }}>
                  <span className="msg-plan-subtask-num">{task.id}</span>
                  <span className="msg-plan-subtask-title">{task.title}</span>
                  {hasDeps && (
                    <span className="msg-plan-dep-badge" title={`Depends on step ${task.dependsOn!.join(', ')}`}>
                      <GitBranch size={10} />
                      {task.dependsOn!.join(', ')}
                    </span>
                  )}
                  <span
                    className="model-badge"
                    style={{ color: getModelColor(task.assignedModel), borderColor: getModelColor(task.assignedModel) }}
                  >
                    {task.assignedModel}
                  </span>
                  {task.estimatedCost !== undefined && (
                    <span className="msg-plan-subtask-cost">{formatCost(task.estimatedCost)}</span>
                  )}
                  <span className="msg-plan-expand-icon">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </div>
                {isExpanded && (
                  <div className="msg-plan-subtask-details">
                    {task.modelReasoning && (
                      <div className="msg-plan-detail-row">
                        <span className="msg-plan-detail-label">🧠 Model reasoning</span>
                        <span className="msg-plan-detail-value">{task.modelReasoning}</span>
                      </div>
                    )}
                    {task.prompt && (
                      <div className="msg-plan-detail-row">
                        <span className="msg-plan-detail-label">📝 Prompt</span>
                        <span className="msg-plan-detail-value msg-plan-detail-prompt">{task.prompt}</span>
                      </div>
                    )}
                    {hasDeps && (
                      <div className="msg-plan-detail-row">
                        <span className="msg-plan-detail-label">🔗 Depends on</span>
                        <span className="msg-plan-detail-value">
                          Step {task.dependsOn!.join(', Step ')}
                        </span>
                      </div>
                    )}
                    <div className="msg-plan-detail-row">
                      <span className="msg-plan-detail-label">📊 Estimates</span>
                      <span className="msg-plan-detail-value">
                        ~{formatTokensShort(task.estimatedTokens || 0)} tokens · {formatCost(task.estimatedCost || 0)} · ~{task.estimatedTime || 0}s
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
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
