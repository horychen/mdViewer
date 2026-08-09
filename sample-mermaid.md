# Mermaid rendering check

## Flowchart with subgraphs

```mermaid
flowchart LR
  subgraph T1["terminal 1 · serve"]
    SERVE["policy server"]
  end
  subgraph T2["terminal 2 · learn"]
    LN["learner: critic/actor"]
  end
  CO["collector"] -->|"obs / actions"| SERVE
  SERVE -->|"executed_norm"| CO
  CO -->|"transitions"| LN
  LN -->|"snapshot"| SERVE
```

## Sequence

```mermaid
sequenceDiagram
  participant R as Reader
  participant A as mdViewer
  R->>A: Command+O
  A-->>R: rendered document
```

## State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: open file
  Loading --> Ready: parsed
  Loading --> Failed: unreadable
  Ready --> [*]
```

## A deliberately broken diagram

The rest of the page must still render, and the source should stay visible.

```mermaid
flowchart LR
  A --> --> B[[[
```

## Ordinary code must not be touched

```js
const diagram = "flowchart LR";
```

Text after everything still renders.
