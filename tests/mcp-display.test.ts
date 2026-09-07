import assert from "node:assert/strict";
import test from "node:test";
import { mcpToolDisplayName, toolCallSummary } from "../extensions/renderer/tool/names.ts";

test("MCP display identity shows server/tool without adapter duplication", () => {
	assert.equal(
		mcpToolDisplayName({ server: "confluence", tool: "confluence_confluence_get_page" }),
		"confluence/confluence_get_page",
	);
	assert.equal(
		mcpToolDisplayName({ describe: "ip_catalog/ip_catalog_search" }),
		"ip_catalog/search",
	);
	assert.equal(mcpToolDisplayName({ server: "confluence", search: "ignored" }), "confluence/search");
});

test("delegating tool summaries show called tool without arguments", () => {
	const summary = toolCallSummary("tool_call", { tool: "ip_catalog/search", args: { query: "secret" } });
	assert.equal(summary.main, "Tool Call ip_catalog/search");
	assert.doesNotMatch(summary.main, /secret/);
});

test("MCP summaries do not include call arguments", () => {
	const summary = toolCallSummary(
		"mcp",
		{ server: "confluence", tool: "confluence_confluence_get_page", args: { page_id: "secret" } },
	);
	assert.equal(summary.main, "Mcp confluence/confluence_get_page");
	assert.equal(summary.detail, "");
	assert.doesNotMatch(summary.main, /secret/);
});
