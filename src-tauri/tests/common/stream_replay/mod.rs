//! Streaming-path snapshot helpers.
//!
//! Feed raw stream events through a live `MessagePipeline` and capture both
//! the mid-stream emissions and the post-finish render / persistence state —
//! mirrors what the real streaming command pipeline does in
//! `agents::streaming`. Snapshots built on top of this struct pin the
//! end-to-end lifecycle (accumulator → adapter → persistence round-trip)
//! in a way `run_normalized`'s historical-only path can't.
//!
//! Split in two:
//! - `replay` — raw emission capture + `replay_stream_events` driver.
//! - `stabilize` — shape-stable snapshot form + `normalize_stream_fingerprint`
//!   conversion (UUID → `msg-N`, wall-clock → `has_duration`).

mod replay;
mod stabilize;

pub use replay::*;
pub use stabilize::*;
