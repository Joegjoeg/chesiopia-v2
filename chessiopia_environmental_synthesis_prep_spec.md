# Chessiopia Environmental Synthesis — Prep Specification

## Status
Pre-implementation architecture and philosophy document.

Purpose:
- Stabilise terminology and conceptual rules.
- Prevent implementation drift.
- Define the simulation layers before terrain integration.
- Clarify what is real, inferred, perceived, and narratively influenced.

This is NOT a final technical implementation spec.
This is the conceptual and architectural anchor document.

---

# Core Philosophy

Chessiopia does not generate terrain as fixed categorical geography.

Instead:
- environmental conditions imply terrain tendencies,
- terrain influences weather behaviour,
- weather implies unresolved geography,
- and unresolved geography resolves into terrain when approached or observed.

The world behaves as though it already exists beyond the player horizon, while remaining probabilistic until resolution.

The objective is:

> Procedural implication rather than procedural declaration.

The player should feel:
- the world is becoming itself,
- the horizon is predictive but ambiguous,
- weather is informational rather than decorative,
- and geography emerges from interacting environmental pressures.

---

# Foundational Principles

## 1. True Probabilistic Resolution

Unresolved terrain does not secretly fully exist.

Potential space contains:
- tendencies,
- constraints,
- environmental pressures,
- continuity requirements,
- forecast implications,
- and probabilistic outcomes.

Resolution is:
- constrained,
- deterministic from inputs,
- but not pre-authored.

The system must avoid:
- obvious randomness,
- categorical biome generation,
- visible terrain template selection.

---

## 2. Terrain Effects Before Biomes

The simulation operates on:
- gradients,
- accumulations,
- pressures,
- terrain variance,
- water retention,
- thermal behaviour,
- uplift tendencies.

NOT terrain categories.

Example:

BAD:
- mountain biome
- swamp biome
- desert biome

GOOD:
- increased terrain height variance
- high water table
- low water retention
- strong erosion exposure
- persistent thermal instability

Biome interpretation occurs AFTER terrain and environmental synthesis.

Biome is presentation and ecology.
NOT foundational geography.

---

## 3. The Horizon Must Be Informational

Distant atmospheric behaviour should imply potential geography.

Examples:
- cloud uplift may imply terrain disruption,
- pressure walls may imply coastline or elevation,
- fog basins may imply thermal sinks or water retention,
- wind direction may imply approaching storm systems.

The horizon should never be fully readable.

Goal:

> Predictive ambiguity.

Players should:
- develop intuition,
- remain uncertain,
- and interpret the world rather than solve it.

---

## 4. Dramaturgical Simulation

The world is neither:
- fully physically simulated,
- nor fully scripted.

Instead:
- systems operate plausibly,
- but narrative and mythic systems may bias probabilities.

Narrative layers should:
- influence environmental tendencies,
- not directly force outcomes.

Example:
Narrative systems should bias:
- atmospheric instability,
- geological stress,
- thermal behaviour,
- hydrological aggression,
- perceptual distortion.

NOT:
- directly spawn storms,
- directly place mountains,
- directly alter terrain visibly without causality.

The simulation should appear internally coherent even when dramatically guided.

---

# Simulation Layers

## Layer 0 — Global Seed

Very low-frequency world tendencies.

Examples:
- planetary climate bias,
- seasonal tendencies,
- geological stress distribution,
- planetary wave behaviour,
- large-scale humidity patterns.

This layer provides:
- world identity,
- broad continuity,
- macro-scale environmental tendencies.

---

## Layer 1 — Resolved Environment

The fully realised nearby world.

Contains:
- terrain,
- water,
- local weather,
- terrain attributes,
- gameplay systems.

High resolution.
Persistent.

Exports environmental summaries to higher layers.

---

## Layer 2 — Procedural Forecast Field

Low-resolution environmental momentum simulation.

This is NOT local weather rendering.

This layer tracks:
- humidity movement,
- pressure tendencies,
- thermal gradients,
- wind momentum,
- precipitation likelihood,
- atmospheric instability.

