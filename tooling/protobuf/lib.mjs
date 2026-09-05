import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function listProtoFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".proto")) result.push(path);
    }
  };
  walk(root);
  return result.sort();
}
