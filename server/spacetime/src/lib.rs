#![forbid(unsafe_code)]

//! Small reusable helpers for game SpacetimeDB modules.
//!
//! Concrete tables, reducers and game services belong to the consuming game.
//! Game backend code may use SpacetimeDB directly; this crate is not an adapter,
//! repository or persistence abstraction.
//!
//! The Framework owns the supported SpacetimeDB SDK baseline and re-exports it so
//! consuming game code can prefer the Framework dependency surface where practical.

pub use spacetimedb;
use spacetimedb::{Identity, ReducerContext};

/// Result type for small reusable reducer guards.
pub type FrameworkResult<T = ()> = Result<T, String>;

/// Returns the identity that invoked the current reducer.
#[inline]
pub fn sender(ctx: &ReducerContext) -> Identity {
    ctx.sender()
}

/// Rejects a mutation when the reducer caller does not own the target identity.
#[inline]
pub fn require_owner(ctx: &ReducerContext, owner: Identity) -> FrameworkResult {
    if ctx.sender() == owner {
        Ok(())
    } else {
        Err("permission denied".to_owned())
    }
}

/// Rejects blank user-facing identifiers/names before they enter a game table.
#[inline]
pub fn require_non_blank(value: &str, field: &str) -> FrameworkResult {
    if value.trim().is_empty() {
        Err(format!("{field} must not be blank"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::require_non_blank;

    #[test]
    fn non_blank_guard_rejects_whitespace() {
        assert!(require_non_blank("   ", "name").is_err());
        assert!(require_non_blank("player", "name").is_ok());
    }
}
