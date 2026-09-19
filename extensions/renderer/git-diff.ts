import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { config, type ToolDisplayConfig } from "../config/config.ts";
import { parseDiff } from "./tool/diff/diff-parse.ts";
import { renderEditDiffResult } from "./tool/diff/diff-edit-render.ts";

const GIT_DIFF_TIMEOUT_MS = 5_000;
const DIFF_CHROME_ROWS = 3;

type KeyMatcher = { matches(data: string, key: string): boolean };

function safePathArg(args: string): string | undefined {
	const path = args.trim();
	return path.length > 0 ? path : undefined;
}

function fitLine(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

class GitDiffViewer implements Component {
	private readonly diff: Component;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly keybindings: KeyMatcher;
	private readonly source: string;
	private scrollOffset = 0;
	private cachedWidth = 0;
	private cachedRows: string[] | undefined;

	constructor(
		diff: Component,
		source: string,
		stats: { files: number; added: number; removed: number },
		tui: TUI,
		theme: Theme,
		keybindings: KeyMatcher,
	) {
		this.diff = diff;
		this.source = source;
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.title = `Git diff · ${source} · ${stats.files} file${stats.files === 1 ? "" : "s"} · ${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `-${stats.removed}`)}`;
	}

	private readonly title: string;

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width));
		if (this.cachedRows && this.cachedWidth === safeWidth) return this.cachedRows;

		const allDiffRows = this.diff.render(safeWidth);
		const visibleRows = Math.max(1, this.tui.terminal.rows - DIFF_CHROME_ROWS);
		const maxScroll = Math.max(0, allDiffRows.length - visibleRows);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		const body = allDiffRows.slice(this.scrollOffset, this.scrollOffset + visibleRows);
		const end = allDiffRows.length === 0 ? 0 : this.scrollOffset + body.length;
		const footer = this.theme.fg(
			"muted",
			`rows ${allDiffRows.length === 0 ? 0 : this.scrollOffset + 1}-${end}/${allDiffRows.length} · ↑↓ scroll · PgUp/PgDn page · Esc close`,
		);
		this.cachedWidth = safeWidth;
		this.cachedRows = [fitLine(this.title, safeWidth), ...body.map((row) => fitLine(row, safeWidth)), fitLine(footer, safeWidth)];
		return this.cachedRows;
	}

	handleInput(data: string): void {
		const page = Math.max(1, this.tui.terminal.rows - DIFF_CHROME_ROWS);
		if (this.keybindings.matches(data, "tui.select.up")) this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		else if (this.keybindings.matches(data, "tui.select.down")) this.scrollOffset += 1;
		else if (this.keybindings.matches(data, "tui.select.pageUp")) this.scrollOffset = Math.max(0, this.scrollOffset - page);
		else if (this.keybindings.matches(data, "tui.select.pageDown")) this.scrollOffset += page;
		else return;
		this.cachedRows = undefined;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.cachedRows = undefined;
		this.diff.invalidate?.();
	}
}

async function loadGitDiff(pi: ExtensionAPI, ctx: ExtensionCommandContext, path?: string): Promise<{ text: string; source: string } | null> {
	const args = [
		"--no-optional-locks",
		"diff",
		"HEAD",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--no-renames",
	];
	if (path) args.push("--", path);
	const result = await pi.exec("git", args, { cwd: ctx.cwd, timeout: GIT_DIFF_TIMEOUT_MS });
	if (result.code !== 0) {
		ctx.ui.notify(`git diff failed: ${result.stderr.trim() || `exit ${result.code}`}`, "error");
		return null;
	}
	return { text: result.stdout, source: path ?? "HEAD → worktree" };
}

export function installGitDiffCommand(pi: ExtensionAPI): void {
	pi.registerCommand("diff", {
		description: "Review current git diff in a rich interactive viewer",
		getArgumentCompletions: () => [],
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("/diff requires TUI mode", "warning");
				return;
			}
			const loaded = await loadGitDiff(pi, ctx, safePathArg(args));
			if (!loaded) return;
			if (!loaded.text.trim()) {
				ctx.ui.notify("No tracked changes", "info");
				return;
			}
			const parsed = parseDiff(loaded.text);
			await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
				const richDiff = renderEditDiffResult(
					{ diff: loaded.text },
					{ expanded: true, filePath: safePathArg(args), invalidate: () => tui.requestRender() },
					{
						...config,
						// /diff is a review command: use Claude-style unified +/- rows,
						// not the side-by-side tool-card presentation.
						diffViewMode: "unified",
						diffIndicatorMode: "classic",
					} as ToolDisplayConfig,
					theme,
					"",
				);
				const viewer = new GitDiffViewer(
					richDiff,
					loaded.source,
					{ files: parsed.stats.files, added: parsed.stats.added, removed: parsed.stats.removed },
					tui,
					theme,
					keybindings,
				);
				const originalHandleInput = viewer.handleInput.bind(viewer);
				viewer.handleInput = (data: string) => {
					if (keybindings.matches(data, "tui.select.cancel")) {
						done();
						return;
					}
					originalHandleInput(data);
				};
				return viewer;
			});
		},
	});
}
