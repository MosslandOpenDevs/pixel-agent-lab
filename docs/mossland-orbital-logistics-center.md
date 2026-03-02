# Mossland Orbital Logistics Center

## Purpose
This document defines a single, coherent visual concept that explains how the three Mossland services (**Algora**, **AO**, **Bridge**) work together.

Goals:
- Make each service role understandable at a glance
- Communicate flow through states, not technical complexity
- Support demo execution with dummy data only

---

## Core Metaphor: Orbital Conveyor Operations

In a space logistics hub, one package (a **Signal Box**) moves through three stages:

1. **Algora** tags incoming boxes and places them on the main conveyor
2. **AO** discusses and routes boxes onto branch conveyors
3. **Bridge** loads routed boxes into dispatch vehicles and sends them out

Pipeline:

`Tag (Algora) → Route (AO) → Dispatch (Bridge)`

---

## Visual Layout (Single Screen)

- Left: **Algora Inbound Dock**
- Center: **AO Routing Hub**
- Right: **Bridge Dispatch Bay**

Main conveyor has 3 horizontal lanes (priority lanes):
- **Top lane (P1)**: Urgent
- **Middle lane (P2)**: Normal
- **Bottom lane (P3)**: Low

> Higher lane means higher priority.

---

## Service Behavior

## 1) Algora
### Role
Transforms detected signals into boxes, applies tags, and places boxes on the main conveyor.

### Actions
- Create Signal Box
- Attach tags:
  - source
  - risk
  - category
- Assign priority lane (P1/P2/P3)

### Output
`Tagged Box` on Main Conveyor

---

## 2) AO
### Role
Reviews boxes from the main conveyor, debates routing, and decides execution direction.

### Actions
- Temporarily stop box
- Run short multi-agent discussion
- Route to one branch lane:
  - Immediate Action Lane
  - Monitor Lane
  - Defer/Archive Lane

### Output
`Routed Box` on Branch Conveyor

---

## 3) Bridge
### Role
Loads routed boxes into execution vehicles and records outcomes.

### Actions
- Load into shuttle/truck
- Dispatch
- Stamp result:
  - executed
  - monitored
  - deferred

### Output
`Outcome Record`

---

## Dummy Data Schema

## Box Entity
```json
{
  "boxId": "BX-20260301-0001",
  "title": "Unusual governance signal from GitHub",
  "source": "github",
  "category": "dev",
  "risk": "high",
  "priorityLane": "P1",
  "algoraTaggedAt": "2026-03-01T21:10:00+09:00",
  "aoDecision": "Immediate Action Lane",
  "aoReason": "high risk + repeated pattern",
  "bridgeStatus": "executed",
  "bridgeCompletedAt": "2026-03-01T21:13:10+09:00"
}
```

## Lane Rule (Dummy)
- risk = high → P1
- risk = medium → P2
- risk = low → P3

## AO Routing Rule (Dummy)
- P1 + high confidence → Immediate Action Lane
- P2 + uncertain impact → Monitor Lane
- P3 + low urgency → Defer/Archive Lane

---

## Dummy Data Examples

## Example A (Urgent)
- Box: `BX-0001`
- Algora: `source=github`, `risk=high`, lane `P1`
- AO: `Immediate Action Lane`
- Bridge: `executed`

## Example B (Monitor)
- Box: `BX-0002`
- Algora: `source=rss`, `risk=medium`, lane `P2`
- AO: `Monitor Lane`
- Bridge: `monitored`

## Example C (Defer)
- Box: `BX-0003`
- Algora: `source=social`, `risk=low`, lane `P3`
- AO: `Defer/Archive Lane`
- Bridge: `deferred`

---

## Interaction Design

## Default View (Simple)
Always visible:
- Box location (Algora / AO / Bridge)
- Priority lane (P1 / P2 / P3)
- Current status (tagged / routed / dispatched)

## Detail Popup (On Click)
Shown only on click:
1. Signal summary
2. Algora tagging result
3. AO decision reason
4. Bridge execution outcome

> Keep the base screen clean. Move detail into popups.

---

## Clarity Rules
- Maximum moving boxes at once: 3
- Maximum visible boxes on screen: 8
- Minimum agent count: 2–3 per service
- Fixed service colors:
  - Algora: Mint
  - AO: Blue
  - Bridge: Amber

---

## Expected Communication Outcome
The concept allows users to answer instantly:
- Which stage is this box in?
- Why is it on this lane?
- What decision was made?
- Was it dispatched, monitored, or deferred?

This creates a clear and intuitive understanding of role separation and service relationships in one screen.
