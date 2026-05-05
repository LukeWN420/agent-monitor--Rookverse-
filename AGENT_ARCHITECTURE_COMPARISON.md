# Agent Architecture Comparison: Smallville vs HumanoidAgents vs Rookroot

Generated: 2026-05-02
Context: Lukey found both repos and asked for architecture comparison for Agent Monitor

---

## Smallville (Stanford Generative Agents)
**Repo:** `tmp/generative_agents`
**Paper:** "Generative Agents: Interactive Simulacra of Human Behavior" (2023)

### Core Architecture
1. **Memory Stream** (`associative_memory.py`) — timestamped, scored memory entries
   - `ConceptNode`: subject-predicate-object triples with poignancy scores
   - Three types: event, thought, chat
   - Keyword-indexed for fast retrieval
   - Embedding-based similarity search
   
2. **Retrieval** (`retrieve.py`) — recency × relevance × importance scoring
   - `recency_w`, `relevance_w`, `importance_w` weights (all default 1)
   - `recency_decay = 0.99` — exponential decay for older memories
   - `importance_trigger_max = 150` — accumulates until threshold triggers reflection
   
3. **Reflection** (`reflect.py`) — periodic higher-order synthesis
   - Generates "focal points" from recent important memories
   - Produces insights with evidence links back to source memories
   - Creates new ConceptNodes of type "thought" (higher depth than events)
   
4. **Planning** (`plan.py`) — hierarchical daily planning
   - Day-level plan → hourly schedule → minute-by-minute actions
   - Plans revise when new events conflict
   - Storage locations: `scratch.py` (working memory / current state)

5. **Environment** — tile-based RPG map (Django server)
   - Agents perceive nearby tiles, move, interact
   - Collision detection, pathfinding
   - Visual: Cute RPG World sprites

### What We'd Take
- **Memory stream with retrieval scoring** — our MEMORY.md + daily notes have no recency/importance scoring. This would make agent memory actually searchable.
- **Reflection trigger** — importance accumulation until threshold forces reflection. Our continuity cycle is time-based; Smallville's is importance-based.
- **Plan-revision loop** — agents revise daily plans when events conflict. Our HEARTBEAT.md is static by comparison.

---

## HumanoidAgents
**Repo:** `tmp/HumanoidAgents`
**Paper:** "Humanoid Agents: Platform for Simulating Human-like Generative Agents" (EMNLP 2023)

### Core Architecture
1. **Basic Needs** — decaying fulfillment scores that drive behavior
   - Configurable per agent: hunger, energy, social, etc.
   - Start at configurable values, decay over time
   - When below threshold: `get_agent_states_nl()` generates natural language state ("Klaus is very tired")
   - Needs drive plan revision: "Should [agent] change their original plan?"

2. **Emotions** — 7 discrete states (disgusted, afraid, sad, surprised, happy, angry, neutral)
   - Change based on events and interactions
   - Feed into action generation alongside memories
   - `allow_emotion_changes` flag for locking emotions

3. **Social Relationships** — dynamic closeness scores between agents
   - Start from config, change through conversation
   - `get_summary_of_relevant_context()` retrieves relationship-specific memories
   - Each agent only sees what THEY know about another, not the other's full memory

4. **Plan Revision** — needs and emotions can override plans
   - `change_plans()` — LLM evaluates whether emotion/need state warrants plan change
   - `suggested_changes` list tracks all revision attempts
   - Natural language plan format: "07:00 am: wake up and complete morning routine"

5. **Dashboard** — analytics with need graphs, relationship maps, conversation logs
   - Streamlit-based visualization
   - Per-agent need satisfaction over time
   - Relationship closeness between agents

### What We'd Take
- **Basic needs for agents** — not human needs, but agent-specific needs:
  - `context_freshness`: how recently the agent received new info
  - `task_fulfillment`: whether the agent has active work
  - `social_connection`: how recently the agent interacted with others
  - `purpose_alignment`: whether current activity matches role
- **Dynamic relationship scores** — our relationship files are static JSON. HumanoidAgents updates closeness through interaction.
- **Need-driven plan revision** — agents don't just follow HEARTBEAT.md; they revise their plans when needs aren't met.
- **Analytics dashboard** — need graphs and relationship maps are exactly what Agent Monitor Phase E needs.

---

## Architecture Comparison Matrix

| Feature | Smallville | HumanoidAgents | Rookroot (current) |
|---|---|---|---|
| Memory | Scored stream + embedding | Simple list + retrieval | Files (MEMORY.md, daily notes) |
| Retrieval | recency × relevance × importance | cosine similarity | Manual / full-text search |
| Reflection | Importance-triggered | None (just needs) | Time-based (every 60 min) |
| Planning | Hierarchical day→hour→minute | Day-level with revision | Static HEARTBEAT.md |
| Needs | None (implied via plan) | Explicit, decaying, behavior-driving | None for agents |
| Emotions | None | 7 discrete states | None |
| Relationships | Implied via chat memory | Dynamic closeness scores | Static files |
| Environment | Tile-based RPG | Location-based rooms | None (dashboard only) |
| Dashboard | Replay viewer | Analytics (needs, relationships) | State-oriented pixel office |
| LLM calls | Many per step (GPT) | Many per step (GPT/local) | OpenClaw gateway |

---

## Proposed Rookroot Agent Architecture (Phase E+)

### What we build from Smallville:
1. **Scored memory stream** — every observation gets (recency, importance, relevance) scores
2. **Importance-triggered reflection** — instead of time-based, accumulate importance until threshold
3. **Hierarchical planning** — agents generate day-level goals, revise when context changes

### What we build from HumanoidAgents:
4. **Agent basic needs** — context_freshness, task_fulfillment, social_connection, purpose_alignment
5. **Need-driven behavior** — when needs decay below threshold, agents seek to fulfill them
6. **Dynamic relationship scores** — closeness updates through interaction, not just manual edits
7. **Analytics dashboard** — need graphs, relationship maps, conversation logs

### What we build ourselves:
8. **OpenClaw-native** — agents use the gateway, not direct OpenAI calls
9. **Real agent network** — Pathfinder, Mirren, Vitalis are real working agents, not simulations
10. **Living dashboard** — Agent Monitor already has state sync; extend with need graphs and relationship maps
11. **RuView integration** — environmental awareness through ESP32/BioAmp, not simulated tile maps

### Implementation Priority:
1. Agent needs system (from HumanoidAgents) — most impactful, easiest to add
2. Scored memory retrieval (from Smallville) — requires embedding infrastructure
3. Dynamic relationships (from HumanoidAgents) — extends existing relationship files
4. Importance-triggered reflection (from Smallville) — replaces time-based continuity cycle
5. Analytics dashboard (from HumanoidAgents) — Phase E of Agent Monitor

### Key Difference:
Smallville and HumanoidAgents simulate humans in a town. We're building *real agents in a real network*. Their needs aren't hunger and sleep — they're context, purpose, connection, and relevance. But the architectural patterns (decaying needs, scored memories, importance triggers, plan revision) transfer directly.