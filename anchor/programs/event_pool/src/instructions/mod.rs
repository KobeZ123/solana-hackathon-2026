#![allow(ambiguous_glob_reexports)] // every instruction module exposes a `handler`

// One module + one glob re-export per instruction (later tickets add one line of each).
pub mod create_event;
pub mod set_gate;

pub use create_event::*;
pub use set_gate::*;
