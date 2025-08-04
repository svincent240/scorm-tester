---
trigger: always_on
---

# Development Rules and Guidelines

This document defines how this project must be developed and maintained.  
It applies equally to humans and AI assistants working in this repository.

---

## Purpose

This repository uses the `dev_docs` directory to guide development of a large application with many files.  
These rules ensure:

- No duplicated logic
- Clear separation of concerns
- Consistent adherence to architecture
- Maintainable, testable, and readable code
- Documentation that is always up to date
- Avoidance of technical debt

The entry point for all guidance is this file: **`dev_docs/README.md`**

---

## Documentation Practices

- **Single source of truth**  
  `dev_docs/README.md` describes how this project is structured and maintained.  

- **Updates required**  
  Any new feature, module, or architectural change must include corresponding updates to documentation in `dev_docs`.  

- **Commit together**  
  Documentation changes must be part of the same commit as the code changes they describe.  

---

## Code Quality Rules

### No duplicate code
Always check for existing functionality. If similar code exists:
- Reuse it
- Refactor common parts
- Do not create another implementation

### Separation of concerns
Keep responsibilities distinct:
- UI logic, business logic, and data access belong in separate modules
- Avoid placing unrelated code in the same file

### Respect the architecture
The architecture described in `dev_docs/README.md` and supporting docs must be followed.  
Do not bypass or work around the intended design.

### No temporary or hardcoded fixes
- Avoid shortcuts such as “just make it work” hacks
- Fix the root cause or document a limitation and open an issue if necessary

### File size and complexity
- Break up files that grow too large
- Keep functions and classes focused and small

### Avoid unnecessary complexity
- Write code that is simple to read and maintain
- Avoid overly clever abstractions

### Use packages and libraries
If a well-supported package or library solves a problem:
- Use it instead of reinventing the solution

### Testing
- Every new feature or bug fix must include tests
- Tests should verify both expected success and failure cases

---

## Refactoring Expectations

When you touch existing code:
- Improve readability when possible
- Remove duplication
- Extract long files into smaller modules
- Fix architectural violations

Dead code should be deleted, not left commented out.

---

## AI Assistant Responsibilities

When AI tools generate or modify code:

1. Read and follow `dev_docs/README.md` and supporting documentation before making changes
2. Maintain the established architecture
3. Prefer refactoring over adding duplicate functionality
4. When creating a new module:
   - Update or create supporting documentation
   - Follow file and directory naming conventions
5. Avoid shortcuts and temporary fixes
6. Provide meaningful commit messages

---

## Review Process

- All changes (AI or human) must be reviewed before merging
- Pull requests that violate these rules will be rejected until corrected

---

## Supporting Documentation

Additional documentation in this folder includes:
- `architecture.md` – describes the system structure and patterns
- `style.md` – code style, naming conventions, and formatting
- `modules/` – module-level documentation

Always check this folder before making architectural decisions.

---
