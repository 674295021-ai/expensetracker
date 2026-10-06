# Software Engineering Skills Pack

ชุด Agent Skills สำหรับงานพัฒนาระบบแบบครบวงจร ครอบคลุม SDLC ตั้งแต่ Requirements จนถึง CI/CD

## Skills

1. `01-requirements-engineering` — Requirements, User Story, Acceptance Criteria
2. `02-system-design` — System Context, Components, Data Flow, Scalability
3. `03-software-architecture` — Architecture, SOLID, Module Boundaries, ADR
4. `04-database-design` — ERD, Schema, Constraints, Index, Transaction
5. `05-api-design` — REST/API Contract, Validation, Errors, Versioning
6. `06-code-quality` — Code Review, Maintainability, Complexity, Cohesion
7. `07-testing-qa` — Unit, Integration, API, E2E, Regression, Quality Gate
8. `08-debugging-refactoring` — Root Cause, Minimal Fix, Regression Test, Refactor
9. `09-owasp-security` — Secure Coding, OWASP-oriented Security Review
10. `10-devops-cicd` — CI/CD, Docker, Deploy, Rollback, Observability

## Recommended workflow

```text
Requirements
   ↓
System Design
   ↓
Software Architecture
   ↓
Database + API Design
   ↓
Implementation
   ↓
Code Quality Review
   ↓
Testing / QA
   ↓
Debugging / Refactoring
   ↓
OWASP Security Review
   ↓
CI/CD + Deploy
```

## Install in a project

Copy the 10 skill folders into:

```text
YOUR-PROJECT/
└── .agents/
    └── skills/
        ├── 01-requirements-engineering/
        ├── 02-system-design/
        ├── 03-software-architecture/
        ├── 04-database-design/
        ├── 05-api-design/
        ├── 06-code-quality/
        ├── 07-testing-qa/
        ├── 08-debugging-refactoring/
        ├── 09-owasp-security/
        └── 10-devops-cicd/
```

Each skill contains:
- `SKILL.md`
- `PROMPTS-TH.md`
- `CHECKLIST.md`

## Example

```text
ใช้ Skill 01-requirements-engineering วิเคราะห์ Requirement ก่อน
จากนั้นใช้ 02-system-design และ 03-software-architecture
เพื่อออกแบบระบบ โดยยังไม่เขียน Code
```

## Important

These skills are custom workflow skills for AI coding agents. They are not official OWASP or vendor-maintained skill packages.
