import $ from 'dartsx/internal/client';

function FeatureCard() {
    return $.jsx("div", { children: [$.jsx("p", { children: ["Fine-grained reactivity with state and derived."] }), $.jsx("p", { children: ["Use state variables to track changes."] }), $.jsx("p", { children: ["A derived value recomputes automatically."] })] });
}
