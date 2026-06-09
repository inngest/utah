/**
 * Skills — scans the skills directory for markdown files with frontmatter
 * and returns a compact index (name, description, file path).
 */

import { readdirSync, readFileSync } from "fs";
import { resolve, basename, relative } from "path";
import { config } from "../config.ts";

export interface SkillEntry {
  name: string;
  description: string;
  filePath: string;
  source?: "project" | "workspace";
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}

/**
 * Load skill entries from a single directory.
 */
function loadSkillsFromDir(
  dir: string,
  source: "project" | "workspace",
): SkillEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const skills: SkillEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md") || file.startsWith("_")) continue;
    const fullPath = resolve(dir, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.name && fm.description) {
        skills.push({
          name: fm.name,
          description: fm.description,
          filePath: relative(process.cwd(), fullPath),
          source,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

/**
 * Load skills from both the project-wide and workspace-level skill directories.
 * Workspace skills override project-wide skills when they share the same filename.
 */
export function loadSkillIndex(): SkillEntry[] {
  const projectSkills = loadSkillsFromDir(config.skills.dir, "project");

  const workspaceSkillsDir = resolve(config.workspace.root, config.workspace.skillsDir);
  const workspaceSkills = loadSkillsFromDir(workspaceSkillsDir, "workspace");

  // Build a map keyed by filename — workspace skills override project skills
  const skillMap = new Map<string, SkillEntry>();
  for (const skill of projectSkills) {
    const key = basename(skill.filePath);
    skillMap.set(key, skill);
  }
  for (const skill of workspaceSkills) {
    const key = basename(skill.filePath);
    skillMap.set(key, skill);
  }

  return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
