import $ from "dartsx/internal/client";
function App() {
	return $.jsx(Wrapper, { fallback: () => $.jsx("p", { children: ["Loading..."] }) });
}
