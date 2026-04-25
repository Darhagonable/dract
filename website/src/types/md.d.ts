declare module '*.md' {
	const content: {
		html: string;
		title: string;
		sections: { slug: string; title: string; level: number }[];
	};
	export default content;
}
