import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { sanitizeAnsiForThemedOutput } from "./ansi-utils.ts";
import { sanitizeToolResultText } from "../../../utils/tool-result-sanitize.ts";
import { MAX_HL_CHARS, shikiHighlightCache } from "./shiki-highlight.ts";
import { normalizeCodeWhitespace } from "./diff-text.ts";
import {
	applyInlineSpanHighlight,
	colorizeSegment,
	getLineBackground,
	resolveShikiTheme,
	type DiffPalette,
	type DiffTheme,
} from "./diff-palette.ts";
import type { DiffLineEntry, ParsedDiffEntry } from "./diff-parse.ts";
import type { DiffSpan } from "./diff-inline.ts";

export type CodeLineHighlighter = (line: string, entry: DiffLineEntry) => string;

function cleanCodeLine(line: string): string {
	return sanitizeToolResultText(line).replace(/\n/g, "");
}

export function shouldHighlightCodeBlock(code: string): boolean {
	return code.length <= MAX_HL_CHARS;
}

export function resolveLanguageFromPath(rawPath: string | undefined): string | undefined {
	if (!rawPath || !rawPath.trim()) {
		return undefined;
	}
	const normalizedPath = rawPath.replace(/^@/, "").trim();
	if (!normalizedPath) {
		return undefined;
	}
	try {
		return getLanguageFromPath(normalizedPath);
	} catch {
		return undefined;
	}
}

export function createCodeLineHighlighter(
	language: string | undefined,
	theme: DiffTheme,
	entries: readonly ParsedDiffEntry[],
	invalidate?: () => void,
): CodeLineHighlighter {
	const codeEntries = entries.filter((entry): entry is DiffLineEntry => entry.kind === "line");
	const cleanLines = codeEntries.map((entry) =>
		cleanCodeLine(normalizeCodeWhitespace(entry.content)),
	);
	const code = cleanLines.join("\n");
	const shouldHighlight = !!language && shouldHighlightCodeBlock(code);
	const fallbackLines = shouldHighlight
		? (() => {
				try {
					return highlightCode(code, language).map(sanitizeAnsiForThemedOutput);
				} catch {
					return cleanLines.map(sanitizeAnsiForThemedOutput);
				}
			})()
		: cleanLines.map(sanitizeAnsiForThemedOutput);
	const fallbackByEntry = new WeakMap(
		codeEntries.map((entry, index) => [entry, fallbackLines[index] ?? cleanLines[index] ?? ""]),
	);
	if (!shouldHighlight) return (_line, entry) => fallbackByEntry.get(entry) ?? "";

	const shikiTheme = resolveShikiTheme(theme);
	let highlightedByEntry: WeakMap<DiffLineEntry, string> | undefined;
	const resolveHighlighted = () => {
		if (highlightedByEntry) return;
		const highlighted = shikiHighlightCache.get(
			code,
			language,
			shikiTheme,
			fallbackLines,
			invalidate,
		);
		if (highlighted) {
			highlightedByEntry = new WeakMap(
				codeEntries.map((entry, index) => [
					entry,
					sanitizeAnsiForThemedOutput(highlighted[index] ?? fallbackByEntry.get(entry) ?? ""),
				]),
			);
		}
	};
	resolveHighlighted();
	return (_line, entry) => {
		resolveHighlighted();
		return highlightedByEntry?.get(entry) ?? fallbackByEntry.get(entry) ?? "";
	};
}

export function highlightDiffLine(
	codeText: string,
	entry: DiffLineEntry,
	inlineHighlights: WeakMap<DiffLineEntry, DiffSpan[]>,
	palette: DiffPalette,
	highlightLine: CodeLineHighlighter,
	theme: DiffTheme,
	containerBgAnsi: string | undefined,
): { highlighted: string; rowBg: string | undefined } {
	const syntaxHighlighted = highlightLine(codeText, entry);
	const rowBg = getLineBackground(entry.lineKind, palette, false);
	const emphasisBg = getLineBackground(entry.lineKind, palette, true);
	const inlineSpans = inlineHighlights.get(entry) ?? [];
	// Syntax highlighters commonly color identifiers/strings green. That is
	// correct for context lines but makes removed lines look like additions.
	// Diff semantics own foreground color on changed rows; keep syntax colors
	// only for context, matching bat/Claude diff presentation.
	const semanticHighlighted =
		entry.lineKind === "add"
			? colorizeSegment(theme, "toolDiffAdded", codeText, rowBg)
			: entry.lineKind === "remove"
				? colorizeSegment(theme, "toolDiffRemoved", codeText, rowBg)
				: syntaxHighlighted;
	const highlighted = applyInlineSpanHighlight(
		codeText,
		semanticHighlighted,
		inlineSpans,
		emphasisBg,
		rowBg,
		containerBgAnsi,
	);
	return { highlighted, rowBg };
}
