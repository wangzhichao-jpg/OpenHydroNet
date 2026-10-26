// Solve status labels shared by the workbench and analysis views (see GLOSSARY: 状态).
export const statusText: Record<string, string> = {
  converged: '计算通过',
  numerical_failure: '残差未达标',
  invalid_model: '模型需修正',
  boundary_conflict: '边界冲突',
  demand_unsatisfied: '控制需求不满足',
  timeout: '计算超时',
};
