# Rubric Evaluation — LineWatch (ISEM 505 Project 1)

**Document evaluated:** `ISEM505-Project_1-Team-3-LineWatch_Intelligent_System_Framework.docx`  
**After change:** Figure 4 (System Lifecycle) added to §5 Implementation Considerations.

Scale: 4 Advanced · 3 Proficient · 2 Emerging · 1 Novice · Threshold = 3

| Criterion | Score | Rationale |
|---|---|---|
| **CRIT 0.3e Implement Solution** | **4** | Full advisory predictive-maintenance solution with OT/security, human gate, capacity-aware thresholds, phased rollout, and ethics/privacy/cyber context. Multiple contextual factors addressed, not only the model. |
| **ENTR 0.3c Design Action Plan** | **4** | Ambiguous plant setting handled with a justified 90-day action plan (need/data → shadow → advisory → scale-up), KPI gates, and rollback. Lifecycle figure reinforces execute-or-retire path. |
| **INFO 0.1a Describe Key Concepts** | **4** | Scope is clear; key concepts covered: systems boundary, leakage, class imbalance, threshold vs accuracy, champion/challenger, OT air gap, explainability, drift. |
| **TEAM 0.2 Assigned Tasks** | **3** | Pair division of labor is described (architecture/Colab vs tables/diagrams; joint edit). Thorough and goal-aligned, but little evidence of *proactively helping other teams* beyond this pair — Advanced bar not fully met. |
| **ISEM 2.1 IT Concepts** | **4** | Precise use of historian, OPC UA / read-only gateway, CMMS, edge vs cloud batch, feature store notions, audit log, RBAC, drift, shadow mode. Relationships are correct. |
| **ISEM 2.2 Engineer Components** | **4** | FR/NFR table with verification; architecture layers; AI/DB/Web-adjacent CMMS UI / Cloud or edge scoring. Traceability from need → FR/NFR → figures → lifecycle is clear. |
| **ISEM 2.4 Re-engineer Components** | **4** | Cloud→edge refactor with quantified latency (~2–5s), ~40% less egress, $4k–$6k packaging, and feature-flag rollback — matches Advanced. |
| **ISEM 4.3 Optimize Operations** | **3–4 (award 3)** | SE + ML-systems methods and data sources used to improve inspect capacity / downtime. Strong and feasible; “highly efficient / sustainable at scale” is sketched (one line, then expand) rather than fully multi-methodology optimized — solid Proficient leaning Advanced. |
| **ISEM 5.3 Group Leadership** | **3** | Roles and ownership in §5.1 (supervisor, reliability, data eng, IT/OT, safety). Dependencies noted (CMMS API, SSO). Not a formal RACI matrix; coordination is defined but not fully Advanced. |
| **ISEM 5.4 Leadership: Solve Problems** | **3–4 (award 3)** | Plan + KPIs (recall, false-inspect hours, HIGH age, freshness) + shadow/advisory monitoring. Reflection/iteration is designed in (challenger/shadow) but not executed on real plant data — Proficient to low-Advanced. |

### Assignment checklist (instructions, not rubric points)

| Required element | Status |
|---|---|
| Part 1 Problem & vision + systems thinking | Met |
| Visual models (architecture, pipeline, feedback) | Met (Figs 1–3) |
| Part 2 SE architecture, constraints, trade-offs | Met (tables + text) |
| AI tool exploration documented | Met (ChatGPT, diagrams.net, Colab) |
| Part 3 Data sources, ML selection, feedback, infra | Met |
| Report sections: intro, design, tools, implementation, ethics | Met |
| **Figure 4 System Lifecycle** | **Added** (was missing) |
| Length 6–8 pages | **Watch:** ~2.5k words + 4 figures + 6 tables may run **long**; consider tightening §6 bullets or shrinking figures if the PDF exceeds 8 pages |

### Bottom line
**Overall: strong Proficient–Advanced package; expected to clear the 80% / level-3 thresholds on the ISEM and CRIT/INFO items.** Weakest relative areas vs Advanced: formal team RACI / cross-team help evidence, and proving operational KPI iteration beyond the Colab teaching check. Adding Figure 4 closes the lifecycle visual gap and strengthens SE Chapters 1–3 alignment.

**Suggested score band if mapped to 100 pts:** roughly **88–94**, depending on how strictly page limit and team-leadership evidence are graded.
