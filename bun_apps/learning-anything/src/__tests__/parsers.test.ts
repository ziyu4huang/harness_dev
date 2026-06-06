/**
 * Tests for the parsers module — YAML, JSON, Markdown, and auto-detect parsers.
 */
import { describe, test, expect } from "bun:test";
import {
  parseYamlConfig,
  parseJsonConfig,
  parseMarkdown,
  autoParse,
} from "../parsers.js";

// ─── parseYamlConfig ──────────────────────────────────────────────────────────

describe("parseYamlConfig", () => {
  const sampleDockerCompose = `
version: "3"
services:
  web:
    image: nginx
    ports:
      - "80:80"
  db:
    image: postgres
    environment:
      POSTGRES_DB: mydb
`;

  test("creates a config node for the file", () => {
    const result = parseYamlConfig("docker-compose.yml", sampleDockerCompose);
    expect(result.nodes.length).toBeGreaterThan(0);
    const configNode = result.nodes.find(n => n.id === "config:docker-compose.yml");
    expect(configNode).toBeDefined();
    expect(configNode!.type).toBe("config");
    expect(configNode!.tags).toContain("yaml");
  });

  test("detects services section and creates service nodes", () => {
    const result = parseYamlConfig("docker-compose.yml", sampleDockerCompose);
    const webNode = result.nodes.find(n => n.id === "service:web");
    const dbNode = result.nodes.find(n => n.id === "service:db");
    expect(webNode).toBeDefined();
    expect(dbNode).toBeDefined();
    expect(webNode!.type).toBe("service");
  });

  test("creates configures edges from config to services", () => {
    const result = parseYamlConfig("docker-compose.yml", sampleDockerCompose);
    const serviceEdges = result.edges.filter(e => e.type === "configures" && e.target?.startsWith("service:"));
    expect(serviceEdges.length).toBeGreaterThanOrEqual(2);
  });

  test("detects paths section for OpenAPI-style specs", () => {
    const openapiYaml = `
openapi: "3.0"
info:
  title: Test API
paths:
  /users:
    get:
      summary: List users
  /items:
    get:
      summary: List items
`;
    const result = parseYamlConfig("openapi.yml", openapiYaml);
    const userEndpoint = result.nodes.find(n => n.id === "endpoint:/users");
    const itemEndpoint = result.nodes.find(n => n.id === "endpoint:/items");
    expect(userEndpoint).toBeDefined();
    expect(itemEndpoint).toBeDefined();
  });

  test("creates generic section nodes for non-services/paths keys", () => {
    const result = parseYamlConfig("docker-compose.yml", sampleDockerCompose);
    const versionSection = result.nodes.find(n => n.name === "version");
    expect(versionSection).toBeDefined();
  });
});

// ─── parseJsonConfig ──────────────────────────────────────────────────────────

describe("parseJsonConfig", () => {
  test("creates a config node for valid JSON", () => {
    const result = parseJsonConfig("settings.json", '{"foo": "bar", "count": 42}');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes[0].type).toBe("config");
    expect(result.nodes[0].tags).toContain("json");
  });

  test("handles invalid JSON gracefully", () => {
    const result = parseJsonConfig("bad.json", "not json at all");
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].summary).toContain("parse error");
  });

  test("detects package.json dependencies", () => {
    const pkg = JSON.stringify({
      name: "test",
      dependencies: { express: "^4.18.0", lodash: "^4.17.0" },
      devDependencies: { typescript: "^5.0.0" },
    });
    const result = parseJsonConfig("package.json", pkg);
    const depNode = result.nodes.find(n => n.name === "dependencies");
    expect(depNode).toBeDefined();
    expect(depNode!.summary).toContain("3 dependencies");
  });

  test("detects tsconfig.json compilerOptions", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { target: "ES2022", strict: true, module: "ESNext" },
    });
    const result = parseJsonConfig("tsconfig.json", tsconfig);
    const compilerNode = result.nodes.find(n => n.name === "compilerOptions");
    expect(compilerNode).toBeDefined();
    expect(compilerNode!.tags).toContain("typescript");
  });

  test("detects OpenAPI paths in JSON", () => {
    const spec = JSON.stringify({
      openapi: "3.0",
      paths: { "/users": {}, "/orders": {} },
    });
    const result = parseJsonConfig("openapi.json", spec);
    const usersEndpoint = result.nodes.find(n => n.id === "endpoint:/users");
    expect(usersEndpoint).toBeDefined();
  });
});

// ─── parseMarkdown ────────────────────────────────────────────────────────────

describe("parseMarkdown", () => {
  const sampleMd = `# Project Guide

This is the project guide.

## Getting Started

Install dependencies and run the server.

\`\`\`bash
npm install
npm start
\`\`\`

## Architecture

The system has three layers.

### API Layer

REST endpoints.

\`\`\`typescript
const app = express();
\`\`\`

## Deployment

Use Docker for deployment.
`;

  test("creates a document node with the title from # heading", () => {
    const result = parseMarkdown("GUIDE.md", sampleMd);
    const docNode = result.nodes.find(n => n.id === "doc:GUIDE.md");
    expect(docNode).toBeDefined();
    expect(docNode!.name).toBe("Project Guide");
    expect(docNode!.type).toBe("document");
  });

  test("creates section nodes for ## headings", () => {
    const result = parseMarkdown("GUIDE.md", sampleMd);
    const sections = result.nodes.filter(n => n.tags?.includes("section"));
    // Getting Started, Architecture, API Layer, Deployment
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });

  test("creates documents edges from doc to sections", () => {
    const result = parseMarkdown("GUIDE.md", sampleMd);
    const docEdges = result.edges.filter(e => e.type === "documents");
    expect(docEdges.length).toBeGreaterThanOrEqual(3);
  });

  test("detects code blocks and creates code nodes", () => {
    const result = parseMarkdown("GUIDE.md", sampleMd);
    const codeNodes = result.nodes.filter(n => n.tags?.includes("code-block"));
    expect(codeNodes.length).toBeGreaterThan(0);
  });

  test("handles markdown with no headings gracefully", () => {
    const plain = "Just some text with no headings.";
    const result = parseMarkdown("README.md", plain);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("doc:README.md");
  });

  test("handles empty content", () => {
    const result = parseMarkdown("empty.md", "");
    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(0);
  });
});

// ─── autoParse ────────────────────────────────────────────────────────────────

describe("autoParse", () => {
  test("routes .yml files to YAML parser", () => {
    const result = autoParse("compose.yml", "services:\n  web:\n    image: nginx\n");
    expect(result.nodes.some(n => n.tags?.includes("yaml"))).toBe(true);
  });

  test("routes .json files to JSON parser", () => {
    const result = autoParse("data.json", '{"key": "value"}');
    expect(result.nodes.some(n => n.tags?.includes("json"))).toBe(true);
  });

  test("routes .md files to Markdown parser", () => {
    const result = autoParse("README.md", "# Hello\n\nWorld");
    expect(result.nodes.some(n => n.tags?.includes("markdown"))).toBe(true);
  });

  test("returns empty for unsupported file types", () => {
    const result = autoParse("image.png", "binary data");
    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
  });
});
