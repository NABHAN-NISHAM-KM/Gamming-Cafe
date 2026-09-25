// Prints the role × module coverage matrix used in docs/04-rbac.md.
//   npm run docs:matrix -w @arena/rbac
import { PERMISSIONS, ROLE_TEMPLATES, templatePermissions, type PermissionModule } from "../src/index.js";

const modules = [...new Set(PERMISSIONS.map((p) => p.module))] as PermissionModule[];
const header = `| Module (perms) | ${ROLE_TEMPLATES.map((r) => r.key.replace(/_/g, " ")).join(" | ")} |`;
const sep = `|---|${ROLE_TEMPLATES.map(() => ":-:").join("|")}|`;
const rows = modules.map((m) => {
  const all = PERMISSIONS.filter((p) => p.module === m).map((p) => p.key);
  const cells = ROLE_TEMPLATES.map((r) => {
    const perms = templatePermissions(r.key);
    const n = all.filter((k) => perms.has(k)).length;
    return n === 0 ? "·" : n === all.length ? "●" : "◐";
  });
  return `| ${m} (${all.length}) | ${cells.join(" | ")} |`;
});
console.log([header, sep, ...rows].join("\n"));
console.log(`\n● all · ◐ some · \`·\` none — ${PERMISSIONS.length} permissions, ${PERMISSIONS.filter((p) => p.sensitive).length} sensitive.`);
