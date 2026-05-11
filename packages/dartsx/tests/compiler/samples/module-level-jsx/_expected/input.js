import $ from "dartsx/internal/client";
import Home from "./Home";
import DocPage from "./DocPage";

export const routes = {
	"/": () => $.jsx(Home),
	"/docs/:slug": ({ slug }) => $.jsx(DocPage, { slug })
};