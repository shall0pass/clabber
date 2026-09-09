# Project Instructions

## Project

See `docs/PROJECT.md` for the project's goals and requirements.

## Architecture

See `docs/ARCHITECTURE.md` for architectural decisions.

## Current Work

See `docs/TODO.md` for current priorities.

## Documentation

Keep `docs/ARCHITECTURE.md` and `docs/TODO.md` up to date as new issues arise.

## Agent Strategy

Use the Scout, Engineer, and Architect agents according to the
multi-model workflow defined below.

## User Manual

Maintain a users manual in docs/USER_MANUAL.md when a new feature is added or changed.

# Project

This is a Longley-Rice propagation analysis application.

The primary objectives are:
1. Fast calculation
2. Low memory usage
3. Accurate terrain handling
4. Results consistent with the reference implementation
5. Excellent correlation with both VSoft and TVStudy

## Development Rules

- Preserve existing behavior unless a change is intentional.
- Prefer measured performance over assumptions.
- Do not load large datasets into memory unnecessarily.
- Run relevant tests after changes.
- For significant architectural decisions, use the Architect agent.