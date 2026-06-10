---
name: Creating Custom Skills
description: How to create, update, and manage your own skill files to persist knowledge and workflows as reusable reference documents.
---

# Creating Custom Skills

Skills are markdown reference documents that appear in your system prompt. You only see the name and description — use `read` to load the full content when you need it. You can create your own skills to persist knowledge you've learned across conversations.

## When to Create a Skill

Create a skill when:
- You learn something reusable (a process, API pattern, codebase convention, debugging technique)
- The user teaches you how they want something done and you should remember the approach long-term
- You discover a multi-step workflow that you'll need to repeat
- You want to codify a decision or architecture pattern for future reference
- The user explicitly asks you to remember a process or create documentation for yourself

**Don't create a skill** for one-off facts or preferences — use `remember` for those. Skills are for _reference material_ you'd want to read again in full.

## File Format

Skills are markdown files with YAML frontmatter. Both `name` and `description` are **required** or the file is silently ignored.

```markdown
---
name: Human-Readable Skill Name
description: One-line description of what this skill covers.
---

# Skill Title

Content goes here. Write for yourself — this is agent-facing documentation.
```

## Where to Write Skills

Write workspace skills to your `skills/` directory inside your workspace:

```
skills/your-skill-name.md
```

This is separate from the project-wide `skills/` directory at the repo root. Your workspace skills are yours — they persist across conversations and appear alongside project skills in the prompt.

**Override behavior:** If your workspace skill has the same filename as a project-wide skill, yours replaces it. Use this intentionally if you need to customize a built-in skill.

## Conventions

- **Filenames:** Use kebab-case, e.g. `deployment-process.md`, `api-patterns.md`
- **No subdirectories:** Skills must be directly in the `skills/` directory (not nested)
- **Files starting with `_`** are ignored (use `_draft-skill.md` for work in progress)
- **No size limit** but keep skills focused. Split large topics into multiple skills.

## Content Style

Write skills as reference docs for yourself:
- **H1** for the title, **H2** for major sections, **H3** for subsections
- Use code blocks with language tags for templates and examples
- Bullet lists for conventions and rules
- Be prescriptive — "use X", "do not Y", "always Z"
- Include warnings about edge cases and gotchas
- Cross-reference other skills by name when relevant: "Read the **Inngest Functions** skill for details"

## Example

```markdown
---
name: Database Migrations
description: How to create and run database migrations for the main application.
---

# Database Migrations

Migrations live in `src/db/migrations/` and use sequential numbering.

## Creating a Migration

1. Create a new file: `XXX_description.sql` (next number in sequence)
2. Write both `-- up` and `-- down` sections
3. Test locally with `npm run db:migrate`

## Conventions

- One logical change per migration
- Always include a rollback (`-- down`)
- Never modify a migration that has been deployed
```

## Managing Skills

You can update or delete your skills at any time:
- **Update:** Use `edit` or `write` to modify an existing skill file
- **Delete:** Use `bash` to remove a skill file: `rm skills/skill-name.md`
- **List:** Use `ls skills/` to see your current workspace skills

Changes take effect immediately — skills are loaded fresh on each conversation.
