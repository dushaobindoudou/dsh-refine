/**
 * dsh-refine — client half (web).
 *
 * 设置面板「精炼 Harness」：引擎条目浏览（四类 tab）、精炼历史时间线
 * （带一键回滚）、自动门判定审计流。数据经 host `refineUx/data` Remote 端点读取，
 * 回滚经 `refineUx/rollback` 转发给引擎的 harness_refine 工具。
 */
window.__ModuleLoader__.load({
	id: "dsh-refine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require("react");
		const React = react;

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

		function Badge(props) {
			const color = props.color || "#888";
			return React.createElement("span", {
				style: {
					display: "inline-block", padding: "1px 8px", borderRadius: 10,
					fontSize: 11, lineHeight: "18px", color: "#fff", backgroundColor: color,
					marginLeft: 6, verticalAlign: "middle", fontWeight: 500,
				},
			}, props.children);
		}

		function HarnessPanel() {
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
				setBusy(true); setNote("回滚中: " + id + " …");
				refineCall("rollback", { id: id }).then(function (r) {
					setNote(r && r.ok ? "已回滚 " + id : "回滚失败: " + ((r && r.error) || "unknown"));
					setBusy(false);
					load();
				}, function (e) {
					setNote("回滚失败: " + String(e));
					setBusy(false);
				});
			}

			const card = { backgroundColor: "var(--dsw-alias-bg-layer-1, #f6f7f9)", border: "1px solid var(--dsw-alias-border-l1, #e2e4e9)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 };
			const dim = { color: "var(--dsw-alias-label-secondary, #8a8f98)", fontSize: 12 };
			const btn = { fontSize: 12, padding: "3px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d5d8de)", background: "transparent", cursor: "pointer", color: "inherit" };

			const header = React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } },
				React.createElement("h3", { style: { margin: 0, fontSize: 15 } }, "Continual Harness 精炼"),
				data && React.createElement(Badge, { color: data.engineActive ? "#2e9e5b" : "#c2504d" }, data.engineActive ? "引擎已挂载" : "引擎未挂载"),
				React.createElement("span", { style: Object.assign({}, dim, { flex: 1 }) }),
				React.createElement("button", { style: btn, onClick: load }, "刷新"),
			);

			if (error) return React.createElement("div", null, header,
				React.createElement("div", { style: Object.assign({}, card, { color: "#c2504d" }) }, "读取失败: " + error));
			if (!data) return React.createElement("div", null, header,
				React.createElement("div", { style: dim }, "加载中…"));

			if (!data.hasState) return React.createElement("div", null, header,
				React.createElement("div", { style: card },
					React.createElement("div", null, "尚未发现 harness 状态文件"),
					React.createElement("div", { style: Object.assign({}, dim, { marginTop: 4 }) }, "预期路径: " + data.root + "/harness_state.json"),
					React.createElement("div", { style: Object.assign({}, dim, { marginTop: 4 }) }, data.engineActive ? "引擎已挂载，条目会在第一次精炼后出现。" : "挂载 dsh-continual-harness 引擎并重启 dsh 后，这里会展示 prompt/memory/skill/subagent 四类条目。"),
				));

			const kinds = ["prompt", "memory", "skill", "subagent"];
			const tabs = React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" } },
				kinds.map(function (k) {
					const active = k === kind;
					return React.createElement("button", {
						key: k, onClick: function () { setKind(k); },
						style: Object.assign({}, btn, active ? { background: "var(--dsw-alias-brand-primary, #3b82f6)", color: "#fff", borderColor: "transparent" } : {}),
					}, k + " · " + (data.entries[k] ? data.entries[k].length : 0));
				}),
			);

			const list = (data.entries[kind] || []).map(function (e) {
				return React.createElement("div", { key: e.id, style: card },
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
						React.createElement("strong", null, e.title || e.id),
						React.createElement(Badge, { color: e.scope === "global" ? "#7c5cbf" : "#5b7fa6" }, e.scope || "global"),
						e.pinned && React.createElement(Badge, { color: "#b8860b" }, "置顶"),
						e.archived && React.createElement(Badge, { color: "#8a8f98" }, "已归档"),
						React.createElement("span", { style: Object.assign({}, dim, { flex: 1 }) }),
						React.createElement("span", { style: dim }, "v" + e.version),
					),
					React.createElement("div", { style: Object.assign({}, dim, { marginTop: 4 }) }, e.id + " · 更新于 " + (e.updatedAt || "-")),
					e.content && React.createElement("div", { style: { marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 84, overflow: "hidden" } }, e.content),
				);
			});

			const historyItems = (data.history || []).map(function (h) {
				const canRollback = data.engineActive && !busy && !h.rollbackOf;
				return React.createElement("div", { key: h.id, style: Object.assign({}, card, { display: "flex", alignItems: "center", gap: 8 }) },
					React.createElement("div", { style: { flex: 1, minWidth: 0 } },
						React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
							React.createElement("code", { style: { fontSize: 11 } }, h.id),
							React.createElement(Badge, { color: h.scope === "global" ? "#7c5cbf" : "#5b7fa6" }, h.scope || "local"),
							h.rollbackOf && React.createElement(Badge, { color: "#8a8f98" }, "rollback → " + h.rollbackOf),
							React.createElement("span", { style: dim }, (typeof h.applied === "number" ? h.applied + "/" + (typeof h.total === "number" ? h.total : "?") + " 应用" : "")),
						),
						React.createElement("div", { style: { fontSize: 12, marginTop: 2 } }, h.summary || ""),
						React.createElement("div", { style: Object.assign({}, dim, { marginTop: 2 }) }, h.committedAt || ""),
					),
					React.createElement("button", { style: btn, disabled: !canRollback, onClick: function () { rollback(h.id); } }, "回滚"),
				);
			});

			const reviewRows = (data.reviews || []).map(function (r, i) {
				const colors = { approved: "#2e9e5b", declined: "#c2504d", assessed: "#5b7fa6", failed: "#c2504d" };
				return React.createElement("div", { key: i, style: { display: "flex", gap: 8, fontSize: 12, padding: "3px 0", alignItems: "baseline" } },
					React.createElement(Badge, { color: colors[r.outcome] || "#888" }, r.outcome || "?"),
					React.createElement("span", { style: dim }, r.trigger || ""),
					React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.rationale || ""),
				);
			});

			return React.createElement("div", null,
				header,
				tabs,
				list.length > 0 ? list : React.createElement("div", { style: Object.assign({}, card, dim) }, "（" + kind + " 类暂无条目）"),
				React.createElement("h4", { style: { fontSize: 13, margin: "16px 0 8px" } }, "精炼历史"),
				historyItems.length > 0 ? historyItems : React.createElement("div", { style: Object.assign({}, card, dim) }, "（暂无精炼记录）"),
				data.reviews && data.reviews.length > 0 && React.createElement("h4", { style: { fontSize: 13, margin: "16px 0 8px" } }, "自动门判定（最近）"),
				data.reviews && data.reviews.length > 0 && React.createElement("div", { style: card }, reviewRows),
				note && React.createElement("div", { style: Object.assign({}, card, { fontSize: 12 }) }, note),
			);
		}

		const inject = ["connection", "slots"];

		function apply(c) {
			connectionSvc = c.get("connection");
			const slots = c.get("slots");
			if (slots === undefined) return;
			c.effect(() => slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "dsh-refine", order: 80, label: "精炼 Harness" },
				() => React.createElement(HarnessPanel),
			)), "dsh-refine: settings panel");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
