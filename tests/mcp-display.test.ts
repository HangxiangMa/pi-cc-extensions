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

test("MCP summaries do not include call arguments", () => {
	const summary = toolCallSummary(
		"mcp",
		{ server: "confluence", tool: "confluence_confluence_get_page", args: { page_id: "secret" } },
	);
	assert.equal(summary.main, "Mcp confluence/confluence_get_page");
	assert.equal(summary.detail, "");
	assert.doesNotMatch(summary.main, /secret/);
});
