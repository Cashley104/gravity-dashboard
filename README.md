# Gravity dashboard correction

The 2025–26 dashboard uses 1,221 of 1,230 cached games. Nine games with incomplete or overlapping source rotations are excluded, and all 219,159 raw field-goal events are retained in the local analysis archive. The metrics use 217,432 verified shot events.

Corrections replay same-clock substitutions in event order, exclude unresolved lineups from both on/off samples, and aggregate season context once per team/player/teammate rather than repeating per-game contexts. The corrected detail export contains 11,912 distinct season team/player/teammate rows.

The local analysis repair passes ten behavioral regression tests, source-count reconciliation, and the real dashboard detail decoder. Player own shots remain excluded. These descriptive shooting comparisons do not identify causal player impact; lineup and opponent context remain limitations.
