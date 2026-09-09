/**
 * dsh-refine — client half (web).
 *
 * 设置面板「Refine Harness」（dsh-refine 的 UX 壳）：顶部引擎/状态总览、
 * 条目浏览（prompt/memory/skill/subagent 四类 tab）、精炼历史时间线（一键
 * 回滚）、自动门判定审计流。数据经 host `refineUx/data` Remote 端点读取，回滚
 * 经 `refineUx/rollback` 转发给引擎的 harness_refine 工具。
 *
 * 兼容 dsh 原生客户端约定：
 * - 语言：经 `locale` 模型注册 `settings.refine` 双语字典（zh/en），随宿主当前
 *   语言自动切换；
 * - 主题：只使用 dsh 的 `--dsw-alias-*` 设计令牌（含 color-mix 渲染的 pill），
 *   暗黑/浅色由宿主自动切换，本面板不写死亮色 hex。
 */
window.__ModuleLoader__.load({
	id: "dsh-refine",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		const react = require("react");
		const React = react;

		const LOCALE_NS = "settings.refine";
		const KINDS = ["prompt", "memory", "skill", "subagent"];

		/** English copy. */
		const en = {
			nav: "Refine Harness",
			engineActive: "Engine active",
			engineInactive: "Engine not mounted",
			refresh: "Refresh",
			loading: "Loading…",
			loadError: "Could not read harness data",
			overview: "Overview",
			engineRow: "Engine",
			stateRow: "State path",
			pluginRow: "Plugin",
			entriesRow: "Entries",
			noStateTitle: "No harness state yet",
			noStateHint: "Expected file",
			noStateHintActive: "Entries appear after the first refinement.",
			noStateHintInactive: "Mount a dsh-continual-harness engine and restart dsh; prompt / memory / skill / subagent entries will appear here.",
			entriesHeading: "Entries",
			historyHeading: "Refinement history",
			reviewsHeading: "Recent auto-gate reviews",
			kindEmpty: "No {kind} entries yet.",
			historyEmpty: "No refinements recorded yet.",
			global: "global",
			local: "local",
			pinned: "Pinned",
			archived: "Archived",
			rollbackOf: "rollback → {id}",
			applied: "{applied}/{total} applied",
			updated: "updated {date}",
			rollback: "Roll back",
			rollingBack: "Rolling back {id}…",
			rolledBack: "Rolled back {id}.",
			rollbackFailed: "Rollback failed: {reason}",
			rollbackUnavailable: "Rollback unavailable",
			outcomeApproved: "approved",
			outcomeDeclined: "declined",
			outcomeAssessed: "assessed",
			outcomeFailed: "failed",
			"kinds.prompt": "Prompt",
			"kinds.memory": "Memory",
			"kinds.skill": "Skill",
			"kinds.subagent": "Subagent",
		};

		/** Simplified Chinese copy. */
		const zh = {
			nav: "精炼 Harness",
			engineActive: "引擎已挂载",
			engineInactive: "引擎未挂载",
			refresh: "刷新",
			loading: "加载中…",
			loadError: "读取 harness 数据失败",
			overview: "总览",
			engineRow: "引擎",
			stateRow: "状态目录",
			pluginRow: "插件",
			entriesRow: "条目",
			noStateTitle: "尚未发现 harness 状态文件",
			noStateHint: "预期路径",
			noStateHintActive: "条目会在第一次精炼后出现。",
			noStateHintInactive: "挂载 dsh-continual-harness 引擎并重启 dsh 后，这里会展示 prompt / memory / skill / subagent 四类条目。",
			entriesHeading: "条目",
			historyHeading: "精炼历史",
			reviewsHeading: "自动门判定（最近）",
			kindEmpty: "（{kind} 类暂无条目）",
			historyEmpty: "（暂无精炼记录）",
			global: "global",
			local: "local",
			pinned: "置顶",
			archived: "已归档",
			rollbackOf: "rollback → {id}",
			applied: "{applied}/{total} 应用",
			updated: "更新于 {date}",
			rollback: "回滚",
			rollingBack: "回滚中 {id} …",
			rolledBack: "已回滚 {id}。",
			rollbackFailed: "回滚失败：{reason}",
			rollbackUnavailable: "回滚不可用",
			outcomeApproved: "approved",
			outcomeDeclined: "declined",
			outcomeAssessed: "assessed",
			outcomeFailed: "failed",
			"kinds.prompt": "提示词",
			"kinds.memory": "记忆",
			"kinds.skill": "技能",
			"kinds.subagent": "子代理",
		};

		const fallbackT = (key, params) => (params && typeof params === "object" ? JSON.stringify(params) : key);

		let connectionSvc = null;

		/**
		 * Invoke one host `refineUx/<method>` Remote endpoint over the client
		 * Connection RPC carrier. Returns the business value; throws on
		 * transport or gateway failure (business `{ ok: false, error }` shapes
		 * stay return values, matching the panel's error display paths).
		 */
		const refineCall = async (method, request) => {
			if (connectionSvc === null) throw new Error("连接服务尚未就绪");
			const envelope = await connectionSvc.rpc.call("/api", "refineUx/" + method, {
				args: { request: request === undefined ? null : request },
			});
			if (envelope !== null && typeof envelope === "object" && envelope.ok === false) {
				throw new Error((envelope.error && envelope.error.message) || "调用失败");
			}
			if (envelope !== null && typeof envelope === "object" && envelope.ok === true) return envelope.value;
			throw new Error("意外的 RPC 响应");
		};

		/** dsh 设计令牌（自动适配暗黑/浅色）。 */
		function tint(colorVar) { return "var(" + colorVar + ")"; }

		const tokens = {
			text: tint("--dsw-alias-label-primary"),
			sub: tint("--dsw-alias-label-secondary"),
			dim: tint("--dsw-alias-label-tertiary"),
			bgLayer1: tint("--dsw-alias-bg-layer-1"),
			fillTsp: tint("--dsw-alias-fill-tsp-secondary"),
			borderL2: tint("--dsw-alias-border-l2"),
			borderL3: tint("--dsw-alias-border-l3"),
			borderL4: tint("--dsw-alias-border-l4"),
			hoverBg: tint("--dsw-alias-interactive-bg-hover"),
			buttonFill: tint("--dsw-alias-button-primary-fill"),
			buttonHover: tint("--dsw-alias-button-primary-hover"),
			buttonText: tint("--dsw-alias-label-primary-foreground"),
			success: tint("--dsw-alias-state-success-primary"),
			error: tint("--dsw-alias-state-error-primary"),
			business: tint("--dsw-alias-state-business-primary"),
			warn: tint("--dsw-alias-state-warn-label"),
			fontCode: "var(--ds-font-family-code)",
		};

		const cardStyle = {
			backgroundColor: tokens.bgLayer1,
			border: "0.5px solid " + tokens.borderL2,
			borderRadius: 12,
			padding: "10px 12px",
			marginBottom: 8,
		};
		const btnStyle = {
			height: 30,
			padding: "0 12px",
			fontSize: 13,
			lineHeight: "28px",
			borderRadius: 15,
			border: "0.5px solid " + tokens.borderL3,
			background: "transparent",
			color: tokens.text,
			cursor: "pointer",
			font: "inherit",
		};
		const btnPrimaryStyle = {
			height: 30,
			padding: "0 14px",
			fontSize: 13,
			lineHeight: "28px",
			borderRadius: 15,
			border: "none",
			background: tokens.buttonFill,
			color: tokens.buttonText,
			cursor: "pointer",
			font: "inherit",
		};

		function badgeStyle(colorVar, tinted) {
			return {
				display: "inline-block",
				padding: "1px 8px",
				borderRadius: 999,
				fontSize: 11,
				lineHeight: "18px",
				marginLeft: 6,
				verticalAlign: "middle",
				fontWeight: 500,
				color: tinted ? "var(" + colorVar + ")" : tokens.sub,
				backgroundColor: tinted
					? "color-mix(in srgb, var(" + colorVar + ") 14%, transparent)"
					: tokens.fillTsp,
			};
		}

		function Badge(props) {
			const colorVar = props.color; // e.g. "success" resolved below
			const tones = {
				success: tokens.success,
				error: tokens.error,
				business: tokens.business,
				warn: tokens.warn,
			};
			const tinted = props.tint === true;
			const resolved = colorVar ? (tones[colorVar] || colorVar) : tokens.success;
			return React.createElement("span", { style: badgeStyle(resolved.replace(/^var\((.*)\)$/, "$1"), tinted) }, props.children);
		}

		function SectionTitle(props) {
			return React.createElement("h4", {
				style: {
					fontSize: 13,
					fontWeight: 600,
					lineHeight: "20px",
					margin: "18px 0 8px",
					color: tokens.text,
				},
			}, props.children);
		}

		function OverviewRow(props) {
			return React.createElement("div", { style: { display: "flex", gap: 10, padding: "4px 0", alignItems: "baseline" } },
				React.createElement("span", { style: { width: 76, flex: "none", color: tokens.dim, fontSize: 12 } }, props.label),
				React.createElement("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere", color: props.muted ? tokens.sub : tokens.text, fontSize: 13, fontFamily: props.code ? tokens.fontCode : "inherit" } }, props.value),
			);
		}

		function HarnessPanel(props) {
			const t = props && typeof props.t === "function" ? props.t : fallbackT;
			const state = React.useState(null);
			const data = state[0]; const setData = state[1];
			const errState = React.useState("");
			const error = errState[0]; const setError = errState[1];
			const noteState = React.useState("");
			const note = noteState[0]; const setNote = noteState[1];
			const busyState = React.useState(false);
			const busy = busyState[0]; const setBusy = busyState[1];
			const kindState = React.useState("memory");
			const kind = kindState[0]; const setKind = kindState[1];

			const load = React.useCallback(function () {
				setError("");
				refineCall("data").then(function (d) { setData(d); }, function (e) {
					setError(String((e && e.message) || e));
				});
			}, []);
			React.useEffect(function () { load(); }, [load]);

			function rollback(id) {
				setBusy(true); setNote(t("rollingBack", { id: id }));
				refineCall("rollback", { id: id }).then(function (r) {
					setNote(r && r.ok ? t("rolledBack", { id: id }) : t("rollbackFailed", { reason: (r && r.error) || "unknown" }));
					setBusy(false);
					load();
				}, function (e) {
					setNote(t("rollbackFailed", { reason: String(e) }));
					setBusy(false);
				});
			}

			const kindLabel = function (k) {
				const dict = t("kinds." + k);
				return (typeof dict === "string" && dict !== "kinds." + k) ? dict : k;
			};

			const header = React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" } },
				React.createElement("h3", { style: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: "24px", color: tokens.text } }, t("nav")),
				React.createElement(Badge, { color: data && data.engineActive ? "success" : "error", tint: true },
					data && data.engineActive ? t("engineActive") : t("engineInactive")),
				React.createElement("span", { style: Object.assign({ color: tokens.dim, fontSize: 12 }, { flex: 1, minWidth: 24 }) }),
				React.createElement("button", { style: btnStyle, onClick: load }, t("refresh")),
			);

			if (error) return React.createElement("div", null, header,
				React.createElement("div", { style: Object.assign({}, cardStyle, { color: tokens.error }) },
					React.createElement("div", { style: { fontSize: 13 } }, t("loadError")),
					React.createElement("div", { style: { fontSize: 12, marginTop: 4, overflowWrap: "anywhere" } }, error)));

			if (!data) return React.createElement("div", null, header,
				React.createElement("div", { style: Object.assign({}, cardStyle, { color: tokens.dim, fontSize: 13 }) }, t("loading")));

			// 总览（配置页式只读行）。
			const overview = React.createElement("div", { style: cardStyle },
				React.createElement(OverviewRow, { label: t("engineRow"), value: data.engineActive ? t("engineActive") : t("engineInactive"), muted: !data.engineActive }),
				React.createElement(OverviewRow, { label: t("stateRow"), value: data.root + "/harness_state.json", code: true }),
				React.createElement(OverviewRow, { label: t("entriesRow"), value: KINDS.map(function (k) {
					return kindLabel(k) + " " + (data.entries[k] ? data.entries[k].length : 0);
				}).join("  ·  ") }),
				React.createElement(OverviewRow, { label: t("pluginRow"), value: "dsh-refine " + (data.uxVersion || "") }));

			if (!data.hasState) return React.createElement("div", null, header, overview,
				React.createElement("div", { style: cardStyle },
					React.createElement("div", { style: { color: tokens.text, fontSize: 13 } }, t("noStateTitle")),
					React.createElement("div", { style: Object.assign({ color: tokens.dim, fontSize: 12, marginTop: 4 }) }, t("noStateHint") + ": " + data.root + "/harness_state.json"),
					React.createElement("div", { style: Object.assign({ color: tokens.dim, fontSize: 12, marginTop: 4 }) },
						data.engineActive ? t("noStateHintActive") : t("noStateHintInactive"))));

			const tabs = React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" } },
				KINDS.map(function (k) {
					const active = k === kind;
					return React.createElement("button", {
						key: k, onClick: function () { setKind(k); },
						style: Object.assign({}, btnStyle, active ? {
							borderColor: "transparent",
							background: tokens.buttonFill,
							color: tokens.buttonText,
							fontWeight: 600,
						} : {}),
					}, kindLabel(k) + " · " + (data.entries[k] ? data.entries[k].length : 0));
				}));

			const list = (data.entries[kind] || []).map(function (e) {
				return React.createElement("div", { key: e.id, style: cardStyle },
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
						React.createElement("strong", { style: { fontSize: 13, color: tokens.text } }, e.title || e.id),
						React.createElement(Badge, { color: e.scope === "global" ? "business" : null, tint: e.scope === "global" }, e.scope === "global" ? t("global") : t("local")),
						e.pinned && React.createElement(Badge, { color: "warn", tint: true }, t("pinned")),
						e.archived && React.createElement(Badge, { color: null, tint: false }, t("archived")),
						React.createElement("span", { style: Object.assign({ color: tokens.dim, fontSize: 12, marginLeft: "auto" }) }, "v" + e.version),
					),
					React.createElement("div", { style: Object.assign({ color: tokens.dim, fontSize: 12, marginTop: 4 }) },
						e.id + " · " + t("updated", { date: e.updatedAt || "-" })),
					e.content && React.createElement("div", { style: { marginTop: 6, fontSize: 12, color: tokens.sub, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 84, overflow: "hidden" } }, e.content),
				);
			});

			const historyItems = (data.history || []).map(function (h) {
				const canRollback = data.engineActive && !busy && !h.rollbackOf;
				return React.createElement("div", { key: h.id, style: Object.assign({}, cardStyle, { display: "flex", alignItems: "center", gap: 8 }) },
					React.createElement("div", { style: { flex: 1, minWidth: 0 } },
						React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
							React.createElement("code", { style: { fontSize: 11, fontFamily: tokens.fontCode, color: tokens.sub } }, h.id),
							React.createElement(Badge, { color: h.scope === "global" ? "business" : null, tint: h.scope === "global" }, h.scope === "global" ? t("global") : t("local")),
							h.rollbackOf && React.createElement(Badge, { color: null, tint: false }, t("rollbackOf", { id: h.rollbackOf })),
							React.createElement("span", { style: { color: tokens.dim, fontSize: 12 } },
								(typeof h.applied === "number" ? t("applied", { applied: h.applied, total: (typeof h.total === "number" ? h.total : "?") }) : "")),
						),
						React.createElement("div", { style: { fontSize: 12, marginTop: 2, color: tokens.text } }, h.summary || ""),
						React.createElement("div", { style: Object.assign({ color: tokens.dim, fontSize: 12, marginTop: 2 }) }, h.committedAt || ""),
					),
					React.createElement("button", {
						style: Object.assign({}, btnPrimaryStyle, canRollback ? {} : { background: tokens.fillTsp, color: tokens.dim, cursor: "not-allowed" }),
						disabled: !canRollback,
						onClick: function () { rollback(h.id); },
					}, t("rollback")),
				);
			});

			const outcomeTone = { approved: "success", declined: "error", assessed: "business", failed: "error" };
			const outcomeKey = { approved: "outcomeApproved", declined: "outcomeDeclined", assessed: "outcomeAssessed", failed: "outcomeFailed" };
			const reviewRows = (data.reviews || []).map(function (r, i) {
				const tone = outcomeTone[r.outcome] || null;
				return React.createElement("div", { key: i, style: { display: "flex", gap: 8, fontSize: 12, padding: "3px 0", alignItems: "baseline" } },
					React.createElement(Badge, { color: tone || null, tint: !!tone }, outcomeKey[r.outcome] ? t(outcomeKey[r.outcome]) : (r.outcome || "?")),
					React.createElement("span", { style: { color: tokens.dim, flex: "none" } }, r.trigger || ""),
					React.createElement("span", { style: Object.assign({ color: tokens.sub, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }) }, r.rationale || ""),
				);
			});

			const entriesBlock = React.createElement("div", null,
				React.createElement(SectionTitle, null, t("entriesHeading")),
				tabs,
				list.length > 0 ? list : React.createElement("div", { style: Object.assign({}, cardStyle, { color: tokens.dim, fontSize: 13 }) }, t("kindEmpty", { kind: kindLabel(kind) })));

			const historyBlock = React.createElement("div", null,
				React.createElement(SectionTitle, null, t("historyHeading")),
				historyItems.length > 0 ? historyItems : React.createElement("div", { style: Object.assign({}, cardStyle, { color: tokens.dim, fontSize: 13 }) }, t("historyEmpty")));

			const reviewsBlock = data.reviews && data.reviews.length > 0
				? React.createElement("div", null,
					React.createElement(SectionTitle, null, t("reviewsHeading")),
					React.createElement("div", { style: cardStyle }, reviewRows))
				: null;

			return React.createElement("div", null, header, overview, entriesBlock, historyBlock, reviewsBlock,
				note && React.createElement("div", { style: Object.assign({}, cardStyle, { color: tokens.sub, fontSize: 12 }) }, note));
		}

		const inject = ["connection", "slots", "locale"];

		function apply(c) {
			connectionSvc = c.get("connection");
			const slots = c.get("slots");
			const localeSvc = c.get("locale");
			if (slots === undefined) return;

			if (localeSvc && typeof localeSvc.register === "function") {
				c.effect(() => localeSvc.register(LOCALE_NS, { zh: zh, en: en }), "dsh-refine: locale dictionaries");
			}

			const bind = localeSvc && typeof localeSvc.bind === "function" ? function (ns) { return localeSvc.bind(ns); } : null;

			c.effect(() => slots.inject("settings.section", () => slots.register(
				{
					name: "settings.section",
					id: "dsh-refine",
					order: 80,
					locale: LOCALE_NS,
					label: () => (bind ? bind(LOCALE_NS)("nav") : "Refine Harness"),
				},
				() => React.createElement(HarnessPanel, { t: bind ? bind(LOCALE_NS) : fallbackT }),
			)), "dsh-refine: settings panel");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
