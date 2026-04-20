import $ from 'dartsx/internal/client';

function Child() {
    const __derived_0 = getContext();
    const name = $.derived(() => { const __value = __derived_0.user.name; return __value === undefined ? 'anon' : __value; });
    const rest = $.derived(() => { const __rest = { ...(__derived_0 ?? {}) }; delete __rest["user"]; return __rest; });
    return $.jsx("p", { children: [() => $.get(name), ":", () => rest.role, ":", () => rest.version] });
}
