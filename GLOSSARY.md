# 术语表（GLOSSARY）

项目统一语言。代码标识符括号内给出；新增概念先在这里定义再写代码。

## 水力模型
- **节点**（node）：连接点，有标高 `elevation` [m]、净流出 `demand` [m³/s，漏水为正、补水为负]。
- **定压点**（node.head 非空）：固定测压管水头的边界节点；同一连通分量至少一个。
- **测压管水头 H**（`head_m`）：z + p_g/(ρg) [m]，不是总水头，不含速度水头。
- **表压**（`pressure_pa_gauge`）：相对大气压的压力。绝压另列。
- **支路**（edge）：有方向的连接，`kind` 为管道 pipe、泵 pump、阀 valve、末端 terminal、等效阻力 resistance、理想流控 flow_control。
- **水头差**（`head_drop_m`）：支路起点 H − 终点 H。泵为负值（升压）。
- **末端**（terminal）：用户设备，以设计压降 `design_head` 和设计流量 `design_flow` 定义定阻特性。
- **需求不满足**：末端实际流量低于 `design_flow`，问题码 `TERMINAL_DEMAND`。
- **局阻**：局部阻力，`zeta` 与沿程倍率互斥（`local_mode`）。
- **调节量**：运行时可调而不改设计的参数——泵相对转速 `speed`（0–2）、阀开度 `opening`（0–1）。

## 计算与结果
- **求解**（solve）：一次独立稳态计算，返回 `status`、残差、`input_hash`。
- **状态**：converged 计算通过 / demand_unsatisfied 控制需求不满足 / numerical_failure 残差未达标 / invalid_model 模型需修正 / boundary_conflict 边界冲突 / timeout。
- **输入哈希**（`input_hash`）：模型内容摘要，用来判断结果属于哪份输入。
- **过期**（stale）：当前模型与结果对应的输入不一致；过期结果只读，不可导出为当前结果。
- **任务**（job）：在独立子进程中运行的计算，有 ID、可取消、有超时。
- **所有者 / 运行意图**（owner / runRef）：防止迟到的旧任务结果附着到新工程或新一次运行。
- **工况快照**（scenario）：保存在工程中的“输入 + 结果”副本，用于对比。

## 分析（SPEC-001）
- **分析**（analysis）：建立在多次独立稳态求解之上的派生研究，**不是**时间动态。
- **扫描**（scan）：对 1–2 个参数取一组值，逐点独立求解。每个组合叫一个**扫描点**；单批 ≤1000 点。
- **观测量**（observable）：从每次结果中提取的标量，如某支路 `flow_m3_s`、某节点 `head_m`。
- **敏感性**（sensitivity）：观测量对某参数的中心差分导数 dY/dX，在当前工作点附近有效。
- **约束**（constraint）：对支路结果的要求——`min_flow`、`max_flow`、`min_head`。
- **可及性**（accessibility）：在给定调节量上下界内，能否找到满足全部约束的工作点。
  - **固定检查**：不给调节量，只检查当前工作点。结论 `feasible_at_this_point` / `not_satisfied_at_this_point`。
  - **有界局部搜索**：结论 `feasible_point_found` 或 `undetermined`（**未确定，不等于不可行**）。`global_guarantee` 恒为 false。
- **违反度**（violation）：约束不满足的相对量，0 为满足。
- **尽量少调整**（min_change_local）：找到可行点后，在保持约束满足的前提下把各调节量向当前值收回（按上下界宽度归一化）；局部改进，不声称最小。
- **设定精度**（step）：调节量可实际设定的最小间隔（默认 0.01）。取整后重新验算：`rounded_feasible` 满足 / `rounded_infeasible` 不满足（保留未取整值）/ `exact` 已在网格上。

## 工程与界面
- **工程**（project）：`.ohn.json`，schema v1，含模型、布局、工况、设备库、偏好。
- **设备库**（library）：工程自带的泵阀性能定义；应用时复制数据，不绑定外部库。
- **映射导入**：CSV/XLSX 按已有稳定 ID 更新参数，不创建拓扑。
- **单线展开**：把单线供水图按对称规则生成供回双线模型。
