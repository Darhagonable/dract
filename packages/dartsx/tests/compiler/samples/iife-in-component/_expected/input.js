import $ from "dartsx/internal/client";
export default function IIFEComponent() {
	let items = $.state([
		"alpha",
		"beta",
		"gamma"
	]);
	const grouped = $.derived(() => {
		const result = [];
		for (const item of $.get(items)) {
			result.push({
				label: item,
				upper: item.toUpperCase()
			});
		}
		return result;
	});
	return $.jsx("ul", { children: [$.for(() => $.get(grouped), (g) => $.jsx("li", { children: [
		g.label,
		": ",
		g.upper
	] }))] });
}