Purpose:
- continuity,
- environmental memory,
- incoming weather behaviour,
- long-wave environmental drift.

This layer gives the world inertia.

---

## Layer 3 — Potential Space

Unresolved future geography.

Potential space is NOT:
- terrain,
- chunks,
- biome maps.

Potential space IS:
- environmental implication,
- terrain tendency fields,
- probabilistic geography constraints,
- atmospheric interpretation zones.

This layer exists primarily on and beyond the player horizon.

Potential space resolves into terrain when synthesis conditions are met.

---

## Layer 4 — Atmospheric Narrative Layer

The player-facing interpretive layer.

Contains:
- clouds,
- haze,
- fog,
- distant rain,
- lightning,
- wind visuals,
- atmospheric coloration,
- perceptual distortions.

This layer is partially client-side interpretive theatre.

Two players may perceive:
- different cloud formations,
- slightly different atmospheric detail,
- different local horizon interpretations.

The underlying environmental state remains coherent.

---

## Layer 5 — Collapse / Resolution

Potential space resolves into actual terrain.

Resolution uses:
- environmental continuity,
- forecast momentum,
- geological tendencies,
- hydrology,
- terrain variance,
- environmental edge inheritance,
- deterministic seed behaviour.

Resolution should feel:
- continuous,
- implied,
- inevitable in hindsight.

Never:
- sudden,
- categorical,
- visibly generated.

---

# Environmental Fields

Initial proposed field set:

| Field | Purpose |
|---|---|
| Elevation tendency | Terrain variance/uplift behaviour |
| Humidity | Water availability |
| Temperature | Thermal energy |
| Pressure | Atmospheric movement tendency |
| Water saturation | Water retention / water table |
| Wind vector | Directional transport |
| Erosion tendency | Terrain reshaping pressure |
| Geological stress | Long-term terrain refresh/uplift |
| Atmospheric instability | Storm likelihood / turbulence |

These fields should remain:
- lightweight,
- abstract,
- approximate.

Avoid over-simulation.

---

# Terrain Generation Philosophy

Terrain is not selected.
Terrain emerges.

Generation should operate from:
- interacting fields,
- continuity,
- environmental inheritance,
- accumulated pressures.

The system should avoid:
- explicit terrain archetypes,
- visible biome boundaries,
- hard environmental transitions.

Goal:
- continuous environmental drift,
- emergent geography,
- evolving procedural identity.

---

# Terrain ↔ Weather Feedback

Terrain influences weather.
Weather influences terrain.

Core principle:

> Discovery of geography changes future environmental behaviour.

Examples:
- newly resolved terrain alters wind behaviour,
- new elevation shifts precipitation patterns,
- water systems alter humidity transport,
- terrain disruption creates new atmospheric behaviour.

This creates:
- world-scale environmental feedback,
- evolving procedural identities,
- long-term environmental drift.

Stable environmental patterns may emerge over time.

However:
- small disturbances,
- seasonal shifts,
- geological stress,
- narrative influence,
- or atmospheric instability,

may reintroduce chaos into the system.

Conceptually:

> The world repeatedly breathes disorder back into itself.

---

# Geological Stability Philosophy

The world should NOT erode uniformly.

Terrain diversity is preserved because:
- terrain shapes weather,
- weather reshapes terrain,
- discovery alters global patterns.

This creates:
- nonlinear evolution,
- procedural asymmetry,
- local environmental uniqueness.

Geological change should be:
- slow enough for memory,
- fast enough for noticed change.

Target emotional effect:

> Familiar landscapes subtly evolve over time.

Examples:
- rivers slowly shifting,
- erosion exposing cliffs,
- floodplains migrating,
- coastlines softening,
- valleys deepening.

Core geography should remain mostly stable.

---

# Temporal Scale

Time in Chessiopia is accelerated and symbolic.

Example baseline:
- 60 second days,
- compressed seasons,
- accelerated years.

Environmental systems should respect emotional rather than realistic timescales.

Approximate targets:

| System | Suggested Scale |
|---|---|
| Clouds | Minutes |
| Storms | Hours |
| Seasonal drift | Days |
| Vegetation/ecological shifts | Days/Weeks |
| River migration | Weeks |
| Major erosion | Weeks/Months |
| Geological uplift/stress events | Rare symbolic events |

