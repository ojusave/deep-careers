/** Keeps browser code from accidentally importing the server or its credentials. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}

test("frontend and shared modules cannot pull server code or credentials into the browser", () => {
  for (const area of ["frontend", "shared"]) {
    for (const filename of sourceFiles(path.join(sourceRoot, area))) {
      const source = fs.readFileSync(filename, "utf8");
      const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
      const dependencies: string[] = [];
      function visit(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependencies.push(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) dependencies.push(argument.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
      for (const dependency of dependencies) {
        assert.ok(!dependency.startsWith("node:"), `${filename} imports a Node-only module`);
        const resolved = dependency.startsWith("@/") ? path.join(sourceRoot, dependency.slice(2)) : dependency.startsWith(".") ? path.resolve(path.dirname(filename), dependency) : null;
        if (!resolved) continue;
        const relative = path.relative(sourceRoot, resolved).split(path.sep)[0];
        assert.ok(["frontend", "shared"].includes(relative), `${filename} imports ${dependency} outside the browser-safe areas`);
        if (area === "shared") assert.equal(relative, "shared", `${filename} couples shared data to a frontend implementation`);
      }
      // A setup message may name EXA_API_KEY; reading process.env is the boundary violation.
      assert.doesNotMatch(source, /process\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])/, `${filename} must not read server configuration`);
    }
  }
});
