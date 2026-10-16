---
name: ui-backend-alignment
description: 'Help align frontend UI components cleanly and ensure backend feature implementation uses structured try/catch or try/except handling for production readiness.'
argument-hint: What frontend UI components and backend features need alignment or error-handling improvements?
---

This skill is intended for workspace-scoped fixes that focus on two goals:

1. Frontend UI layout
   - Ensure UI components are aligned without overlapping or overriding each other.
   - Prefer layout systems like CSS flexbox, grid, or proper container spacing.
   - Avoid absolute positioning or z-index fixes that create brittle one-on-one overlaps.
   - Keep visual hierarchy clear, responsive, and accessible.

2. Backend feature implementation
   - When adding or changing backend logic, wrap the feature code in `try/catch` (JavaScript/Node) or `try/except` (Python) blocks.
   - Catch expected errors, log details, and return meaningful, production-ready responses.
   - Avoid leaving unhandled exceptions or inconsistent error flows in controller/service layers.

## Suggested workflow

1. Identify the impacted frontend component/page and verify how elements are currently laid out.
2. Refactor styles or component structure so no element overlaps another; use proper spacing, container sizing, and alignment.
3. Identify any backend route, controller, or service that is being implemented or changed.
4. Add structured error handling around the feature logic:
   - `try/catch` for JavaScript/Node.js
   - `try/except` for Python
   - Log the exception and return an appropriate error response.
5. Test both frontend rendering and backend API behavior to confirm fixes.

## Quality criteria

- No UI overlap or forced "one-on-one" position overrides.
- Layout uses maintainable CSS patterns and supports responsive behavior.
- Backend code is wrapped in error handling with clear logs and stable responses.
- The result is production-ready and easier to maintain.

## Follow-up questions when context is missing

- Which specific frontend page or component needs alignment?
- Are the layout issues coming from CSS, component structure, or both?
- Which backend endpoint or service should be updated with `try/catch` handling?
- Should the backend error handling include logging, user-facing messages, or both?
