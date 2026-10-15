import { test } from "node:test";
import assert from "node:assert";
import { default as enhance } from "../extensions/renderer/markdown-enhance.ts";

const transformers: Array<(md: string, ctx?: object) => string> = [];
enhance({
	registerMarkdownTransformer: (fn: (md: string, ctx?: object) => string) => transformers.push(fn),
} as never);
const assistant = { messageType: "assistant", isStreaming: false, availableWidth: 100 };
const run = (md: string, ctx: object = assistant) =>
	transformers.reduce((acc, fn) => fn(acc, ctx), md);

test("独立成行的 <br> 变成段落空行，不残留标签", () => {
	const out = run("第一段\n\n<br>\n\n第二段");
	assert.ok(!/<br/i.test(out), JSON.stringify(out));
	assert.ok(out.includes("第一段") && out.includes("第二段"), JSON.stringify(out));
});

test("行内 <br> 变成单个空格", () => {
	const out = run("前面 <br> 后面");
	assert.ok(!/<br/i.test(out), JSON.stringify(out));
	assert.ok(out.includes("前面 后面"), JSON.stringify(out));
	assert.ok(!out.includes("  "), `no double space: ${JSON.stringify(out)}`);
});

test("<br><br> 连续标签整体删除", () => {
	const out = run("甲<br><br>乙");
	assert.ok(!/<br/i.test(out), JSON.stringify(out));
});

test("自闭合写法 <br/> 与 <br /> 同样处理", () => {
	assert.ok(!/<br/i.test(run("a<br/>b")), "<br/>");
	assert.ok(!/<br/i.test(run("a<br />b")), "<br />");
});

test("代码块内的 <br> 不动（保留原样）", () => {
	const out = run("```html\n<br>\n```\n正文 <br> 结束");
	assert.ok(out.includes("```html\n<br>\n```"), JSON.stringify(out));
	assert.ok(!/正文 <br/.test(out), JSON.stringify(out));
});

test("mermaid 代码块内的 <br> 交给图渲染器，结果与用户消息一致（本步骤不改围栏）", () => {
	const src = "```mermaid\ngraph TD\nA[a<br>b] --> B\n```";
	const asAssistant = run(src);
	const asUser = run(src, { messageType: "user", isStreaming: false, availableWidth: 100 });
	assert.strictEqual(asAssistant, asUser, "the step must not change the fence content");
});

test("四反引号围栏不被三反引号行提前闭合，内部 <br> 保留", () => {
	const out = run("````\n```\n<br>\n````\n外 <br> 文");
	assert.ok(out.includes("```\n<br>\n````"), JSON.stringify(out));
	assert.ok(out.includes("外 文"), JSON.stringify(out));
});

test("未闭合围栏之后的 <br> 保持原样（默认保守，不猜测代码边界）", () => {
	const out = run("正文 <br> 前\n```js\n代码未闭合\n后面 <br> 还要修");
	assert.ok(out.includes("后面 <br> 还要修"), JSON.stringify(out));
});

test("行内代码里的 <br> 不动", () => {
	const out = run("用 `<br>` 换行，然后 <br> 下一行");
	assert.ok(out.includes("`<br>`"), JSON.stringify(out));
	assert.ok(out.includes("然后 下一行"), JSON.stringify(out));
});

test("只作用于 assistant 消息：用户消息的 <br> 原样保留", () => {
	const out = run("用户写的 <br> 不改", {
		messageType: "user",
		isStreaming: false,
		availableWidth: 100,
	});
	assert.ok(out.includes("<br>"), JSON.stringify(out));
});

test("thinking 消息不做处理", () => {
	const out = run("推理里的 <br> 保持", {
		messageType: "assistant-thinking",
		isStreaming: false,
		availableWidth: 100,
	});
	assert.ok(out.includes("<br>"), JSON.stringify(out));
});

test("普通文本与其他 HTML 标签不受影响", () => {
	const out = run("保留 <b>粗体</b> 文字");
	assert.ok(out.includes("<b>粗体</b>"), JSON.stringify(out));
});
