import { parse as parseYaml } from "yaml";

export interface ProfileDefaults {
  commands?: {
    typecheck?: string;
    lint?: string;
    test?: string;
    acceptance?: string;
  };
  paths?: {
    backend?: string[];
    frontend?: string[];
    shared?: string[];
    forbidden?: string[];
    tests?: string[];
  };
}

/**
 * Extract `## Default commands` and `## Default paths` YAML code blocks from
 * a profile markdown body and parse them. Returns empty object if a section
 * is missing or malformed.
 */
export function parseProfileDefaults(profileBody: string): ProfileDefaults {
  return {
    commands: extractYamlBlock(profileBody, /^##\s+Default commands.*$/m)?.commands as ProfileDefaults["commands"],
    paths: extractYamlBlock(profileBody, /^##\s+Default paths.*$/m)?.paths as ProfileDefaults["paths"],
  };
}

function extractYamlBlock(body: string, headerRegex: RegExp): Record<string, unknown> | undefined {
  const headerMatch = body.match(headerRegex);
  if (!headerMatch || headerMatch.index === undefined) return undefined;

  const tail = body.slice(headerMatch.index);
  // Find first ```yaml ... ``` after the header
  const blockMatch = tail.match(/```ya?ml\n([\s\S]*?)\n```/);
  if (!blockMatch || !blockMatch[1]) return undefined;

  try {
    return parseYaml(blockMatch[1]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
