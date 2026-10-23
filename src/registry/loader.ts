import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { Blueprint, BlueprintSchema } from '../schema/blueprint.js';

export type BlueprintTransformHook = (
  data: unknown,
  context: { inputs: Record<string, unknown>; blueprint: Blueprint }
) => Promise<unknown> | unknown;

export interface LoadedBlueprint {
  blueprint: Blueprint;
  filePath: string;
  hookPath?: string;
  hook?: BlueprintTransformHook;
}

/**
 * Discovers, parses, and validates `.act.yaml` / `.act.yml` files across directories.
 */
export class BlueprintRegistry {
  private readonly blueprints = new Map<string, LoadedBlueprint>();
  private readonly directories: string[];

  constructor(directories?: string[]) {
    const defaultDir = path.resolve(process.cwd(), 'blueprints');
    this.directories = directories && directories.length > 0 ? directories : [defaultDir];
  }

  public async loadAll(): Promise<LoadedBlueprint[]> {
    this.blueprints.clear();

    for (const dir of this.directories) {
      if (!fs.existsSync(dir)) continue;
      const files = this.walkBlueprintFiles(dir);
      for (const filePath of files) {
        const loaded = await this.loadFile(filePath);
        this.blueprints.set(loaded.blueprint.id, loaded);
      }
    }

    return Array.from(this.blueprints.values()).sort((a, b) =>
      a.blueprint.id.localeCompare(b.blueprint.id)
    );
  }

  public async loadFile(filePath: string): Promise<LoadedBlueprint> {
    const absPath = path.resolve(filePath);
    const rawContent = fs.readFileSync(absPath, 'utf8');
    const parsedYaml = YAML.parse(rawContent);
    const result = BlueprintSchema.safeParse(parsedYaml);

    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; ');
      throw new Error(`Invalid blueprint at ${absPath}: ${issues}`);
    }

    const blueprint = result.data;
    const baseWithoutExt = absPath.replace(/\.act\.ya?ml$/i, '');
    const candidateHooks = [`${baseWithoutExt}.hook.ts`, `${baseWithoutExt}.hook.js`];

    let hookPath: string | undefined;
    let hook: BlueprintTransformHook | undefined;

    for (const candidate of candidateHooks) {
      if (fs.existsSync(candidate)) {
        hookPath = candidate;
        try {
          const mod = await import(pathToFileURL(candidate).href);
          if (typeof mod.transform === 'function') {
            hook = mod.transform as BlueprintTransformHook;
          } else if (typeof mod.default === 'function') {
            hook = mod.default as BlueprintTransformHook;
          }
        } catch {
          // Optional hook failed to import; ignore unless invoked
        }
        break;
      }
    }

    const loaded: LoadedBlueprint = {
      blueprint,
      filePath: absPath,
      hookPath,
      hook,
    };

    this.blueprints.set(blueprint.id, loaded);
    return loaded;
  }

  public get(id: string): LoadedBlueprint | undefined {
    return this.blueprints.get(id);
  }

  public list(filter?: { category?: string; search?: string }): LoadedBlueprint[] {
    let items = Array.from(this.blueprints.values());
    if (filter?.category) {
      const cat = filter.category.toLowerCase();
      items = items.filter((b) => b.blueprint.category.toLowerCase() === cat);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (b) =>
          b.blueprint.id.toLowerCase().includes(q) ||
          b.blueprint.name.toLowerCase().includes(q) ||
          b.blueprint.description.toLowerCase().includes(q) ||
          b.blueprint.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return items.sort((a, b) => a.blueprint.id.localeCompare(b.blueprint.id));
  }

  public saveBlueprintYaml(blueprint: Blueprint, subDir?: string): string {
    const validated = BlueprintSchema.parse(blueprint);
    const baseDir = this.directories[0] ?? path.resolve(process.cwd(), 'blueprints');
    const [namespace, name] = validated.id.split('/');
    const targetDir = path.join(baseDir, subDir ?? namespace);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, `${name}.act.yaml`);
    const yamlText = YAML.stringify(validated, { indent: 2 });
    fs.writeFileSync(filePath, yamlText, 'utf8');
    this.blueprints.set(validated.id, { blueprint: validated, filePath });
    return filePath;
  }

  private walkBlueprintFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkBlueprintFiles(fullPath));
      } else if (/\.act\.ya?ml$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