Goal:
- players notice change,
- but do not experience instability.

---

# Resolution Triggers

Terrain resolution is not purely distance-based.

Resolution priority may consider:

| Factor | Influence |
|---|---|
| Player proximity | High |
| Travel direction | High |
| Camera attention | Medium |
| Traversal probability | High |
| Narrative importance | Hidden influence |
| Repeated observation | Medium |

Traversal probability means:

> How likely is the player to enter unresolved space soon?

This allows:
- anticipatory synthesis,
- prioritised world generation,
- improved continuity,
- reduced unnecessary computation.

---

# Client vs Server Authority

## Server Authoritative

Only gameplay-relevant environmental effects.

Examples:
- visibility penalties,
- tile states,
- flooding,
- gameplay movement,
- persistent hydrology,
- resolved terrain state.

---

## Client Interpretive

Atmospheric presentation.

Examples:
- cloud shapes,
- fog motion,
- atmospheric detail,
- distant weather visuals,
- perceptual distortion.

This preserves:
- scalability,
- atmosphere,
- ambiguity,
- performance.

---

# Narrative Handles

Narrative systems should influence environmental tendencies rather than directly forcing outcomes.

Potential narrative handles:

| Handle | Purpose |
|---|---|
| Atmospheric instability | Increase storm volatility |
| Geological stress | Encourage uplift / terrain disruption |
| Hydrological aggression | Increase flooding / river force |
| Thermal mood | Regional heating/cooling |
| Perceptual distortion | Alter horizon readability |
| Seasonal amplification | Intensify seasonal behaviour |
| Pressure drift | Influence forecast behaviour |

Narrative influence should feel:
- plausible,
- environmental,
- indirect,
- mythically grounded.

---

# Important Constraints

## DO NOT BUILD NASA

This system must remain:
- theatrical,
- abstract,
- approximate,
- emotionally coherent.

Avoid:
- full fluid dynamics,
- expensive atmospheric simulation,
- rigid scientific realism.

Priority:

> Believable implication over physical accuracy.

---

# Current Open Questions

## 1. Persistence Boundaries

Exactly which fields persist globally?

Likely persistent:
- geological memory,
- hydrology anchors,
- climate tendencies,
- erosion accumulation.

Likely transient:
- cloud formations,
- local fog,
- minor pressure turbulence.

---

## 2. Collapse Radius

How far ahead should terrain synthesis occur?

Options:
- proximity-only,
- horizon-weighted,
- traversal-predictive.

---

## 3. Environmental Conservation

How much should the system conserve:
- water,
- heat,
- pressure?

Recommendation:
- preserve continuity,
- avoid strict realism.

---

## 4. Multiplayer Synchronisation

How much uncertainty can different players perceive before continuity breaks?

Potential-space ambiguity likely permits moderate perceptual variation.

---

## 5. Terrain Synthesis Function

Formal terrain synthesis logic remains undefined.

Likely inputs:
- environmental fields,
- continuity,
- geological stress,
- hydrology,
- forecast state,
- deterministic seed.

---

# Immediate Next Steps

## Stage A — Stabilise Terminology

Lock definitions for:
- procedural field,
- potential space,
- collapse,
- procedural forecast,
- environmental synthesis,
- geological stress,
- atmospheric narrative layer.

---

## Stage B — Prototype Resolution Logic

Before terrain integration:
- prototype probabilistic collapse behaviour,
- validate continuity,
- test traversal-priority resolution,
- test forecast inheritance.

Prefer:
- 2D debug fields,
- grayscale terrain implication,
- low-cost simulations.

---

## Stage C — Terrain Bridge

Only after resolution philosophy stabilises:
- connect weather fields to terrain chunks,
- integrate terrain feedback into weather,
- validate continuity in active gameplay areas.

---

# Final Design Goal

The player should eventually feel:

> The world beyond the horizon is not fully known.
>
> But the sky, wind, pressure, and atmosphere are trying to tell them what is becoming there.

